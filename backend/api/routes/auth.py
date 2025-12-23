from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models.database import User, UserRole
from ..models.schemas import (
    LoginRequest, TokenResponse, ChangePasswordRequest,
    LinkTelegramRequest, UserResponse, UserCreate
)
from ..services.auth import (
    authenticate_user, create_access_token, get_current_user,
    hash_password, verify_password
)
from ..services.password_policy import validate_password
from ..limiter import limiter

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(
    request: Request,
    login_request: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    from datetime import datetime, timedelta

    # First, get the user by email (to check lockout status)
    result = await db.execute(select(User).where(User.email == login_request.email))
    user = result.scalar_one_or_none()

    # Check if account is locked
    if user and user.locked_until:
        if datetime.utcnow() < user.locked_until:
            # Account is still locked
            remaining_minutes = int((user.locked_until - datetime.utcnow()).total_seconds() / 60) + 1
            raise HTTPException(
                status_code=423,
                detail=f"Account locked. Try again after {remaining_minutes} minutes"
            )
        else:
            # Lockout expired, reset the lockout fields
            user.locked_until = None
            user.failed_login_attempts = 0
            await db.commit()

    # Authenticate user
    authenticated_user = await authenticate_user(db, login_request.email, login_request.password)

    if not authenticated_user:
        # Failed login - increment counter and potentially lock account
        if user:
            user.failed_login_attempts += 1

            # Lock account after 5 failed attempts
            if user.failed_login_attempts >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=15)
                await db.commit()
                raise HTTPException(
                    status_code=423,
                    detail="Account locked due to too many failed login attempts. Try again after 15 minutes"
                )

            await db.commit()

        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Successful login - reset failed attempts counter
    authenticated_user.failed_login_attempts = 0
    authenticated_user.locked_until = None
    await db.commit()

    token = create_access_token({
        "sub": str(authenticated_user.id),
        "token_version": authenticated_user.token_version
    })
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=authenticated_user.id, email=authenticated_user.email, name=authenticated_user.name,
            role=authenticated_user.role.value, telegram_id=authenticated_user.telegram_id,
            telegram_username=authenticated_user.telegram_username,
            is_active=authenticated_user.is_active, created_at=authenticated_user.created_at,
            chats_count=0  # Skip lazy loading for login
        )
    )


# Registration disabled - only superadmin can create users via /api/users
# @router.post("/register", response_model=TokenResponse)
# async def register(request: UserCreate, db: AsyncSession = Depends(get_db)):
#     ...


@router.post("/register")
@limiter.limit("3/minute")
async def register(request: Request):
    """Public registration is disabled. Contact superadmin to create an account."""
    raise HTTPException(
        status_code=403,
        detail="Регистрация отключена. Обратитесь к администратору для создания аккаунта."
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=user.id, email=user.email, name=user.name,
        role=user.role.value, telegram_id=user.telegram_id,
        telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at,
        chats_count=0  # Skip lazy loading
    )


@router.post("/change-password")
@limiter.limit("3/minute")
async def change_password(
    request: Request,
    password_request: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if not verify_password(password_request.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Wrong current password")

    # Validate new password
    is_valid, error_message = validate_password(password_request.new_password, user.email)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_message)

    user.password_hash = hash_password(password_request.new_password)
    # Increment token_version to invalidate all existing tokens
    user.token_version += 1
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
