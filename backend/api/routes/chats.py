from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message, ChatCriteria
from ..models.schemas import ChatResponse, ChatUpdate

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


@router.get("", response_model=List[ChatResponse])
async def get_chats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(__import__('api.services.auth', fromlist=['get_current_user']).get_current_user),
    search: str = Query(None),
):
    from ..services.auth import get_current_user

    query = select(Chat)
    if user.role != UserRole.SUPERADMIN:
        query = query.where(Chat.owner_id == user.id)
    if search:
        query = query.where(Chat.title.ilike(f"%{search}%"))
    query = query.order_by(Chat.last_activity.desc())

    result = await db.execute(query)
    chats = result.scalars().all()

    response = []
    for chat in chats:
        msg_count = await db.execute(
            select(func.count(Message.id)).where(Message.chat_id == chat.id)
        )
        part_count = await db.execute(
            select(func.count(distinct(Message.telegram_user_id))).where(Message.chat_id == chat.id)
        )
        has_crit = await db.execute(
            select(ChatCriteria.id).where(ChatCriteria.chat_id == chat.id)
        )

        response.append(ChatResponse(
            id=chat.id,
            telegram_chat_id=chat.telegram_chat_id,
            title=chat.title,
            custom_name=chat.custom_name,
            owner_id=chat.owner_id,
            owner_name=chat.owner.name if chat.owner else None,
            is_active=chat.is_active,
            messages_count=msg_count.scalar() or 0,
            participants_count=part_count.scalar() or 0,
            last_activity=chat.last_activity,
            created_at=chat.created_at,
            has_criteria=has_crit.scalar() is not None,
        ))

    return response


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(__import__('api.services.auth', fromlist=['get_current_user']).get_current_user),
):
    from ..services.auth import get_current_user

    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    msg_count = await db.execute(
        select(func.count(Message.id)).where(Message.chat_id == chat.id)
    )
    part_count = await db.execute(
        select(func.count(distinct(Message.telegram_user_id))).where(Message.chat_id == chat.id)
    )
    has_crit = await db.execute(
        select(ChatCriteria.id).where(ChatCriteria.chat_id == chat.id)
    )

    return ChatResponse(
        id=chat.id,
        telegram_chat_id=chat.telegram_chat_id,
        title=chat.title,
        custom_name=chat.custom_name,
        owner_id=chat.owner_id,
        owner_name=chat.owner.name if chat.owner else None,
        is_active=chat.is_active,
        messages_count=msg_count.scalar() or 0,
        participants_count=part_count.scalar() or 0,
        last_activity=chat.last_activity,
        created_at=chat.created_at,
        has_criteria=has_crit.scalar() is not None,
    )


@router.patch("/{chat_id}", response_model=ChatResponse)
async def update_chat(
    chat_id: int,
    data: ChatUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(__import__('api.services.auth', fromlist=['get_current_user']).get_current_user),
):
    from ..services.auth import get_current_user

    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    if data.custom_name is not None:
        chat.custom_name = data.custom_name
    if data.is_active is not None:
        chat.is_active = data.is_active
    if data.owner_id is not None and user.role == UserRole.SUPERADMIN:
        chat.owner_id = data.owner_id

    await db.commit()
    await db.refresh(chat)

    return ChatResponse(
        id=chat.id,
        telegram_chat_id=chat.telegram_chat_id,
        title=chat.title,
        custom_name=chat.custom_name,
        owner_id=chat.owner_id,
        owner_name=chat.owner.name if chat.owner else None,
        is_active=chat.is_active,
        messages_count=0,
        participants_count=0,
        last_activity=chat.last_activity,
        created_at=chat.created_at,
        has_criteria=False,
    )


@router.delete("/{chat_id}/messages", status_code=204)
async def clear_messages(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(__import__('api.services.auth', fromlist=['get_current_user']).get_current_user),
):
    from ..services.auth import get_current_user

    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    await db.execute(Message.__table__.delete().where(Message.chat_id == chat_id))
    await db.commit()
