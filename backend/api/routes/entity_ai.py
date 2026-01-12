"""
Entity AI Routes - API endpoints for Entity AI assistant.

Provides:
- GET /entities/{id}/ai/actions - Get available quick actions
- POST /entities/{id}/ai/message - Send message (streaming)
- GET /entities/{id}/ai/history - Get conversation history
- DELETE /entities/{id}/ai/history - Clear conversation history
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel
import json
import logging

from ..database import get_db
from ..models.database import (
    User, UserRole, Entity, Chat, Message, CallRecording,
    EntityAIConversation, EntityCriteria, AnalysisHistory
)
from ..services.auth import get_current_user
from ..services.entity_ai import entity_ai_service
from ..services.reports import generate_pdf_report, generate_docx_report

logger = logging.getLogger("hr-analyzer.entity-ai-routes")

router = APIRouter()


class EntityAIMessageRequest(BaseModel):
    message: Optional[str] = None
    quick_action: Optional[str] = None


class EntityReportRequest(BaseModel):
    report_type: str = "full_analysis"
    format: str = "pdf"  # pdf, docx, markdown


async def get_entity_with_data(db: AsyncSession, entity_id: int):
    """Get entity with all related chats (with messages) and calls"""
    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        return None, [], []

    # Get chats with messages, owner, and entity for participant identification
    result = await db.execute(
        select(Chat)
        .options(
            selectinload(Chat.messages),
            selectinload(Chat.owner),
            selectinload(Chat.entity)
        )
        .where(Chat.entity_id == entity_id, Chat.deleted_at.is_(None))
        .order_by(Chat.created_at)
    )
    chats = list(result.scalars().all())

    # Get calls
    result = await db.execute(
        select(CallRecording)
        .where(CallRecording.entity_id == entity_id)
        .order_by(CallRecording.created_at)
    )
    calls = list(result.scalars().all())

    return entity, chats, calls


async def can_access_entity(user: User, entity: Entity, db: AsyncSession) -> bool:
    """Check if user can access entity.

    Uses the proper role hierarchy:
    1. SUPERADMIN - sees everything
    2. OWNER - sees everything in org (except superadmin private content)
    3. ADMIN/SUB_ADMIN - sees department data
    4. MEMBER - sees own resources and shared
    """
    from .entities import check_entity_access

    # Get org_id from entity
    org_id = entity.org_id
    if not org_id:
        # Fallback: only owner or superadmin can access
        if user.role == UserRole.superadmin:
            return True
        return entity.created_by == user.id

    return await check_entity_access(entity, user, org_id, db)


@router.get("/entities/{entity_id}/ai/actions")
async def get_available_actions(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get available quick actions for entity AI"""
    user = await db.merge(user)

    # Check entity exists
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "actions": entity_ai_service.get_available_actions()
    }


