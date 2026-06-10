from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from user_agents import parse as parse_user_agent

from ..database import get_db
from ..models.database import User, UserRole, OrgMember, OrgRole, Organization, DepartmentMember, Department
from ..models.schemas import (
    LoginRequest, TokenResponse, ChangePasswordRequest,
    LinkTelegramRequest, UserResponse, UserCreate,
    RefreshTokenResponse, RefreshRequest, SessionResponse, SessionsListResponse, LogoutAllResponse
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
    """Extract a user-friendly device name from User-Agent header using user-agents library."""
    user_agent_str = request.headers.get("user-agent", "")
    if not user_agent_str:
        return "Unknown Device"

    ua = parse_user_agent(user_agent_str)

    # Build device name from parsed data
    if ua.is_mobile:
        if ua.device.family and ua.device.family != "Other":
            return ua.device.family  # e.g., "iPhone", "Samsung Galaxy"
        return "Mobile Device"
    elif ua.is_tablet:
        if ua.device.family and ua.device.family != "Other":
            return ua.device.family  # e.g., "iPad"
        return "Tablet"
    elif ua.is_pc:
        browser = ua.browser.family  # e.g., "Chrome", "Firefox", "Safari"
        if browser and browser != "Other":
            return f"{browser} Browser"
        return "Desktop Browser"
    elif ua.is_bot:
        return "Bot"

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


@router.post("/login", response_model=TokenResponse)
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

    # Get org membership and role
    org_role = None
    org_member_result = await db.execute(
        select(OrgMember.role).where(OrgMember.user_id == authenticated_user.id)
    )
    org_member = org_member_result.scalar_one_or_none()
    if org_member:
        org_role = org_member.value

    # Get department membership
    department_id = None
    department_name = None
    department_role = None
    dept_result = await db.execute(
        select(DepartmentMember, Department)
        .join(Department, Department.id == DepartmentMember.department_id)
        .where(DepartmentMember.user_id == authenticated_user.id)
    )
    dept_rows = dept_result.all()
    department_names: list[str] = []
    if dept_rows:
        first_member, first_dept = dept_rows[0]
        department_id = first_dept.id
        department_name = first_dept.name
        department_role = first_member.role.value if first_member.role else None
        department_names = [d.name for _, d in dept_rows]

    # Return access token + user info in response body (needed by Chrome extension)
    # Cookies are also set above for browser-based auth
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        # Расширению отдаём refresh-токен в теле (для silent-refresh из
        # chrome.storage). Вебу — нет, у него httpOnly-кука.
        refresh_token=refresh_token if login_request.include_refresh else None,
        user=UserResponse(
            id=authenticated_user.id, email=authenticated_user.email, name=authenticated_user.name,
            role=authenticated_user.role.value,
            org_role=org_role,
            department_id=department_id,
            department_name=department_name,
            department_role=department_role,
            department_names=department_names,
            telegram_id=authenticated_user.telegram_id,
            telegram_username=authenticated_user.telegram_username,
            is_active=authenticated_user.is_active, created_at=authenticated_user.created_at,
            chats_count=0,  # Skip lazy loading for login
            must_change_password=authenticated_user.must_change_password or False
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
    body: Optional[RefreshRequest] = None,
    refresh_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db)
):
    """Refresh the access token using a valid refresh token.

    This endpoint:
    1. Validates the refresh token from httpOnly cookie ИЛИ из тела (расширение)
    2. Rotates the refresh token (old one is revoked, new one is issued)
    3. Issues a new short-lived access token

    SECURITY: Token rotation prevents replay attacks and allows detection
    of token theft (if a revoked token is presented).
    """
    # Источник refresh-токена: тело (расширение, без кук) приоритетнее куки.
    # Если токен пришёл из тела — новые токены вернём в теле, иначе только в куках.
    body_token = body.refresh_token if (body and body.refresh_token) else None
    token_from_body = body_token is not None
    refresh_token = body_token or refresh_token

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

    return RefreshTokenResponse(
        message="Token refreshed successfully",
        # Только для расширения (refresh пришёл из тела) — иначе None, веб берёт
        # обновлённые токены из кук.
        access_token=access_token if token_from_body else None,
        refresh_token=new_refresh_token if token_from_body else None,
    )


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
async def get_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Get org membership and role
    org_role = None
    org_member_result = await db.execute(
        select(OrgMember.role).where(OrgMember.user_id == user.id)
    )
    org_member = org_member_result.scalar_one_or_none()
    if org_member:
        org_role = org_member.value

    # Get department membership
    department_id = None
    department_name = None
    department_role = None
    dept_result = await db.execute(
        select(DepartmentMember, Department)
        .join(Department, Department.id == DepartmentMember.department_id)
        .where(DepartmentMember.user_id == user.id)
    )
    dept_rows = dept_result.all()
    department_names: list[str] = []
    if dept_rows:
        first_member, first_dept = dept_rows[0]
        department_id = first_dept.id
        department_name = first_dept.name
        department_role = first_member.role.value if first_member.role else None
        department_names = [d.name for _, d in dept_rows]

    return UserResponse(
        id=user.id, email=user.email, name=user.name,
        role=user.role.value,
        org_role=org_role,
        department_id=department_id,
        department_name=department_name,
        department_role=department_role,
        department_names=department_names,
        telegram_id=user.telegram_id,
        telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at,
        chats_count=0,  # Skip lazy loading
        must_change_password=user.must_change_password or False
    )


