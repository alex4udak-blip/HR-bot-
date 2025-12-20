from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message, ChatCriteria, AIConversation, AnalysisHistory
from ..models.schemas import (
    AIMessageRequest, AIConversationResponse, AnalysisResponse,
    AnalyzeRequest, ReportRequest
)
from ..services.auth import get_current_user
from ..services.ai import ai_service
from ..services.reports import generate_pdf_report, generate_docx_report

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


async def get_chat_context(db: AsyncSession, chat_id: int):
    """Get chat with messages and criteria."""
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        return None, [], []

    result = await db.execute(
        select(Message).where(Message.chat_id == chat_id).order_by(Message.timestamp)
    )
    messages = result.scalars().all()

    result = await db.execute(select(ChatCriteria).where(ChatCriteria.chat_id == chat_id))
    criteria_obj = result.scalar_one_or_none()
    criteria = criteria_obj.criteria if criteria_obj else []

    return chat, list(messages), criteria


@router.post("/{chat_id}/ai/message")
async def ai_message(
    chat_id: int,
    request: AIMessageRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    chat, messages, criteria = await get_chat_context(db, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get or create conversation
    result = await db.execute(
        select(AIConversation).where(
            AIConversation.chat_id == chat_id,
            AIConversation.user_id == user.id
        )
    )
    conversation = result.scalar_one_or_none()

    if not conversation:
        conversation = AIConversation(
            chat_id=chat_id,
            user_id=user.id,
            messages=[]
        )
        db.add(conversation)

    history = conversation.messages or []

    # Get chat type info
    chat_type = chat.chat_type.value if chat.chat_type else "hr"
    custom_description = chat.custom_type_description

    # Handle quick actions
    if request.quick_action:
        async def generate():
            full_response = ""
            async for chunk in ai_service.quick_action(
                request.quick_action, chat.title, messages, criteria,
                chat_type, custom_description
            ):
                full_response += chunk
                yield f"data: {json.dumps({'content': chunk})}\n\n"

            # Save to conversation
            history.append({
                "role": "user",
                "content": f"[Быстрое действие: {request.quick_action}]",
                "timestamp": datetime.utcnow().isoformat()
            })
            history.append({
                "role": "assistant",
                "content": full_response,
                "timestamp": datetime.utcnow().isoformat()
            })
            conversation.messages = history
            await db.commit()

            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    # Regular message
    async def generate():
        full_response = ""
        async for chunk in ai_service.chat_stream(
            request.message, chat.title, messages, criteria, history,
            chat_type, custom_description
        ):
            full_response += chunk
            yield f"data: {json.dumps({'content': chunk})}\n\n"

        # Save to conversation
        history.append({
            "role": "user",
            "content": request.message,
            "timestamp": datetime.utcnow().isoformat()
        })
        history.append({
            "role": "assistant",
            "content": full_response,
            "timestamp": datetime.utcnow().isoformat()
        })
        conversation.messages = history
        await db.commit()

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/{chat_id}/ai/history", response_model=AIConversationResponse)
async def get_ai_history(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(AIConversation).where(
            AIConversation.chat_id == chat_id,
            AIConversation.user_id == user.id
        )
    )
    conversation = result.scalar_one_or_none()

    if not conversation:
        return AIConversationResponse(
            id=0, chat_id=chat_id, messages=[],
            created_at=datetime.utcnow(), updated_at=datetime.utcnow()
        )

    return AIConversationResponse(
        id=conversation.id,
        chat_id=conversation.chat_id,
        messages=conversation.messages or [],
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


@router.delete("/{chat_id}/ai/history", status_code=204)
async def clear_ai_history(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    result = await db.execute(
        select(AIConversation).where(
            AIConversation.chat_id == chat_id,
            AIConversation.user_id == user.id
        )
    )
    conversation = result.scalar_one_or_none()

    if conversation:
        await db.delete(conversation)
        await db.commit()


@router.post("/{chat_id}/analyze", response_model=AnalysisResponse)
async def analyze_chat(
    chat_id: int,
    request: AnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    chat, messages, criteria = await get_chat_context(db, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    chat_type = chat.chat_type.value if chat.chat_type else "hr"
    result = await ai_service.generate_report(
        chat.title, messages, criteria, request.report_type, request.include_quotes,
        chat_type, chat.custom_type_description
    )

    analysis = AnalysisHistory(
        chat_id=chat_id,
        user_id=user.id,
        result=result,
        report_type=request.report_type,
        criteria_used=criteria,
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    return AnalysisResponse(
        id=analysis.id,
        chat_id=analysis.chat_id,
        result=analysis.result,
        report_type=analysis.report_type,
        created_at=analysis.created_at,
    )


@router.get("/{chat_id}/analysis-history", response_model=List[AnalysisResponse])
async def get_analysis_history(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(AnalysisHistory)
        .where(AnalysisHistory.chat_id == chat_id)
        .order_by(AnalysisHistory.created_at.desc())
        .limit(20)
    )
    history = result.scalars().all()

    return [
        AnalysisResponse(
            id=h.id, chat_id=h.chat_id, result=h.result,
            report_type=h.report_type, created_at=h.created_at
        ) for h in history
    ]


@router.post("/{chat_id}/report")
async def generate_report_file(
    chat_id: int,
    request: ReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    chat, messages, criteria = await get_chat_context(db, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    chat_type = chat.chat_type.value if chat.chat_type else "hr"
    # Generate report content
    content = await ai_service.generate_report(
        chat.title, messages, criteria, request.report_type, True,
        chat_type, chat.custom_type_description
    )

    # Save to history
    analysis = AnalysisHistory(
        chat_id=chat_id,
        user_id=user.id,
        result=content,
        report_type=request.report_type,
        report_format=request.format,
        criteria_used=criteria,
    )
    db.add(analysis)
    await db.commit()

    # Generate file
    title = chat.custom_name or chat.title

    if request.format == "pdf":
        file_bytes = generate_pdf_report(title, content, chat.title)
        return Response(
            content=file_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="report_{chat_id}.pdf"'}
        )
    elif request.format == "docx":
        file_bytes = generate_docx_report(title, content, chat.title)
        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="report_{chat_id}.docx"'}
        )
    else:
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="report_{chat_id}.md"'}
        )