@router.post("/entities/{entity_id}/ai/message")
async def entity_ai_message(
    entity_id: int,
    request: EntityAIMessageRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """AI assistant message with streaming response"""
    user = await db.merge(user)

    # Get entity with all data
    entity, chats, calls = await get_entity_with_data(db, entity_id)

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate request
    if not request.message and not request.quick_action:
        raise HTTPException(status_code=400, detail="message or quick_action required")

    # Get or create conversation
    result = await db.execute(
        select(EntityAIConversation).where(
            EntityAIConversation.entity_id == entity_id,
            EntityAIConversation.user_id == user.id
        )
    )
    conversation = result.scalar_one_or_none()

    if not conversation:
        conversation = EntityAIConversation(
            entity_id=entity_id,
            user_id=user.id,
            messages=[]
        )
        db.add(conversation)
        await db.flush()

    history = conversation.messages or []

    async def generate():
        full_response = ""
        try:
            if request.quick_action:
                # Quick action
                async for chunk in entity_ai_service.quick_action(
                    request.quick_action, entity, chats, calls
                ):
                    full_response += chunk
                    yield f"data: {json.dumps({'content': chunk})}\n\n"
            else:
                # Regular chat
                async for chunk in entity_ai_service.chat_stream(
                    request.message, entity, chats, calls, history
                ):
                    full_response += chunk
                    yield f"data: {json.dumps({'content': chunk})}\n\n"

        except Exception as e:
            logger.exception(f"Entity AI error: {e}")
            yield f"data: {json.dumps({'content': f'Ошибка: {str(e)}', 'error': True})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Save to conversation history
        try:
            # Re-fetch conversation to avoid stale data
            result = await db.execute(
                select(EntityAIConversation).where(
                    EntityAIConversation.entity_id == entity_id,
                    EntityAIConversation.user_id == user.id
                )
            )
            conv = result.scalar_one_or_none()
            if conv:
                new_messages = list(conv.messages or [])

                # Add user message
                user_content = f"[{request.quick_action}]" if request.quick_action else request.message
                new_messages.append({
                    "role": "user",
                    "content": user_content,
                    "timestamp": datetime.utcnow().isoformat()
                })

                # Add assistant response
                new_messages.append({
                    "role": "assistant",
                    "content": full_response,
                    "timestamp": datetime.utcnow().isoformat()
                })

                conv.messages = new_messages
                flag_modified(conv, "messages")
                await db.commit()
        except Exception as e:
            logger.error(f"Failed to save conversation: {e}")

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/entities/{entity_id}/ai/history")
async def get_entity_ai_history(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get AI conversation history for entity"""
    user = await db.merge(user)

    # Check entity exists and access
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get conversation
    result = await db.execute(
        select(EntityAIConversation).where(
            EntityAIConversation.entity_id == entity_id,
            EntityAIConversation.user_id == user.id
        )
    )
    conversation = result.scalar_one_or_none()

    if not conversation:
        return {"messages": []}

    return {"messages": conversation.messages or []}


@router.delete("/entities/{entity_id}/ai/history")
async def clear_entity_ai_history(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Clear AI conversation history for entity"""
    user = await db.merge(user)

    # Check entity exists and access
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete conversation
    result = await db.execute(
        select(EntityAIConversation).where(
            EntityAIConversation.entity_id == entity_id,
            EntityAIConversation.user_id == user.id
        )
    )
    conversation = result.scalar_one_or_none()

    if conversation:
        await db.delete(conversation)
        await db.commit()

    return {"success": True}


@router.post("/entities/{entity_id}/ai/update-summary")
async def update_entity_ai_summary(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Manually trigger AI summary update for entity.

    This creates/updates the ai_summary field based on all chats and calls.
    Useful for rebuilding context after significant interactions.
    """
    from ..services.entity_memory import entity_memory_service
    from ..services.cache import format_messages_optimized

    user = await db.merge(user)

    # Get entity with all data
    entity, chats, calls = await get_entity_with_data(db, entity_id)

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Build content for summarization
    content_parts = []

    # Add chat messages
    for chat in chats:
        if hasattr(chat, 'messages') and chat.messages:
            messages = sorted(chat.messages, key=lambda m: m.timestamp)[-50:]
            content_parts.append(f"Чат {chat.title}:\n{format_messages_optimized(messages, max_per_message=300)}")

    # Add call summaries
    for call in calls:
        if call.summary:
            content_parts.append(f"Звонок {call.title}: {call.summary}")

    content = "\n\n".join(content_parts)

    if not content:
        return {"success": False, "error": "No content to summarize"}

    # Update summary
    new_summary = await entity_memory_service.update_summary(entity, content, db)

    # Extract key events
    new_events = await entity_memory_service.extract_key_events(entity, content, db)

    return {
        "success": True,
        "summary": new_summary,
        "new_events_count": len(new_events),
        "total_events": len(entity.key_events or [])
    }


@router.get("/entities/{entity_id}/ai/memory")
async def get_entity_ai_memory(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get entity AI memory (summary + key events)."""
    user = await db.merge(user)

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "summary": entity.ai_summary,
        "summary_updated_at": entity.ai_summary_updated_at.isoformat() if entity.ai_summary_updated_at else None,
        "key_events": entity.key_events or []
    }


@router.post("/entities/ai/batch-update-summaries")
async def batch_update_entity_summaries(
    limit: int = 10,
    only_empty: bool = True,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Batch update AI summaries for multiple entities.

    Args:
        limit: Max entities to process (default 10, max 50)
        only_empty: Only process entities without summaries (default True)

    This is useful for:
    - Initial setup: generate summaries for existing entities
    - Periodic refresh: update old summaries
    """
    from ..services.entity_memory import entity_memory_service
    from ..services.cache import format_messages_optimized

    user = await db.merge(user)

    # Check if user has admin-level access (org admin, dept lead, or superadmin)
    from ..services.auth import get_user_org, get_user_org_role
    from ..models.database import OrgRole, DepartmentMember, DeptRole

    is_admin = False
    if user.role == UserRole.superadmin:
        is_admin = True
    else:
        # Check org role
        org = await get_user_org(user, db)
        if org:
            org_role = await get_user_org_role(user, org.id, db)
            if org_role in ("owner", "admin"):
                is_admin = True

        # Check department role
        if not is_admin:
            result = await db.execute(
                select(DepartmentMember).where(
                    DepartmentMember.user_id == user.id,
                    DepartmentMember.role.in_([DeptRole.lead, DeptRole.sub_admin])
                )
            )
            if result.scalar_one_or_none():
                is_admin = True

    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    limit = min(limit, 50)  # Cap at 50

    # Get entities to update
    query = select(Entity).where(Entity.created_by == user.id)

    if only_empty:
        query = query.where(Entity.ai_summary.is_(None))

    query = query.limit(limit)

    result = await db.execute(query)
    entities = list(result.scalars().all())

    updated = []
    errors = []

    for entity in entities:
        try:
            # Get entity data
            entity_obj, chats, calls = await get_entity_with_data(db, entity.id)

            # Build content
            content_parts = []
            for chat in chats:
                if hasattr(chat, 'messages') and chat.messages:
                    messages = sorted(chat.messages, key=lambda m: m.timestamp)[-50:]
                    content_parts.append(f"Чат {chat.title}:\n{format_messages_optimized(messages, max_per_message=300)}")

            for call in calls:
                if call.summary:
                    content_parts.append(f"Звонок {call.title}: {call.summary}")

            content = "\n\n".join(content_parts)

            if content:
                await entity_memory_service.update_summary(entity_obj, content, db)
                await entity_memory_service.extract_key_events(entity_obj, content, db)
                updated.append({"id": entity.id, "name": entity.name})
            else:
                errors.append({"id": entity.id, "name": entity.name, "error": "No content"})

        except Exception as e:
            logger.error(f"Failed to update entity {entity.id}: {e}")
            errors.append({"id": entity.id, "name": entity.name, "error": str(e)})

    return {
        "updated_count": len(updated),
        "error_count": len(errors),
        "updated": updated,
        "errors": errors
    }


@router.post("/entities/{entity_id}/report")
async def generate_entity_report(
    entity_id: int,
    request: EntityReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Generate downloadable report for entity.

    Generates a comprehensive report analyzing all chats and calls
    associated with this entity.
    """
    from ..services.cache import format_messages_optimized

    user = await db.merge(user)

    # Get entity with all data
    entity, chats, calls = await get_entity_with_data(db, entity_id)

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if not await can_access_entity(user, entity, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get criteria if exists
    result = await db.execute(
        select(EntityCriteria).where(EntityCriteria.entity_id == entity_id)
    )
    criteria_obj = result.scalar_one_or_none()
    criteria = criteria_obj.criteria if criteria_obj else []

    # Build content for analysis
    content_parts = []

    # Add entity info
    content_parts.append(f"# Контакт: {entity.name}")
    if entity.company:
        content_parts.append(f"Компания: {entity.company}")
    if entity.position:
        content_parts.append(f"Должность: {entity.position}")
    if entity.ai_summary:
        content_parts.append(f"\n## Общее резюме\n{entity.ai_summary}")

    # Add chat messages
    for chat in chats:
        if hasattr(chat, 'messages') and chat.messages:
            messages = sorted(chat.messages, key=lambda m: m.timestamp)[-100:]
            content_parts.append(f"\n## Чат: {chat.title}\n{format_messages_optimized(messages, max_per_message=500)}")

    # Add call summaries
    for call in calls:
        call_info = f"\n## Звонок: {call.title or 'Без названия'}"
        if call.summary:
            call_info += f"\n{call.summary}"
        content_parts.append(call_info)

    content = "\n\n".join(content_parts)

    if not content:
        raise HTTPException(status_code=400, detail="No data to generate report")

    # Generate report using AI
    report_content = await entity_ai_service.generate_entity_report(
        entity, chats, calls, criteria, request.report_type
    )

    # Save to analysis history
    analysis = AnalysisHistory(
        entity_id=entity_id,
        user_id=user.id,
        result=report_content,
        report_type=request.report_type,
        report_format=request.format,
        criteria_used=criteria,
    )
    db.add(analysis)
    await db.commit()

    # Generate file
    title = entity.name

    if request.format == "pdf":
        file_bytes = generate_pdf_report(title, report_content, entity.name)
        return Response(
            content=file_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="report_{entity_id}.pdf"'}
        )
    elif request.format == "docx":
        file_bytes = generate_docx_report(title, report_content, entity.name)
        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="report_{entity_id}.docx"'}
        )
    else:
        return Response(
            content=report_content,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="report_{entity_id}.md"'}
        )
