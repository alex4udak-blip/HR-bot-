from datetime import datetime, timedelta
from typing import Optional, Tuple
import secrets
import hashlib
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from fastapi import Depends, HTTPException, status, Cookie, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..config import get_settings
from ..database import get_db
from ..models.database import User, UserRole, Organization, OrgMember, OrgRole, Entity, Chat, CallRecording, Department, DepartmentMember, RefreshToken

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


def create_impersonation_token(
    impersonated_user_id: int,
    original_user_id: int,
    token_version: int = 0
) -> str:
    """Create JWT impersonation token.

    Creates a special token for user impersonation that includes:
    - sub: ID of the impersonated user (the user to act as)
    - original_user_id: ID of the original superadmin
    - is_impersonating: Flag to indicate this is an impersonation session
    - token_version: Version of the impersonated user's token

    The token expires in 1 hour for security.

    Args:
        impersonated_user_id: ID of the user to impersonate
        original_user_id: ID of the superadmin doing the impersonation
        token_version: Token version of the impersonated user

    Returns:
        JWT token string
    """
    data = {
        "sub": str(impersonated_user_id),
        "token_version": token_version,
        "original_user_id": original_user_id,
        "is_impersonating": True
    }
    expires_delta = timedelta(hours=1)  # Shorter expiration for impersonation
    return create_access_token(data, expires_delta)


async def get_current_user(
    request: Request,
    access_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Get current user from httpOnly cookie or Authorization header.

    Checks for JWT token in the following order:
    1. access_token cookie (preferred, XSS-protected)
    2. Authorization: Bearer header (for API clients and tests)
    """
    # Get token from cookie first
    token = access_token

    # Fallback to Authorization header
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]  # Remove "Bearer " prefix

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
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
    # Treat None as 0 (for users created before token_version was added)
    db_token_version = user.token_version if user.token_version is not None else 0
    if db_token_version != token_version:
        raise HTTPException(status_code=401, detail="Token has been invalidated")

    return user


async def get_current_user_allow_inactive(
    request: Request,
    access_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Get current user without checking is_active status.

    This is used for endpoints like /me where we want inactive users
    to be able to see their account status.
    """
    # Get token from cookie first
    token = access_token

    # Fallback to Authorization header
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]  # Remove "Bearer " prefix

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        token_version = payload.get("token_version", 0)  # Default to 0 for old tokens
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Verify token version matches - invalidates old tokens on password change
    # Treat None as 0 (for users created before token_version was added)
    db_token_version = user.token_version if user.token_version is not None else 0
    if db_token_version != token_version:
        raise HTTPException(status_code=401, detail="Token has been invalidated")

    return user


async def get_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.superadmin:
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


# Optional security that doesn't raise 403 if no token provided
security_optional = HTTPBearer(auto_error=False)


