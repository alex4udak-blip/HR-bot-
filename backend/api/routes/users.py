from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..models.database import User, UserRole, Chat
from ..models.schemas import UserCreate, UserUpdate, UserResponse
from ..services.auth import get_superadmin, hash_password

router = APIRouter()


@router.get("", response_model=List[UserResponse])
async def get_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()

    return [
        UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role.value,
            telegram_id=user.telegram_id,
            is_active=user.is_active,
            created_at=user.created_at,
            chats_count=len(user.chats) if user.chats else 0,
        )
        for user in users
    ]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin),
):
    # Check if email exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Check if telegram_id exists
    if user_data.telegram_id:
        result = await db.execute(
            select(User).where(User.telegram_id == user_data.telegram_id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Telegram ID already registered",
            )

    role = UserRole.SUPERADMIN if user_data.role == "superadmin" else UserRole.ADMIN

    user = User(
        email=user_data.email,
        password_hash=hash_password(user_data.password),
        name=user_data.name,
        role=role,
        telegram_id=user_data.telegram_id,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        telegram_id=user.telegram_id,
        is_active=user.is_active,
        created_at=user.created_at,
        chats_count=0,
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        telegram_id=user.telegram_id,
        is_active=user.is_active,
        created_at=user.created_at,
        chats_count=len(user.chats) if user.chats else 0,
    )


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user_data.email is not None:
        result = await db.execute(
            select(User).where(User.email == user_data.email, User.id != user_id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        user.email = user_data.email

    if user_data.name is not None:
        user.name = user_data.name

    if user_data.role is not None:
        user.role = UserRole.SUPERADMIN if user_data.role == "superadmin" else UserRole.ADMIN

    if user_data.telegram_id is not None:
        result = await db.execute(
            select(User).where(
                User.telegram_id == user_data.telegram_id,
                User.id != user_id
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Telegram ID already registered",
            )
        user.telegram_id = user_data.telegram_id

    if user_data.is_active is not None:
        user.is_active = user_data.is_active

    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        telegram_id=user.telegram_id,
        is_active=user.is_active,
        created_at=user.created_at,
        chats_count=len(user.chats) if user.chats else 0,
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_superadmin),
):
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Unassign chats from user
    await db.execute(
        Chat.__table__.update().where(Chat.owner_id == user_id).values(owner_id=None)
    )

    await db.delete(user)
    await db.commit()
