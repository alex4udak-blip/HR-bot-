from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from ..database import get_db
from ..models.database import (
    User, UserRole, Chat, DepartmentMember, OrgMember, SharedAccess,
    Message, ChatCriteria, AnalysisHistory, AIConversation, Entity,
    EntityTransfer, CallRecording, Invitation
)
from ..models.schemas import UserCreate, UserUpdate, UserResponse
from ..services.auth import get_superadmin, hash_password

router = APIRouter()


@router.get("", response_model=List[UserResponse])
async def get_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin)
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()

    # Get chat counts for all users
    chat_counts = {}
    count_result = await db.execute(
        select(Chat.owner_id, func.count(Chat.id))
        .group_by(Chat.owner_id)
    )
    for owner_id, count in count_result.all():
        chat_counts[owner_id] = count

    return [
        UserResponse(
            id=u.id, email=u.email, name=u.name, role=u.role.value,
            telegram_id=u.telegram_id, telegram_username=u.telegram_username,
            is_active=u.is_active, created_at=u.created_at,
            chats_count=chat_counts.get(u.id, 0)
        ) for u in users
    ]


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin)
):
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email exists")

    if data.telegram_id:
        result = await db.execute(select(User).where(User.telegram_id == data.telegram_id))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Telegram ID exists")

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        name=data.name,
        role=UserRole.SUPERADMIN if data.role == "superadmin" else UserRole.ADMIN,
        telegram_id=data.telegram_id,
        telegram_username=data.telegram_username,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id, email=user.email, name=user.name, role=user.role.value,
        telegram_id=user.telegram_id, telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at, chats_count=0
    )


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin)
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.email:
        user.email = data.email
    if data.name:
        user.name = data.name
    if data.role:
        user.role = UserRole.SUPERADMIN if data.role == "superadmin" else UserRole.ADMIN
    if data.telegram_id is not None:
        user.telegram_id = data.telegram_id
    if data.telegram_username is not None:
        user.telegram_username = data.telegram_username
    if data.is_active is not None:
        user.is_active = data.is_active

    await db.commit()
    await db.refresh(user)

    # Get chat count
    count_result = await db.execute(
        select(func.count(Chat.id)).where(Chat.owner_id == user.id)
    )
    chats_count = count_result.scalar() or 0

    return UserResponse(
        id=user.id, email=user.email, name=user.name, role=user.role.value,
        telegram_id=user.telegram_id, telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at,
        chats_count=chats_count
    )


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superadmin)
):
    current = await db.merge(current)
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Delete/nullify all related records first
    from sqlalchemy import update

    # Delete records where user is required (NOT NULL)
    await db.execute(delete(DepartmentMember).where(DepartmentMember.user_id == user_id))
    await db.execute(delete(OrgMember).where(OrgMember.user_id == user_id))
    await db.execute(delete(SharedAccess).where(SharedAccess.shared_with_id == user_id))
    await db.execute(delete(SharedAccess).where(SharedAccess.shared_by_id == user_id))
    await db.execute(delete(ChatCriteria).where(ChatCriteria.user_id == user_id))
    await db.execute(delete(AnalysisHistory).where(AnalysisHistory.user_id == user_id))
    await db.execute(delete(AIConversation).where(AIConversation.user_id == user_id))

    # Nullify optional foreign keys
    await db.execute(update(Chat).where(Chat.owner_id == user_id).values(owner_id=None))
    await db.execute(update(CallRecording).where(CallRecording.owner_id == user_id).values(owner_id=None))
    await db.execute(update(Entity).where(Entity.created_by == user_id).values(created_by=None))
    await db.execute(update(EntityTransfer).where(EntityTransfer.from_user_id == user_id).values(from_user_id=None))
    await db.execute(update(EntityTransfer).where(EntityTransfer.to_user_id == user_id).values(to_user_id=None))
    await db.execute(update(OrgMember).where(OrgMember.invited_by == user_id).values(invited_by=None))
    await db.execute(update(Invitation).where(Invitation.invited_by_id == user_id).values(invited_by_id=None))
    await db.execute(update(Invitation).where(Invitation.used_by_id == user_id).values(used_by_id=None))

    await db.delete(user)
    await db.commit()