async def get_current_user_optional(
    request: Request,
    access_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Get current user without raising error if not authenticated."""
    # Get token from cookie first
    token = access_token

    # Fallback to Authorization header
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]  # Remove "Bearer " prefix

    if not token:
        return None

    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
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
    # Treat None as 0 (for users created before token_version was added)
    db_token_version = user.token_version if user.token_version is not None else 0
    if db_token_version != token_version:
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
    # Treat None as 0 (for users created before token_version was added)
    db_token_version = user.token_version if user.token_version is not None else 0
    if db_token_version != token_version:
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
    result = await db.execute(select(User).where(User.role == UserRole.superadmin))
    superadmin = result.scalar_one_or_none()

    if not superadmin:
        superadmin = User(
            email=settings.superadmin_email,
            password_hash=hash_password(settings.superadmin_password),
            name="Super Admin",
            role=UserRole.superadmin,
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
            role = OrgRole.owner if user.role == UserRole.superadmin else OrgRole.admin
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
    return user.role == UserRole.superadmin


async def is_owner(user: User, org_id: int, db: AsyncSession) -> bool:
    """Check if user is OWNER of the organization.

    OWNER sees everything in the organization, except private content created by SUPERADMIN.
    """
    if user.role == UserRole.superadmin:
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

    # Use enum comparison since member.role comes from DB as DeptRole enum
    from ..models.database import DeptRole
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
    - Owner can always view their own resources
    - Department admins (lead/sub_admin) can view all resources in their department
    - Regular members can only view their own resources
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

    # Check if user is a member of the resource's department
    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.user_id == user.id,
            DepartmentMember.department_id == resource_dept_id
        )
    )
    member = result.scalar_one_or_none()

    # If not a member of the department, cannot view
    if not member:
        return False

    # Department admins (lead/sub_admin) can view all resources in their department
    # Use enum comparison since member.role comes from DB as DeptRole enum
    from ..models.database import DeptRole
    if member.role in (DeptRole.lead, DeptRole.sub_admin):
        return True

    # Regular members can only view their own resources
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

    return creator and creator.role == UserRole.superadmin


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
    from ..models.database import DeptRole

    # Only ADMIN and SUB_ADMIN can have departments
    if user.role not in (UserRole.admin, UserRole.sub_admin):
        return None

    # Get user's department membership where they are lead or sub_admin
    result = await db.execute(
        select(Department)
        .join(DepartmentMember, DepartmentMember.department_id == Department.id)
        .where(
            DepartmentMember.user_id == user.id,
            DepartmentMember.role.in_([DeptRole.lead, DeptRole.sub_admin])
        )
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


async def can_share_to(
    from_user: User,
    to_user: User,
    from_user_org_id: int,
    db: AsyncSession
) -> bool:
    """
    Check if from_user can share resources with to_user.

    Logic:
    - MEMBER → only within their department
    - OrgRole.ADMIN → their department + admins of other departments + OWNER/SUPERADMIN
    - DeptRole.lead/sub_admin → their department + leads/sub_admins of other departments + OrgRole.admin + OWNER/SUPERADMIN
    - OWNER → anyone in organization
    - SUPERADMIN → anyone

    Args:
        from_user: User who wants to share
        to_user: User to share with
        from_user_org_id: Organization ID of the resource owner
        db: Database session

    Returns:
        True if sharing is allowed, False otherwise
    """
    # SUPERADMIN can share with anyone
    if from_user.role == UserRole.superadmin:
        return True

    # Get from_user's role in the organization
    from_user_role = await get_user_org_role(from_user, from_user_org_id, db)

    # OWNER can share with anyone in their organization
    if from_user_role == OrgRole.owner:
        # Check that to_user is in the same organization
        to_user_org = await get_user_org(to_user, db)
        return to_user_org and to_user_org.id == from_user_org_id

    # Get to_user's role in the organization
    to_user_org_role = await get_user_org_role(to_user, from_user_org_id, db)

    # If to_user is not in the organization, cannot share
    if to_user_org_role is None:
        return False

    # ADMIN can share with:
    # 1. Their department members
    # 2. Admins of other departments
    # 3. OWNER/SUPERADMIN
    if from_user_role == OrgRole.admin:
        # Can share with OWNER or SUPERADMIN
        if to_user_org_role == OrgRole.owner or to_user.role == UserRole.superadmin:
            return True

        # Can share with other admins
        if to_user_org_role == OrgRole.admin:
            return True

        # Can share within their departments
        # Get from_user's departments
        from_depts_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == from_user.id
            )
        )
        from_dept_ids = set(from_depts_result.scalars().all())

        # Get to_user's departments
        to_depts_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == to_user.id
            )
        )
        to_dept_ids = set(to_depts_result.scalars().all())

        # Check if they share at least one department
        return bool(from_dept_ids & to_dept_ids)

    # Check if from_user is a department lead/sub_admin
    # DeptRole.lead and DeptRole.sub_admin can share like OrgRole.admin:
    # - Within their department
    # - With leads/sub_admins of other departments
    # - With OrgRole.admin
    # - With OWNER/SUPERADMIN
    from ..models.database import DeptRole as DeptRoleEnum
    from_dept_admin_result = await db.execute(
        select(DepartmentMember.department_id).where(
            DepartmentMember.user_id == from_user.id,
            DepartmentMember.role.in_([DeptRoleEnum.lead, DeptRoleEnum.sub_admin])
        )
    )
    from_dept_admin_ids = set(from_dept_admin_result.scalars().all())

    if from_dept_admin_ids:
        # Can share with OWNER or SUPERADMIN
        if to_user_org_role == OrgRole.owner or to_user.role == UserRole.superadmin:
            return True

        # Can share with OrgRole.admin
        if to_user_org_role == OrgRole.admin:
            return True

        # Can share with other department leads/sub_admins
        to_dept_admin_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == to_user.id,
                DepartmentMember.role.in_([DeptRoleEnum.lead, DeptRoleEnum.sub_admin])
            )
        )
        to_dept_admin_ids = set(to_dept_admin_result.scalars().all())
        if to_dept_admin_ids:
            return True

        # Can share within their departments
        to_depts_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == to_user.id
            )
        )
        to_dept_ids = set(to_depts_result.scalars().all())

        # Check if to_user is in any of from_user's admin departments
        return bool(from_dept_admin_ids & to_dept_ids)

    # MEMBER can only share within their department
    if from_user_role == OrgRole.member:
        # Get from_user's departments
        from_depts_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == from_user.id
            )
        )
        from_dept_ids = set(from_depts_result.scalars().all())

        # Get to_user's departments
        to_depts_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == to_user.id
            )
        )
        to_dept_ids = set(to_depts_result.scalars().all())

        # Can only share if they are in the same department
        return bool(from_dept_ids & to_dept_ids)

    return False


# ============================================================================
# REFRESH TOKEN MANAGEMENT
# ============================================================================

# Token configuration
ACCESS_TOKEN_EXPIRE_MINUTES = 15  # Short-lived access tokens (15 minutes)
REFRESH_TOKEN_EXPIRE_DAYS = 7     # Long-lived refresh tokens (7 days)


def _hash_token(token: str) -> str:
    """Create SHA-256 hash of a token for secure storage."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _generate_refresh_token() -> str:
    """Generate a cryptographically secure refresh token."""
    return secrets.token_urlsafe(64)


async def create_refresh_token(
    db: AsyncSession,
    user_id: int,
    device_name: Optional[str] = None,
    ip_address: Optional[str] = None
) -> str:
    """Create a new refresh token for a user.

    Args:
        db: Database session
        user_id: ID of the user to create token for
        device_name: Optional device/browser identifier (e.g., "Chrome on Windows")
        ip_address: Optional IP address of the client

    Returns:
        The raw refresh token (only returned once, stored as hash)

    SECURITY: The raw token is returned only once. We store only the hash.
    """
    raw_token = _generate_refresh_token()
    token_hash = _hash_token(raw_token)
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    refresh_token = RefreshToken(
        token_hash=token_hash,
        user_id=user_id,
        device_name=device_name,
        ip_address=ip_address,
        expires_at=expires_at,
        created_at=datetime.utcnow()
    )
    db.add(refresh_token)
    await db.commit()

    return raw_token


async def validate_refresh_token(
    db: AsyncSession,
    token: str
) -> Optional[int]:
    """Validate a refresh token and return the user_id if valid.

    Args:
        db: Database session
        token: Raw refresh token to validate

    Returns:
        User ID if token is valid, None otherwise

    A token is valid if:
    - It exists in the database (hash matches)
    - It has not expired
    - It has not been revoked
    """
    token_hash = _hash_token(token)

    result = await db.execute(
        select(RefreshToken).where(
            and_(
                RefreshToken.token_hash == token_hash,
                RefreshToken.expires_at > datetime.utcnow(),
                RefreshToken.revoked_at.is_(None)
            )
        )
    )
    refresh_token = result.scalar_one_or_none()

    if refresh_token:
        return refresh_token.user_id
    return None


async def get_refresh_token_record(
    db: AsyncSession,
    token: str
) -> Optional[RefreshToken]:
    """Get the RefreshToken record for a given token.

    Args:
        db: Database session
        token: Raw refresh token

    Returns:
        RefreshToken record if found and valid, None otherwise
    """
    token_hash = _hash_token(token)

    result = await db.execute(
        select(RefreshToken).where(
            and_(
                RefreshToken.token_hash == token_hash,
                RefreshToken.expires_at > datetime.utcnow(),
                RefreshToken.revoked_at.is_(None)
            )
        )
    )
    return result.scalar_one_or_none()


async def revoke_refresh_token(
    db: AsyncSession,
    token: str
) -> bool:
    """Revoke a specific refresh token.

    Args:
        db: Database session
        token: Raw refresh token to revoke

    Returns:
        True if token was found and revoked, False otherwise
    """
    token_hash = _hash_token(token)

    result = await db.execute(
        select(RefreshToken).where(
            and_(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at.is_(None)
            )
        )
    )
    refresh_token = result.scalar_one_or_none()

    if refresh_token:
        refresh_token.revoked_at = datetime.utcnow()
        await db.commit()
        return True
    return False


async def revoke_all_user_tokens(
    db: AsyncSession,
    user_id: int
) -> int:
    """Revoke all refresh tokens for a user.

    Args:
        db: Database session
        user_id: ID of the user whose tokens to revoke

    Returns:
        Number of tokens revoked
    """
    result = await db.execute(
        select(RefreshToken).where(
            and_(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None)
            )
        )
    )
    tokens = result.scalars().all()
    count = len(tokens)

    if count > 0:
        await db.execute(
            update(RefreshToken)
            .where(
                and_(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None)
                )
            )
            .values(revoked_at=datetime.utcnow())
        )
        await db.commit()

    return count


