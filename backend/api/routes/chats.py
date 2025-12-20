from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message, ChatCriteria
from ..models.schemas import ChatResponse, ChatUpdate, ChatTypeConfig
from ..services.auth import get_current_user
from ..services.chat_types import (
    get_all_chat_types, get_chat_type_config, get_quick_actions,
    get_suggested_questions, get_default_criteria
)

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


@router.get("/types", response_model=List[Dict[str, Any]])
async def get_chat_types():
    """Get all available chat types."""
    return get_all_chat_types()


@router.get("/types/{type_id}")
async def get_chat_type_details(type_id: str):
    """Get detailed configuration for a chat type."""
    config = get_chat_type_config(type_id)
    return {
        "type_info": {
            "id": type_id,
            "name": config["name"],
            "description": config["description"],
            "icon": config["icon"],
            "color": config["color"],
        },
        "quick_actions": get_quick_actions(type_id),
        "suggested_questions": get_suggested_questions(type_id),
        "default_criteria": get_default_criteria(type_id),
    }


@router.get("", response_model=List[ChatResponse])
async def get_chats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: str = Query(None),
    chat_type: str = Query(None, description="Filter by chat type"),
):
    # Merge detached user into current session
    user = await db.merge(user)

    query = select(Chat).options(selectinload(Chat.owner))
    if user.role != UserRole.SUPERADMIN:
        query = query.where(Chat.owner_id == user.id)
    if search:
        query = query.where(Chat.title.ilike(f"%{search}%"))
    if chat_type:
        query = query.where(Chat.chat_type == chat_type)
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
            chat_type=chat.chat_type.value if chat.chat_type else "hr",
            custom_type_name=chat.custom_type_name,
            custom_type_description=chat.custom_type_description,
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
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)

    result = await db.execute(
        select(Chat).options(selectinload(Chat.owner)).where(Chat.id == chat_id)
    )
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
        chat_type=chat.chat_type.value if chat.chat_type else "hr",
        custom_type_name=chat.custom_type_name,
        custom_type_description=chat.custom_type_description,
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
    user: User = Depends(get_current_user),
):
    from ..models.database import ChatType
    user = await db.merge(user)

    result = await db.execute(
        select(Chat).options(selectinload(Chat.owner)).where(Chat.id == chat_id)
    )
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
    if data.chat_type is not None:
        try:
            chat.chat_type = ChatType(data.chat_type)
        except ValueError:
            chat.chat_type = ChatType.custom
    if data.custom_type_name is not None:
        chat.custom_type_name = data.custom_type_name
    if data.custom_type_description is not None:
        chat.custom_type_description = data.custom_type_description

    await db.commit()
    await db.refresh(chat)

    return ChatResponse(
        id=chat.id,
        telegram_chat_id=chat.telegram_chat_id,
        title=chat.title,
        custom_name=chat.custom_name,
        chat_type=chat.chat_type.value if chat.chat_type else "hr",
        custom_type_name=chat.custom_type_name,
        custom_type_description=chat.custom_type_description,
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
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)

    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    await db.execute(Message.__table__.delete().where(Message.chat_id == chat_id))
    await db.commit()


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a chat and all its messages."""
    user = await db.merge(user)

    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete related data first
    await db.execute(Message.__table__.delete().where(Message.chat_id == chat_id))
    await db.execute(ChatCriteria.__table__.delete().where(ChatCriteria.chat_id == chat_id))

    # Delete the chat
    await db.delete(chat)
    await db.commit()
