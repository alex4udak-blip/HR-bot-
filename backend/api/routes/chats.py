from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message, AnalysisHistory
from ..models.schemas import (
    ChatResponse, ChatUpdate, MessageResponse,
    AnalysisRequest, AnalysisResponse, ChatParticipant
)
from ..services.auth import get_current_user
from ..services.analyzer import analyzer_service

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    """Check if user can access this chat."""
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


@router.get("", response_model=List[ChatResponse])
async def get_chats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: Optional[str] = Query(None),
):
    query = select(Chat)

    # Filter by owner for non-superadmins
    if user.role != UserRole.SUPERADMIN:
        query = query.where(Chat.owner_id == user.id)

    if search:
        query = query.where(Chat.title.ilike(f"%{search}%"))

    query = query.order_by(Chat.updated_at.desc())

    result = await db.execute(query)
    chats = result.scalars().all()

    response = []
    for chat in chats:
        # Get message count
        msg_count_result = await db.execute(
            select(func.count(Message.id)).where(Message.chat_db_id == chat.id)
        )
        messages_count = msg_count_result.scalar() or 0

        # Get unique users count
        users_count_result = await db.execute(
            select(func.count(distinct(Message.user_id))).where(Message.chat_db_id == chat.id)
        )
        users_count = users_count_result.scalar() or 0

        # Get last message time
        last_msg_result = await db.execute(
            select(Message.created_at)
            .where(Message.chat_db_id == chat.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_message_at = last_msg_result.scalar()

        response.append(ChatResponse(
            id=chat.id,
            chat_id=chat.chat_id,
            title=chat.title,
            criteria=chat.criteria,
            owner_id=chat.owner_id,
            owner_name=chat.owner.name if chat.owner else None,
            is_active=chat.is_active,
            messages_count=messages_count,
            users_count=users_count,
            last_message_at=last_message_at,
            created_at=chat.created_at,
        ))

    return response


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get stats
    msg_count = await db.execute(
        select(func.count(Message.id)).where(Message.chat_db_id == chat.id)
    )
    users_count = await db.execute(
        select(func.count(distinct(Message.user_id))).where(Message.chat_db_id == chat.id)
    )
    last_msg = await db.execute(
        select(Message.created_at)
        .where(Message.chat_db_id == chat.id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )

    return ChatResponse(
        id=chat.id,
        chat_id=chat.chat_id,
        title=chat.title,
        criteria=chat.criteria,
        owner_id=chat.owner_id,
        owner_name=chat.owner.name if chat.owner else None,
        is_active=chat.is_active,
        messages_count=msg_count.scalar() or 0,
        users_count=users_count.scalar() or 0,
        last_message_at=last_msg.scalar(),
        created_at=chat.created_at,
    )


@router.patch("/{chat_id}", response_model=ChatResponse)
async def update_chat(
    chat_id: int,
    data: ChatUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    if data.criteria is not None:
        chat.criteria = data.criteria

    if data.is_active is not None:
        chat.is_active = data.is_active

    # Only superadmin can reassign chats
    if data.owner_id is not None and user.role == UserRole.SUPERADMIN:
        chat.owner_id = data.owner_id

    await db.commit()
    await db.refresh(chat)

    return ChatResponse(
        id=chat.id,
        chat_id=chat.chat_id,
        title=chat.title,
        criteria=chat.criteria,
        owner_id=chat.owner_id,
        owner_name=chat.owner.name if chat.owner else None,
        is_active=chat.is_active,
        messages_count=0,
        users_count=0,
        last_message_at=None,
        created_at=chat.created_at,
    )


@router.get("/{chat_id}/messages", response_model=List[MessageResponse])
async def get_chat_messages(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(Message)
        .where(Message.chat_db_id == chat_id)
        .order_by(Message.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=msg.id,
            user_id=msg.user_id,
            username=msg.username,
            first_name=msg.first_name,
            last_name=msg.last_name,
            message_type=msg.message_type,
            content=msg.content,
            created_at=msg.created_at,
        )
        for msg in reversed(messages)
    ]


@router.get("/{chat_id}/participants", response_model=List[ChatParticipant])
async def get_chat_participants(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(
            Message.user_id,
            Message.username,
            Message.first_name,
            Message.last_name,
            func.count(Message.id).label("messages_count")
        )
        .where(Message.chat_db_id == chat_id)
        .group_by(Message.user_id, Message.username, Message.first_name, Message.last_name)
        .order_by(func.count(Message.id).desc())
    )
    participants = result.all()

    return [
        ChatParticipant(
            user_id=p.user_id,
            username=p.username,
            first_name=p.first_name,
            last_name=p.last_name,
            messages_count=p.messages_count,
        )
        for p in participants
    ]


@router.post("/{chat_id}/analyze", response_model=AnalysisResponse)
async def analyze_chat(
    chat_id: int,
    request: AnalysisRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get messages
    messages_result = await db.execute(
        select(Message)
        .where(Message.chat_db_id == chat_id)
        .order_by(Message.created_at)
    )
    messages = messages_result.scalars().all()

    # Get participants
    participants_result = await db.execute(
        select(
            Message.user_id,
            Message.username,
            Message.first_name,
            Message.last_name,
            func.count(Message.id).label("messages_count")
        )
        .where(Message.chat_db_id == chat_id)
        .group_by(Message.user_id, Message.username, Message.first_name, Message.last_name)
    )
    participants = [
        {
            "user_id": p.user_id,
            "username": p.username,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "messages_count": p.messages_count,
        }
        for p in participants_result.all()
    ]

    # Perform analysis
    if request.analysis_type == "question" and request.question:
        result_text = await analyzer_service.ask_question(
            messages=messages,
            question=request.question,
            chat_title=chat.title,
        )
    else:
        result_text = await analyzer_service.analyze_chat(
            messages=messages,
            participants=participants,
            chat_title=chat.title,
            criteria=chat.criteria,
        )

    # Save to history
    history = AnalysisHistory(
        chat_id=chat.id,
        user_id=user.id,
        analysis_type=request.analysis_type,
        question=request.question,
        result=result_text,
    )
    db.add(history)
    await db.commit()
    await db.refresh(history)

    return AnalysisResponse(
        id=history.id,
        analysis_type=history.analysis_type,
        question=history.question,
        result=history.result,
        created_at=history.created_at,
    )


@router.get("/{chat_id}/history", response_model=List[AnalysisResponse])
async def get_analysis_history(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(20, le=100),
):
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
        .limit(limit)
    )
    history = result.scalars().all()

    return [
        AnalysisResponse(
            id=h.id,
            analysis_type=h.analysis_type,
            question=h.question,
            result=h.result,
            created_at=h.created_at,
        )
        for h in history
    ]