async def rotate_refresh_token(
    db: AsyncSession,
    old_token: str,
    device_name: Optional[str] = None,
    ip_address: Optional[str] = None
) -> Optional[Tuple[str, int]]:
    """Rotate a refresh token: revoke old one, create new one.

    This is the recommended way to refresh tokens. It provides:
    - Automatic token rotation for better security
    - Detection of token reuse (if old token is already revoked)

    Args:
        db: Database session
        old_token: Current refresh token to rotate
        device_name: Optional device identifier for the new token
        ip_address: Optional IP address for the new token

    Returns:
        Tuple of (new_token, user_id) if successful, None otherwise

    SECURITY: If a revoked token is presented, it indicates potential token theft.
    The user should be notified and all their tokens revoked.
    """
    old_token_hash = _hash_token(old_token)

    # Check if token exists but is already revoked (potential theft)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == old_token_hash)
    )
    existing_token = result.scalar_one_or_none()

    if existing_token:
        if existing_token.revoked_at is not None:
            # Token was already revoked! This is suspicious.
            # Revoke ALL tokens for this user as a security measure
            await revoke_all_user_tokens(db, existing_token.user_id)
            return None

        if existing_token.expires_at <= datetime.utcnow():
            # Token has expired
            return None

        # Valid token - revoke it and create new one
        existing_token.revoked_at = datetime.utcnow()
        user_id = existing_token.user_id

        # Optionally preserve device info if not provided
        if device_name is None:
            device_name = existing_token.device_name

        new_token = await create_refresh_token(
            db,
            user_id=user_id,
            device_name=device_name,
            ip_address=ip_address
        )

        return new_token, user_id

    return None


