from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models.database import User, UserRole
from ..models.schemas import (
    LoginRequest, TokenResponse, ChangePasswordRequest,
    LinkTelegramRequest, UserResponse, UserCreate,
    RefreshTokenResponse, SessionResponse, SessionsListResponse, LogoutAllResponse
)
from ..services.auth import (
    authenticate_user, create_access_token, get_current_user,
    hash_password, verify_password,
    create_refresh_token, validate_refresh_token, revoke_refresh_token,
    revoke_all_user_tokens, rotate_refresh_token, get_user_sessions,
    get_refresh_token_record, create_short_lived_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS, _hash_token
)
from ..services.password_policy import validate_password
from ..limiter import limiter
from ..config import settings

router = APIRouter()


def is_secure_context(request: Request) -> bool:
    """Determine if the request is in a secure HTTPS context.

    Checks:
    1. X-Forwarded-Proto header (set by Railway and most proxies)
    2. Request URL scheme
    3. Falls back to settings.cookie_secure
    """
    # Check X-Forwarded-Proto header (most reliable behind proxy)
    forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
    if forwarded_proto == "https":
        return True
    if forwarded_proto == "http":
        return False

    # Check request scheme
    if request.url.scheme == "https":
        return True

    # Fall back to settings
    return settings.cookie_secure


def _get_device_name(request: Request) -> str:
    """Extract a user-friendly device name from User-Agent header."""
    user_agent = request.headers.get("user-agent", "Unknown Device")
    # Simple extraction - in production, use a proper user-agent parser
    if "Mobile" in user_agent or "Android" in user_agent or "iPhone" in user_agent:
        if "iPhone" in user_agent:
            return "iPhone"
        elif "Android" in user_agent:
            return "Android Device"
        return "Mobile Device"
    elif "Chrome" in user_agent:
        return "Chrome Browser"
    elif "Firefox" in user_agent:
        return "Firefox Browser"
    elif "Safari" in user_agent:
        return "Safari Browser"
    elif "Edge" in user_agent:
        return "Edge Browser"
    return "Unknown Device"


def _get_client_ip(request: Request) -> str:
    """Get the client's real IP address, handling proxies."""
    # Check X-Forwarded-For header (set by proxies/load balancers)
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        # Get the first IP in the chain (original client)
        return forwarded_for.split(",")[0].strip()

    # Check X-Real-IP header
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip

    # Fall back to direct connection IP
    if request.client:
        return request.client.host

    return "unknown"


@router.post("/login", response_model=UserResponse)
@limiter.limit("5/minute")
async def login(
    request: Request,
    response: Response,
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

    # Create short-lived access token (15 minutes)
    access_token = create_short_lived_access_token(
        user_id=authenticated_user.id,
        token_version=authenticated_user.token_version
    )

    # Create long-lived refresh token (7 days)
    device_name = _get_device_name(request)
    ip_address = _get_client_ip(request)
    refresh_token = await create_refresh_token(
        db,
        user_id=authenticated_user.id,
        device_name=device_name,
        ip_address=ip_address
    )

    # Determine if we should use secure flag based on request context
    use_secure = is_secure_context(request)

    # Set httpOnly cookie for access token (XSS protection)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,  # Not accessible via JavaScript - prevents XSS attacks
        secure=use_secure,  # Only send over HTTPS when in secure context
        samesite="lax",  # CSRF protection
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # 15 minutes
        path="/"
    )

    # Set httpOnly cookie for refresh token
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,  # Not accessible via JavaScript
        secure=use_secure,  # Only send over HTTPS when in secure context
        samesite="lax",  # CSRF protection
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # 7 days
        path="/api/auth"  # Only sent to auth endpoints (reduces attack surface)
    )

    # Return user info only (no tokens in response body)
    return UserResponse(
        id=authenticated_user.id, email=authenticated_user.email, name=authenticated_user.name,
        role=authenticated_user.role.value, telegram_id=authenticated_user.telegram_id,
        telegram_username=authenticated_user.telegram_username,
        is_active=authenticated_user.is_active, created_at=authenticated_user.created_at,
        chats_count=0,  # Skip lazy loading for login
        must_change_password=authenticated_user.must_change_password or False
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


@router.post("/logout")
async def logout(
    response: Response,
    refresh_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db)
):
    """Logout user by clearing cookies and revoking the refresh token."""
    # Revoke the refresh token if present
    if refresh_token:
        await revoke_refresh_token(db, refresh_token)

    # Clear both cookies
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/api/auth")

    return {"message": "Logged out successfully"}


