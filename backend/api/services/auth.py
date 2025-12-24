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
from ..models.database import User, UserRole, Organization, OrgMember, OrgRole, Entity, Chat, CallRecording, Department, DepartmentMember

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


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token.

    Args:
        data: Dictionary containing token data (sub, user_id, token_version, etc.)
        expires_delta: Optional custom expiration time. If not provided,
                      uses the default from settings.

    SECURITY NOTE: Tokens are currently stored in localStorage on the frontend,
    which is vulnerable to XSS attacks. Future implementation should use httpOnly
    cookies with CSRF tokens for better security.

    SECURITY: Token includes token_version to invalidate old tokens on password change.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
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
        token_version = payload.get("token_version", 0)  # Default to 0 for old tokens
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Verify token version matches - invalidates old tokens on password change
    if user.token_version != token_version:
        raise HTTPException(status_code=401, detail="Token has been invalidated")

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
        token_version = payload.get("token_version", 0)  # Default to 0 for old tokens
        if not user_id:
            return None
    except JWTError:
        return None

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        return None

    # Verify token version matches - invalidates old tokens on password change
    if user.token_version != token_version:
        return None

    return user


async def get_user_from_token(token: str, db: AsyncSession) -> Optional[User]:
    """Get user from a raw JWT token string."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        token_version = payload.get("token_version", 0)  # Default to 0 for old tokens
        if not user_id:
            return None
    except JWTError:
        return None

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        return None

    # Verify token version matches - invalidates old tokens on password change
    if user.token_version != token_version:
        return None

    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    """Authenticate user with constant-time comparison to prevent timing attacks."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        # User exists - verify actual password
        if verify_password(password, user.password_hash):
            return user
    else:
        # User doesn't exist - perform dummy hash to maintain constant time
        # This prevents timing attacks that could enumerate valid email addresses
        dummy_hash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYqVr/1fXem"
        verify_password(password, dummy_hash)

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


# === Helper functions for role-based access control ===

def is_superadmin(user: User) -> bool:
    """Check if user is SUPERADMIN (global access to everything)."""
    return user.role == UserRole.SUPERADMIN


async def is_owner(user: User, org_id: int, db: AsyncSession) -> bool:
    """Check if user is OWNER of the organization.

    OWNER sees everything in the organization, except private content created by SUPERADMIN.
    """
    if user.role == UserRole.SUPERADMIN:
        return False  # Superadmin is not owner, it's higher

    user_role = await get_user_org_role(user, org_id, db)
    return user_role == OrgRole.owner


async def is_department_admin(user: User, dept_id: int, db: AsyncSession) -> bool:
    """Check if user is ADMIN or SUB_ADMIN of the department.

    Returns True if user has lead or sub_admin role in the specified department.
    IMPORTANT: Admins cannot exist without a department.
    """
    from ..models.database import DepartmentMember, DeptRole

    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.user_id == user.id,
            DepartmentMember.department_id == dept_id
        )
    )
    member = result.scalar_one_or_none()

    if not member:
        return False

    return member.role in (DeptRole.lead, DeptRole.sub_admin)


async def get_user_departments(user: User, db: AsyncSession) -> list:
    """Get all departments where user is a member.

    Returns list of tuples: (department_id, role)
    """
    from ..models.database import DepartmentMember

    result = await db.execute(
        select(DepartmentMember).where(DepartmentMember.user_id == user.id)
    )
    members = result.scalars().all()

    return [(m.department_id, m.role) for m in members]


async def is_same_department(user1: User, user2: User, db: AsyncSession) -> bool:
    """Check if two users are in the same department."""
    from ..models.database import DepartmentMember

    # Get departments for both users
    result1 = await db.execute(
        select(DepartmentMember.department_id).where(DepartmentMember.user_id == user1.id)
    )
    dept_ids_1 = set(result1.scalars().all())

    result2 = await db.execute(
        select(DepartmentMember.department_id).where(DepartmentMember.user_id == user2.id)
    )
    dept_ids_2 = set(result2.scalars().all())

    # Check if they share at least one department
    return bool(dept_ids_1 & dept_ids_2)


async def can_view_in_department(user: User, resource_owner_id: int, resource_dept_id: Optional[int], db: AsyncSession) -> bool:
    """Check if user can view a resource based on department membership.

    Rules:
    - ADMIN/SUB_ADMIN can view all resources in their department
    - MEMBER can only view their own resources
    - If resource has no department, only owner can view it (unless shared)

    Args:
        user: Current user
        resource_owner_id: ID of the user who created/owns the resource
        resource_dept_id: Department ID of the resource (can be None)
        db: Database session

    Returns:
        True if user can view the resource based on department rules
    """
    from ..models.database import DepartmentMember, DeptRole

    # Owner can always view their own resources
    if resource_owner_id == user.id:
        return True

    # If resource has no department, only owner can view
    if not resource_dept_id:
        return False

    # Check user's role in the resource's department
    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.user_id == user.id,
            DepartmentMember.department_id == resource_dept_id
        )
    )
    member = result.scalar_one_or_none()

    if not member:
        return False  # User is not in this department

    # ADMIN and SUB_ADMIN can view all resources in their department
    if member.role in (DeptRole.lead, DeptRole.sub_admin):
        return True

    # MEMBER can only view their own resources (already checked above)
    return False


async def was_created_by_superadmin(resource, db: AsyncSession) -> bool:
    """Check if resource was created by a SUPERADMIN.

    Used to enforce OWNER restriction: OWNER cannot see private content created by SUPERADMIN.
    """
    if not hasattr(resource, 'created_by') or not resource.created_by:
        return False

    result = await db.execute(
        select(User).where(User.id == resource.created_by)
    )
    creator = result.scalar_one_or_none()

    return creator and creator.role == UserRole.SUPERADMIN


async def get_department_admin(user: User, db: AsyncSession) -> Optional[Department]:
    """Get department if user is ADMIN or SUB_ADMIN.

    Returns the department where the user has ADMIN or SUB_ADMIN role.
    IMPORTANT: Admins cannot exist without a department.

    Args:
        user: User to check
        db: Database session

    Returns:
        Department object if user is ADMIN/SUB_ADMIN, None otherwise
    """
    # Only ADMIN and SUB_ADMIN can have departments
    if user.role not in (UserRole.ADMIN, UserRole.SUB_ADMIN):
        return None

    # Get user's department membership
    result = await db.execute(
        select(Department)
        .join(DepartmentMember, DepartmentMember.department_id == Department.id)
        .where(DepartmentMember.user_id == user.id)
        .limit(1)  # Admin should only have one department
    )
    return result.scalar_one_or_none()


async def require_department_membership(user: User, dept_id: int, db: AsyncSession) -> None:
    """Check that user is a member of the specified department.

    Raises HTTPException(403) if user is not a member of the department.

    Args:
        user: User to check
        dept_id: Department ID to verify membership
        db: Database session

    Raises:
        HTTPException: If user is not a member of the department
    """
    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.user_id == user.id,
            DepartmentMember.department_id == dept_id
        )
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(
            status_code=403,
            detail="You must be a member of this department to access this resource"
        )
