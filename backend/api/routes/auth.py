from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models.database import User
from ..models.schemas import (
    LoginRequest, TokenResponse, ChangePasswordRequest,
    LinkTelegramRequest, UserResponse
)
from ..services.auth import (
    authenticate_user, create_access_token, get_current_user,
    hash_password, verify_password
)

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, request.email, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=user.id, email=user.email, name=user.name,
            role=user.role.value, telegram_id=user.telegram_id,
            telegram_username=user.telegram_username,
            is_active=user.is_active, created_at=user.created_at,
            chats_count=len(user.chats) if user.chats else 0
        )
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=user.id, email=user.email, name=user.name,
        role=user.role.value, telegram_id=user.telegram_id,
        telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at,
        chats_count=len(user.chats) if user.chats else 0
    )


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if not verify_password(request.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Wrong current password")

    user.password_hash = hash_password(request.new_password)
    await db.commit()
    return {"message": "Password changed"}


@router.post("/link-telegram")
async def link_telegram(
    request: LinkTelegramRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check if telegram_id already used
    result = await db.execute(
        select(User).where(User.telegram_id == request.telegram_id, User.id != user.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Telegram ID already linked")

    user.telegram_id = request.telegram_id
    user.telegram_username = request.telegram_username
    await db.commit()
    return {"message": "Telegram linked"}