async def get_user_sessions(
    db: AsyncSession,
    user_id: int
) -> list[RefreshToken]:
    """Get all active (non-expired, non-revoked) sessions for a user.

    Args:
        db: Database session
        user_id: ID of the user

    Returns:
        List of active RefreshToken records
    """
    result = await db.execute(
        select(RefreshToken).where(
            and_(
                RefreshToken.user_id == user_id,
                RefreshToken.expires_at > datetime.utcnow(),
                RefreshToken.revoked_at.is_(None)
            )
        ).order_by(RefreshToken.created_at.desc())
    )
    return list(result.scalars().all())


async def cleanup_expired_tokens(db: AsyncSession) -> int:
    """Delete expired refresh tokens from the database.

    This should be run periodically (e.g., daily) to clean up old tokens.

    Args:
        db: Database session

    Returns:
        Number of tokens deleted
    """
    from sqlalchemy import delete

    result = await db.execute(
        delete(RefreshToken).where(
            RefreshToken.expires_at <= datetime.utcnow()
        ).returning(RefreshToken.id)
    )
    deleted = len(result.fetchall())
    await db.commit()
    return deleted


def create_short_lived_access_token(user_id: int, token_version: int = 0) -> str:
    """Create a short-lived access token (15 minutes).

    This is used in conjunction with refresh tokens for the new auth flow.

    Args:
        user_id: ID of the user
        token_version: Token version for invalidation on password change

    Returns:
        JWT access token string
    """
    return create_access_token(
        data={
            "sub": str(user_id),
            "token_version": token_version
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