@router.get("/telegram-link")
async def get_telegram_link(user: User = Depends(get_current_user)):
    """Возвращает статус привязки Telegram + deep-link для подключения.

    Telegram-боты не могут писать первыми тем, кто им не написал /start —
    из-за этого юзер не получает уведомления, пока сам не нажмёт start.
    Этот эндпоинт даёт фронту всё нужное чтобы показать баннер
    'Подключите Telegram-бота' с готовой ссылкой.
    """
    bot_username = (settings.telegram_bot_username or "").lstrip("@")
    is_linked = user.telegram_id is not None
    link_url = (
        f"https://t.me/{bot_username}?start=bind_{user.id}"
        if bot_username and not is_linked
        else None
    )
    return {
        "is_linked": is_linked,
        "telegram_id": user.telegram_id,
        "telegram_username": user.telegram_username,
        "bot_username": bot_username or None,
        "link_url": link_url,
    }


# ============================================================
# Org-level stage configuration (kanban labels & colors)
# ============================================================

# Дефолты — повторяют KANBAN_STATUSES в candidate_search.py.
# Если у орги ещё нет своей конфигурации, отдаём это.
DEFAULT_ORG_STAGES = [
    {"key": "new",           "label": "Новый",       "color": "#3b82f6"},
    {"key": "screening",     "label": "Скрининг",    "color": "#06b6d4"},
    {"key": "practice",      "label": "Практика",    "color": "#a855f7"},
    {"key": "tech_practice", "label": "Тех-практика","color": "#6366f1"},
    {"key": "is_interview",  "label": "ИС",          "color": "#f97316"},
    {"key": "offer",         "label": "Оффер",       "color": "#eab308"},
    {"key": "hired",         "label": "Принят",      "color": "#22c55e"},
    {"key": "rejected",      "label": "Отклонён",    "color": "#ef4444"},
]
ALLOWED_STAGE_KEYS = {s["key"] for s in DEFAULT_ORG_STAGES}


class StageItem(BaseModel):
    key: str
    label: str = Field(..., min_length=1, max_length=64)
    color: str = Field(..., pattern=r'^#[0-9a-fA-F]{6}$')


class OrgStagesUpdate(BaseModel):
    stages: List[StageItem]


async def _get_user_org_or_404(user: User, db: AsyncSession) -> Organization:
    res = await db.execute(
        select(Organization).join(OrgMember, OrgMember.org_id == Organization.id)
        .where(OrgMember.user_id == user.id).limit(1)
    )
    org = res.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    return org


def _read_org_stages(org: Organization) -> list[dict]:
    """Возвращает stage_config из settings либо дефолты."""
    settings_data = org.settings or {}
    cfg = settings_data.get("stage_config")
    if isinstance(cfg, list) and cfg:
        # Убедимся что все ключи известные — фильтруем неизвестные.
        return [s for s in cfg if isinstance(s, dict) and s.get("key") in ALLOWED_STAGE_KEYS]
    return [dict(s) for s in DEFAULT_ORG_STAGES]


