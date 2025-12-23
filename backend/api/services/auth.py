from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..config import get_settings
from ..database import get_db
from ..models.database import User, UserRole, Organization, OrgMember, OrgRole, Entity, Chat, CallRecording

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


def _truncate_password(password: str, max_bytes: int = 72) -> str:
    """Truncate password to max_bytes for bcrypt compatibility."""
    password_bytes = password.encode('utf-8')
    if len(password_bytes) <= max_bytes:
        return password
    # Truncate and decode, ignoring incomplete multibyte chars
    return password_bytes[:max_bytes].decode('utf-8', errors='ignore')


def hash_password(password: str) -> str:
    """Hash password using bcrypt."""
    truncated = _truncate_password(password)
    return pwd_context.hash(truncated)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify password against hash."""
    truncated = _truncate_password(plain)
    return pwd_context.verify(truncated, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


async def get_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


# Optional security that doesn't raise 403 if no token provided
security_optional = HTTPBearer(auto_error=False)


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Get current user without raising error if not authenticated."""
    if not credentials:
        return None
    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        return None

    return user


async def get_user_from_token(token: str, db: AsyncSession) -> Optional[User]:
    """Get user from a raw JWT token string."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        return None

    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.password_hash):
        return user
    return None


async def create_superadmin_if_not_exists(db: AsyncSession):
    """Create superadmin, default organization, and migrate existing data."""
    import logging
    logger = logging.getLogger("hr-analyzer.auth")

    # Create superadmin if not exists
    result = await db.execute(select(User).where(User.role == UserRole.SUPERADMIN))
    superadmin = result.scalar_one_or_none()

    if not superadmin:
        superadmin = User(
            email=settings.superadmin_email,
            password_hash=hash_password(settings.superadmin_password),
            name="Super Admin",
            role=UserRole.SUPERADMIN,
        )
        db.add(superadmin)
        await db.flush()
        logger.info("Superadmin created")

    # Create default organization if not exists
    result = await db.execute(select(Organization).where(Organization.slug == "default"))
    default_org = result.scalar_one_or_none()

    if not default_org:
        default_org = Organization(
            name="Моя организация",
            slug="default",
            settings={"max_users": 100, "max_chats": 1000}
        )
        db.add(default_org)
        await db.flush()
        logger.info(f"Default organization created with id={default_org.id}")

    # Add superadmin to default org as owner if not already member
    result = await db.execute(
        select(OrgMember).where(
            OrgMember.org_id == default_org.id,
            OrgMember.user_id == superadmin.id
        )
    )
    if not result.scalar_one_or_none():
        membership = OrgMember(
            org_id=default_org.id,
            user_id=superadmin.id,
            role=OrgRole.owner
        )
        db.add(membership)
        logger.info("Superadmin added to default organization as owner")

    # Migrate all existing users to default org
    result = await db.execute(select(User))
    all_users = result.scalars().all()
    for user in all_users:
        result = await db.execute(
            select(OrgMember).where(
                OrgMember.org_id == default_org.id,
                OrgMember.user_id == user.id
            )
        )
        if not result.scalar_one_or_none():
            # Superadmin is owner, others are admins (for now)
            role = OrgRole.owner if user.role == UserRole.SUPERADMIN else OrgRole.admin
            membership = OrgMember(
                org_id=default_org.id,
                user_id=user.id,
                role=role
            )
            db.add(membership)

    # Migrate existing data to default org (only if org_id is NULL)
    # This ensures existing data belongs to the default organization

    # Migrate chats
    await db.execute(
        Chat.__table__.update()
        .where(Chat.org_id.is_(None))
        .values(org_id=default_org.id)
    )

    # Migrate entities
    await db.execute(
        Entity.__table__.update()
        .where(Entity.org_id.is_(None))
        .values(org_id=default_org.id)
    )

    # Migrate calls
    await db.execute(
        CallRecording.__table__.update()
        .where(CallRecording.org_id.is_(None))
        .values(org_id=default_org.id)
    )

    await db.commit()
    logger.info("Data migration to default organization complete")


async def get_user_org(user: User, db: AsyncSession) -> Optional[Organization]:
    """Get user's current organization (first one for now)."""
    result = await db.execute(
        select(Organization)
        .join(OrgMember, OrgMember.org_id == Organization.id)
        .where(OrgMember.user_id == user.id)
        .order_by(OrgMember.created_at)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_user_org_role(user: User, org_id: int, db: AsyncSession) -> Optional[OrgRole]:
    """Get user's role in specific organization."""
    result = await db.execute(
        select(OrgMember).where(
            OrgMember.org_id == org_id,
            OrgMember.user_id == user.id
        )
    )
    member = result.scalar_one_or_none()
    return member.role if member else None
