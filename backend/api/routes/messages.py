from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message
from ..models.schemas import MessageResponse, ParticipantResponse
from ..services.auth import get_current_user

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


@router.get("/{chat_id}/messages", response_model=List[MessageResponse])
async def get_messages(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    limit: int = Query(50, le=200),
    content_type: str = Query(None),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    query = select(Message).where(Message.chat_id == chat_id)
    if content_type and content_type != "all":
        query = query.where(Message.content_type == content_type)

    query = query.order_by(Message.timestamp.desc()).offset((page - 1) * limit).limit(limit)

    result = await db.execute(query)
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=m.id,
            telegram_user_id=m.telegram_user_id,
            username=m.username,
            first_name=m.first_name,
            last_name=m.last_name,
            content=m.content,
            content_type=m.content_type,
            file_name=m.file_name,
            timestamp=m.timestamp,
        ) for m in reversed(messages)
    ]


@router.get("/{chat_id}/participants", response_model=List[ParticipantResponse])
async def get_participants(
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
            Message.telegram_user_id,
            Message.username,
            Message.first_name,
            Message.last_name,
            func.count(Message.id).label("count")
        )
        .where(Message.chat_id == chat_id)
        .group_by(
            Message.telegram_user_id,
            Message.username,
            Message.first_name,
            Message.last_name
        )
        .order_by(func.count(Message.id).desc())
    )
    participants = result.all()

    return [
        ParticipantResponse(
            telegram_user_id=p.telegram_user_id,
            username=p.username,
            first_name=p.first_name,
            last_name=p.last_name,
            messages_count=p.count,
        ) for p in participants
    ]