@router.post("/refresh", response_model=RefreshTokenResponse)
@limiter.limit("30/minute")
async def refresh_access_token(
    request: Request,
    response: Response,
    refresh_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db)
):
    """Refresh the access token using a valid refresh token.

    This endpoint:
    1. Validates the refresh token from httpOnly cookie
    2. Rotates the refresh token (old one is revoked, new one is issued)
    3. Issues a new short-lived access token

    SECURITY: Token rotation prevents replay attacks and allows detection
    of token theft (if a revoked token is presented).
    """
    if not refresh_token:
        raise HTTPException(
            status_code=401,
            detail="Refresh token not provided"
        )

    # Get device/IP info for the new token
    device_name = _get_device_name(request)
    ip_address = _get_client_ip(request)

    # Rotate the refresh token (revokes old, creates new)
    result = await rotate_refresh_token(
        db,
        old_token=refresh_token,
        device_name=device_name,
        ip_address=ip_address
    )

    if not result:
        # Token was invalid, expired, or already revoked (potential theft)
        # Clear cookies as a security measure
        response.delete_cookie(key="access_token", path="/")
        response.delete_cookie(key="refresh_token", path="/api/auth")
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired refresh token"
        )

    new_refresh_token, user_id = result

    # Get user for token_version
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    if not user or not user.is_active:
        # User was deactivated
        response.delete_cookie(key="access_token", path="/")
        response.delete_cookie(key="refresh_token", path="/api/auth")
        raise HTTPException(
            status_code=401,
            detail="User account is inactive"
        )

    # Create new short-lived access token
    access_token = create_short_lived_access_token(
        user_id=user.id,
        token_version=user.token_version
    )

    # Determine secure flag
    use_secure = is_secure_context(request)

    # Set new access token cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=use_secure,
        samesite="lax",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/"
    )

    # Set new refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=use_secure,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/api/auth"
    )

    return RefreshTokenResponse(message="Token refreshed successfully")


@router.post("/logout-all", response_model=LogoutAllResponse)
async def logout_all_sessions(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Revoke all refresh tokens for the current user.

    This logs out the user from all devices/sessions.
    Use this when:
    - User suspects their account was compromised
    - User wants to log out from all devices
    - Password was changed and all sessions should be invalidated
    """
    revoked_count = await revoke_all_user_tokens(db, user.id)

    # Also clear the current session's cookies
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/api/auth")

    return LogoutAllResponse(
        message=f"Successfully logged out from {revoked_count} session(s)",
        revoked_count=revoked_count
    )


@router.get("/sessions", response_model=SessionsListResponse)
async def get_active_sessions(
    refresh_token: Optional[str] = Cookie(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get list of all active sessions for the current user.

    Returns information about all devices/browsers where the user is logged in.
    Useful for security audit and managing sessions.
    """
    sessions = await get_user_sessions(db, user.id)

    # Determine which session is the current one
    current_token_hash = _hash_token(refresh_token) if refresh_token else None

    session_responses = []
    for session in sessions:
        is_current = (current_token_hash == session.token_hash) if current_token_hash else False
        session_responses.append(SessionResponse(
            id=session.id,
            device_name=session.device_name,
            ip_address=session.ip_address,
            created_at=session.created_at,
            expires_at=session.expires_at,
            is_current=is_current
        ))

    return SessionsListResponse(
        sessions=session_responses,
        total=len(session_responses)
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=user.id, email=user.email, name=user.name,
        role=user.role.value, telegram_id=user.telegram_id,
        telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at,
        chats_count=0,  # Skip lazy loading
        must_change_password=user.must_change_password or False
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
    # Only invalidate tokens if this is a voluntary password change
    # If must_change_password was True (admin reset), user just logged in with fresh token
    # so we don't need to invalidate it
    if not user.must_change_password:
        user.token_version += 1
    # Clear the must_change_password flag if it was set
    user.must_change_password = False
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