@router.get("/org-stages")
async def get_org_stages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Текущая конфигурация этапов воронки для орги (или дефолты)."""
    org = await _get_user_org_or_404(user, db)
    return {"stages": _read_org_stages(org)}


@router.put("/org-stages")
async def update_org_stages(
    data: OrgStagesUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить конфигурацию этапов. Только superadmin/owner/admin."""
    org = await _get_user_org_or_404(user, db)

    # Право редактировать — только админ оргa или платформенный админ
    is_platform_admin = user.role == UserRole.superadmin
    if not is_platform_admin:
        member_res = await db.execute(
            select(OrgMember.role).where(
                OrgMember.user_id == user.id,
                OrgMember.org_id == org.id,
            )
        )
        role_val = member_res.scalar_one_or_none()
        if role_val not in (OrgRole.owner, OrgRole.admin):
            raise HTTPException(403, "Только админ организации может менять этапы")

    # Валидация: все ключи должны быть из allowed-списка, без дубликатов.
    seen = set()
    cleaned = []
    for s in data.stages:
        if s.key not in ALLOWED_STAGE_KEYS:
            raise HTTPException(400, f"Неизвестный ключ этапа: {s.key}")
        if s.key in seen:
            raise HTTPException(400, f"Дублирующийся этап: {s.key}")
        seen.add(s.key)
        cleaned.append({"key": s.key, "label": s.label.strip(), "color": s.color.lower()})

    if not cleaned:
        raise HTTPException(400, "Список этапов не может быть пустым")

    # Сохраняем в settings JSON (поле уже есть, миграция не нужна).
    new_settings = dict(org.settings or {})
    new_settings["stage_config"] = cleaned
    org.settings = new_settings
    flag_modified(org, "settings")  # SQLAlchemy не видит мутации dict без подсказки
    await db.commit()

    return {"success": True, "stages": cleaned}


# ---------------------------------------------------------------------------
# Шаблоны статусов — именованные наборы этапов воронки. Админ создаёт их в
# настройках, при создании заявки выбирает нужный шаблон. Храним в
# Organization.settings.status_templates (JSON, миграция не нужна).
# ---------------------------------------------------------------------------

class StatusTemplate(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=64)
    stages: List[StageItem]


class StatusTemplatesUpdate(BaseModel):
    templates: List[StatusTemplate]


def _read_status_templates(org: Organization) -> list[dict]:
    """Список шаблонов статусов из settings (или пустой список)."""
    settings_data = org.settings or {}
    tpls = settings_data.get("status_templates")
    if not isinstance(tpls, list):
        return []
    result = []
    for t in tpls:
        if not isinstance(t, dict) or not t.get("id") or not t.get("name"):
            continue
        stages = t.get("stages")
        if not isinstance(stages, list):
            continue
        clean_stages = [
            s for s in stages
            if isinstance(s, dict) and s.get("key") in ALLOWED_STAGE_KEYS
        ]
        if clean_stages:
            result.append({"id": t["id"], "name": t["name"], "stages": clean_stages})
    return result


@router.get("/status-templates")
async def get_status_templates(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Шаблоны статусов организации."""
    org = await _get_user_org_or_404(user, db)
    return {"templates": _read_status_templates(org)}


@router.put("/status-templates")
async def update_status_templates(
    data: StatusTemplatesUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить шаблоны статусов. Только superadmin/owner/admin."""
    org = await _get_user_org_or_404(user, db)

    is_platform_admin = user.role == UserRole.superadmin
    if not is_platform_admin:
        member_res = await db.execute(
            select(OrgMember.role).where(
                OrgMember.user_id == user.id,
                OrgMember.org_id == org.id,
            )
        )
        role_val = member_res.scalar_one_or_none()
        if role_val not in (OrgRole.owner, OrgRole.admin):
            raise HTTPException(403, "Только админ организации может менять шаблоны")

    cleaned: list[dict] = []
    seen_ids: set[str] = set()
    for tpl in data.templates:
        if tpl.id in seen_ids:
            raise HTTPException(400, f"Дублирующийся шаблон: {tpl.id}")
        seen_ids.add(tpl.id)

        seen_keys: set[str] = set()
        clean_stages = []
        for s in tpl.stages:
            if s.key not in ALLOWED_STAGE_KEYS:
                raise HTTPException(400, f"Неизвестный ключ этапа: {s.key}")
            if s.key in seen_keys:
                raise HTTPException(400, f"Дублирующийся этап в шаблоне «{tpl.name}»: {s.key}")
            seen_keys.add(s.key)
            clean_stages.append({"key": s.key, "label": s.label.strip(), "color": s.color.lower()})
        if not clean_stages:
            raise HTTPException(400, f"Шаблон «{tpl.name}» должен содержать хотя бы один этап")
        cleaned.append({"id": tpl.id, "name": tpl.name.strip(), "stages": clean_stages})

    new_settings = dict(org.settings or {})
    new_settings["status_templates"] = cleaned
    org.settings = new_settings
    flag_modified(org, "settings")
    await db.commit()

    return {"success": True, "templates": cleaned}


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
