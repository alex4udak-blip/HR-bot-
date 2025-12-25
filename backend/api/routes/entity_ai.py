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
from fastapi.responses import StreamingResponse
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
    EntityAIConversation
)
from ..services.auth import get_current_user
from ..services.entity_ai import entity_ai_service

logger = logging.getLogger("hr-analyzer.entity-ai-routes")

router = APIRouter()


class EntityAIMessageRequest(BaseModel):
    message: Optional[str] = None
    quick_action: Optional[str] = None


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


def can_access_entity(user: User, entity: Entity) -> bool:
    """Check if user can access entity"""
    if user.role == UserRole.SUPERADMIN:
        return True
    # Admin can access entities they created
    if user.role == UserRole.ADMIN:
        return entity.created_by == user.id
    return False


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

    if not can_access_entity(user, entity):
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
    if not can_access_entity(user, entity):
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
    if not can_access_entity(user, entity):
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
    if not can_access_entity(user, entity):
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
