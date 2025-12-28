from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
from jose import jwt, JWTError

from ..database import get_db
from ..models.database import (
    User, UserRole, OrgRole, DeptRole, Organization, OrgMember, Department,
    DepartmentMember, ImpersonationLog, Entity, EntityType, EntityStatus,
    Chat, ChatType, Message, CallRecording, CallSource, CallStatus,
    SharedAccess, ResourceType, AccessLevel, CustomRole, RolePermissionOverride,
    UserCustomRole, PermissionAuditLog
)
from ..services.auth import get_superadmin, get_current_user, create_access_token, create_impersonation_token, hash_password
from ..models.schemas import TokenResponse, UserResponse
from ..config import get_settings

router = APIRouter()
settings = get_settings()
security = HTTPBearer()


# ==================== Schemas ====================

class RolePermission(BaseModel):
    """Permission definition for a specific role"""
    role: str
    can_view_all_orgs: bool
    can_delete_users: bool
    can_share_resources: bool
    can_transfer_resources: bool
    can_manage_departments: bool
    can_create_users: bool
    can_edit_org_settings: bool
    can_view_all_dept_data: bool
    can_manage_dept_members: bool
    can_impersonate_users: bool
    can_access_admin_panel: bool
    description: str


class AccessMatrixResponse(BaseModel):
    """Complete access control matrix"""
    roles: List[str]
    permissions: List[str]
    matrix: Dict[str, Dict[str, bool]]


class SimulateAccessRequest(BaseModel):
    """Request to simulate access for a role"""
    role: str
    org_id: Optional[int] = None
    dept_id: Optional[int] = None


class SimulateAccessResponse(BaseModel):
    """Response for access simulation"""
    role: str
    action: str
    resource_type: Optional[str]
    allowed: bool
    reason: str
    context: Optional[Dict[str, Any]] = None


class ImpersonateRequest(BaseModel):
    """Request to impersonate a user"""
    user_id: int


class ImpersonationLogResponse(BaseModel):
    """Response for impersonation log entry"""
    id: int
    superadmin_id: int
    superadmin_name: str
    superadmin_email: str
    impersonated_user_id: int
    impersonated_user_name: str
    impersonated_user_email: str
    started_at: datetime
    ended_at: Optional[datetime]
    ip_address: Optional[str]
    user_agent: Optional[str]


class UserDetailResponse(BaseModel):
    """Detailed user information for admin panel"""
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    telegram_id: Optional[int]
    telegram_username: Optional[str]
    organizations: List[Dict[str, Any]]
    departments: List[Dict[str, Any]]
    token_version: int
    failed_login_attempts: int
    locked_until: Optional[datetime]


class SandboxCreateRequest(BaseModel):
    """Request to create sandbox"""
    org_id: Optional[int] = None  # If not provided, use first available organization


class SandboxUserInfo(BaseModel):
    """Information about a sandbox user"""
    id: int
    email: str
    name: str
    password: str
    role: str
    org_role: str
    dept_role: str


class SandboxEntityInfo(BaseModel):
    """Information about a sandbox entity"""
    id: int
    created_by: int
    name: str
    email: str
    tags: List[str]


class SandboxChatInfo(BaseModel):
    """Information about a sandbox chat"""
    id: int
    owner_id: int
    title: str


class SandboxCallInfo(BaseModel):
    """Information about a sandbox call"""
    id: int
    owner_id: int
    title: str


class SandboxCreateResponse(BaseModel):
    """Response for sandbox creation"""
    department_id: int
    users: List[SandboxUserInfo]
    entities: List[SandboxEntityInfo]
    chats: List[SandboxChatInfo]
    calls: List[SandboxCallInfo]


class SandboxSwitchRequest(BaseModel):
    """Request to switch to a sandbox user"""
    user_id: int


class SandboxStatsInfo(BaseModel):
    """Statistics about sandbox resources"""
    contacts: int = 0
    chats: int = 0
    calls: int = 0


class SandboxStatusResponse(BaseModel):
    """Response for sandbox status check"""
    exists: bool
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    users: List[Dict[str, Any]] = []
    stats: Optional[SandboxStatsInfo] = None


class CustomRoleCreate(BaseModel):
    """Request to create a custom role"""
    name: str = Field(..., min_length=2, max_length=50, description="Name of the custom role")
    description: Optional[str] = Field(None, max_length=255, description="Description of the custom role")
    base_role: str = Field(..., pattern="^(owner|admin|sub_admin|member)$", description="Base role to inherit permissions from")
    org_id: Optional[int] = Field(None, description="Organization ID (None for global)")


class CustomRoleUpdate(BaseModel):
    """Request to update a custom role"""
    name: Optional[str] = Field(None, min_length=2, max_length=50, description="Updated name")
    description: Optional[str] = Field(None, max_length=255, description="Updated description")
    is_active: Optional[bool] = Field(None, description="Active status")


class PermissionOverride(BaseModel):
    """Permission override for a custom role"""
    permission: str = Field(..., description="Permission key (e.g., 'can_view_all_orgs')")
    allowed: bool = Field(..., description="Whether the permission is allowed")


class CustomRoleResponse(BaseModel):
    """Response for custom role with merged permissions"""
    id: int
    name: str
    description: Optional[str]
    base_role: str
    org_id: Optional[int]
    is_active: bool
    created_at: datetime
    permissions: Dict[str, bool] = {}  # merged with base role defaults


class PermissionAuditLogResponse(BaseModel):
    """Response for permission audit log entry"""
    id: int
    custom_role_id: Optional[int]
    user_id: Optional[int]
    action: str
    changed_by_id: int
    changed_by_name: str
    changed_by_email: str
    details: Optional[Dict[str, Any]]
    created_at: datetime


# ==================== Helper Functions ====================

def get_role_permissions(role: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, bool]:
    """
    Get all permissions for a specific role.

    This is the central permission definition for the entire system.
    All access control decisions should reference this function.
    """
    permissions = {
        "can_view_all_orgs": False,
        "can_delete_users": False,
        "can_share_resources": False,
        "can_transfer_resources": False,
        "can_manage_departments": False,
        "can_create_users": False,
        "can_edit_org_settings": False,
        "can_view_all_dept_data": False,
        "can_manage_dept_members": False,
        "can_impersonate_users": False,
        "can_access_admin_panel": False,
    }

    context = context or {}

    if role == "superadmin" or role == UserRole.superadmin.value:
        # SUPERADMIN has ALL permissions
        return {
            "can_view_all_orgs": True,
            "can_delete_users": True,
            "can_share_resources": True,
            "can_transfer_resources": True,
            "can_manage_departments": True,
            "can_create_users": True,
            "can_edit_org_settings": True,
            "can_view_all_dept_data": True,
            "can_manage_dept_members": True,
            "can_impersonate_users": True,
            "can_access_admin_panel": True,
        }

    elif role == "owner" or role == OrgRole.owner.value:
        # OWNER has organization-wide permissions (except impersonation and cross-org access)
        return {
            "can_view_all_orgs": False,  # Only their org
            "can_delete_users": True,  # Within their org
            "can_share_resources": True,
            "can_transfer_resources": True,
            "can_manage_departments": True,
            "can_create_users": True,  # Within their org
            "can_edit_org_settings": True,
            "can_view_all_dept_data": True,  # All departments in their org
            "can_manage_dept_members": True,
            "can_impersonate_users": False,  # Only SUPERADMIN can impersonate
            "can_access_admin_panel": True,
        }

    elif role == "admin" or role == UserRole.admin.value or role == OrgRole.admin.value:
        # ADMIN has department-wide permissions
        # Context: same_department (bool), is_dept_admin (bool)
        is_dept_admin = context.get("is_dept_admin", False)
        same_department = context.get("same_department", False)

        return {
            "can_view_all_orgs": False,
            "can_delete_users": False,
            "can_share_resources": same_department or is_dept_admin,  # Within dept + cross-dept admins
            "can_transfer_resources": is_dept_admin,  # Only within their department
            "can_manage_departments": False,  # Cannot create/delete departments
            "can_create_users": is_dept_admin,  # Can invite to their department
            "can_edit_org_settings": False,
            "can_view_all_dept_data": is_dept_admin,  # All data in their department
            "can_manage_dept_members": is_dept_admin,  # Add/remove members in their dept
            "can_impersonate_users": False,
            "can_access_admin_panel": True,
        }

    elif role == "lead" or role == DeptRole.lead.value:
        # LEAD has full department-wide permissions (similar to admin within department)
        # Context: same_department (bool)
        same_department = context.get("same_department", True)

        return {
            "can_view_all_orgs": False,
            "can_delete_users": False,
            "can_share_resources": same_department,  # Within dept + cross-dept leads
            "can_transfer_resources": True,  # Can transfer within department
            "can_manage_departments": False,  # Cannot create/delete departments
            "can_create_users": True,  # Can invite to their department
            "can_edit_org_settings": False,
            "can_view_all_dept_data": True,  # All data in their department
            "can_manage_dept_members": True,  # Add/remove members in their dept
            "can_impersonate_users": False,
            "can_access_admin_panel": True,
        }

    elif role == "sub_admin" or role == UserRole.sub_admin.value or role == DeptRole.sub_admin.value:
        # SUB_ADMIN has limited department permissions
        # Context: same_department (bool), is_dept_admin (bool)
        is_dept_admin = context.get("is_dept_admin", False)
        same_department = context.get("same_department", False)

        return {
            "can_view_all_orgs": False,
            "can_delete_users": False,
            "can_share_resources": same_department,  # Only within their department
            "can_transfer_resources": False,  # Cannot transfer
            "can_manage_departments": False,
            "can_create_users": False,  # Cannot create users
            "can_edit_org_settings": False,
            "can_view_all_dept_data": is_dept_admin,  # Can see dept data if assigned
            "can_manage_dept_members": False,  # Cannot manage members
            "can_impersonate_users": False,
            "can_access_admin_panel": True,
        }

    elif role == "member" or role == OrgRole.member.value or role == DeptRole.member.value:
        # MEMBER has minimal permissions - own data only
        is_owner = context.get("is_owner", False)

        return {
            "can_view_all_orgs": False,
            "can_delete_users": False,
            "can_share_resources": is_owner,  # Can share their own resources within dept
            "can_transfer_resources": False,
            "can_manage_departments": False,
            "can_create_users": False,
            "can_edit_org_settings": False,
            "can_view_all_dept_data": False,  # Only own data
            "can_manage_dept_members": False,
            "can_impersonate_users": False,
            "can_access_admin_panel": False,
        }

    # Unknown role - no permissions
    return permissions


async def get_user_effective_permissions(
    user: User,
    db: AsyncSession,
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, bool]:
    """
    Get effective permissions for a user, checking custom roles first.

    This function checks if the user has a custom role assigned via UserCustomRole.
    If found, it returns the base permissions from the custom role's base_role,
    merged with any permission overrides from RolePermissionOverride.

    If no custom role is assigned, it falls back to the standard role-based permissions.

    Args:
        user: The User object
        db: Database session
        context: Optional context for permission evaluation

    Returns:
        Dictionary of permissions with boolean values
    """
    # 1. Check if user has custom role
    custom_role_query = await db.execute(
        select(UserCustomRole, CustomRole)
        .join(CustomRole, CustomRole.id == UserCustomRole.role_id)
        .where(
            UserCustomRole.user_id == user.id,
            CustomRole.is_active == True
        )
        .order_by(UserCustomRole.assigned_at.desc())
        .limit(1)
    )
    result = custom_role_query.first()

    if result:
        user_custom_role, custom_role = result
        # Get base permissions from the custom role's base_role
        base_perms = get_role_permissions(custom_role.base_role, context)

        # Apply overrides from RolePermissionOverride
        overrides_query = await db.execute(
            select(RolePermissionOverride)
            .where(RolePermissionOverride.role_id == custom_role.id)
        )
        overrides = overrides_query.scalars().all()

        for override in overrides:
            base_perms[override.permission] = override.allowed

        return base_perms

    # 2. Fallback to standard role-based permissions
    return get_role_permissions(user.role.value, context)


async def get_role_permissions_with_overrides(
    role: str,
    context: Optional[Dict[str, Any]] = None,
    db: Optional[AsyncSession] = None,
    user_id: Optional[int] = None
) -> Dict[str, bool]:
    """
    Get permissions for a role with optional database-backed custom role overrides.

    This function supports both the original hardcoded permissions (when db and user_id
    are not provided) and database-backed custom roles (when both are provided).

    Args:
        role: The role name (e.g., "admin", "owner")
        context: Optional context for permission evaluation
        db: Optional database session for custom role lookup
        user_id: Optional user ID for custom role lookup

    Returns:
        Dictionary of permissions with boolean values
    """
    # If db and user_id provided, check for custom role assignment
    if db is not None and user_id is not None:
        # Check if user has custom role
        custom_role_query = await db.execute(
            select(UserCustomRole, CustomRole)
            .join(CustomRole, CustomRole.id == UserCustomRole.role_id)
            .where(
                UserCustomRole.user_id == user_id,
                CustomRole.is_active == True
            )
            .order_by(UserCustomRole.assigned_at.desc())
            .limit(1)
        )
        result = custom_role_query.first()

        if result:
            user_custom_role, custom_role = result
            # Get base permissions from the custom role's base_role
            base_perms = get_role_permissions(custom_role.base_role, context)

            # Apply overrides from RolePermissionOverride
            overrides_query = await db.execute(
                select(RolePermissionOverride)
                .where(RolePermissionOverride.role_id == custom_role.id)
            )
            overrides = overrides_query.scalars().all()

            for override in overrides:
                base_perms[override.permission] = override.allowed

            return base_perms

    # Fallback to standard hardcoded permissions
    return get_role_permissions(role, context)


def check_action_permission(role: str, action: str, context: Optional[Dict[str, Any]] = None) -> tuple[bool, str]:
    """
    Check if a role can perform a specific action.

    Returns: (allowed: bool, reason: str)
    """
    permissions = get_role_permissions(role, context)

    # Map actions to permission keys
    action_map = {
        "view_all_orgs": "can_view_all_orgs",
        "delete_users": "can_delete_users",
        "share_resources": "can_share_resources",
        "transfer_resources": "can_transfer_resources",
        "manage_departments": "can_manage_departments",
        "create_users": "can_create_users",
        "edit_org_settings": "can_edit_org_settings",
        "view_all_dept_data": "can_view_all_dept_data",
        "manage_dept_members": "can_manage_dept_members",
        "impersonate_users": "can_impersonate_users",
        "access_admin_panel": "can_access_admin_panel",
    }

    permission_key = action_map.get(action)

    if not permission_key:
        return False, f"Unknown action: {action}"

    allowed = permissions.get(permission_key, False)

    if allowed:
        reason = f"Role '{role}' has permission '{permission_key}'"
    else:
        reason = f"Role '{role}' does not have permission '{permission_key}'"

    return allowed, reason


# ==================== Endpoints ====================

@router.get("/access-matrix")
async def get_access_matrix(
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get the complete access control matrix for all roles.

    Returns a comprehensive matrix showing what each role can do.
    This is useful for:
    - Debugging access control issues
    - Understanding the permission model
    - Documenting the system's security model
    - Training new administrators

    **Only SUPERADMIN can access this endpoint.**
    """
    roles = ["SUPERADMIN", "OWNER", "ADMIN", "SUB_ADMIN", "MEMBER"]

    permissions = [
        "view_all_users",
        "create_users",
        "delete_users",
        "view_org_entities",
        "view_dept_entities",
        "view_own_entities",
        "edit_org_entities",
        "edit_dept_entities",
        "delete_dept_entities",
        "view_org_chats",
        "view_dept_chats",
        "view_org_calls",
        "manage_departments",
        "manage_org_members",
        "impersonate_users"
    ]

    matrix = {}

    for role in roles:
        role_lower = role.lower()
        context = {}
        if role in ["ADMIN", "SUB_ADMIN"]:
            context = {"is_dept_admin": True, "same_department": True}
        elif role == "MEMBER":
            context = {"is_owner": True}

        perms = get_role_permissions(role_lower, context)

        # Build permission matrix for this role
        role_perms = {}

        if role == "SUPERADMIN":
            # SUPERADMIN has everything
            for perm in permissions:
                role_perms[perm] = True
        elif role == "OWNER":
            role_perms["view_all_users"] = True
            role_perms["create_users"] = perms["can_create_users"]
            role_perms["delete_users"] = perms["can_delete_users"]
            role_perms["view_org_entities"] = True
            role_perms["view_dept_entities"] = True
            role_perms["view_own_entities"] = True
            role_perms["edit_org_entities"] = True
            role_perms["edit_dept_entities"] = True
            role_perms["delete_dept_entities"] = True
            role_perms["view_org_chats"] = True
            role_perms["view_dept_chats"] = True
            role_perms["view_org_calls"] = True
            role_perms["manage_departments"] = perms["can_manage_departments"]
            role_perms["manage_org_members"] = perms.get("can_manage_dept_members", True)
            role_perms["impersonate_users"] = perms["can_impersonate_users"]
        elif role == "ADMIN":
            role_perms["view_all_users"] = False
            role_perms["create_users"] = perms["can_create_users"]
            role_perms["delete_users"] = False
            role_perms["view_org_entities"] = False
            role_perms["view_dept_entities"] = perms["can_view_all_dept_data"]
            role_perms["view_own_entities"] = True
            role_perms["edit_org_entities"] = False
            role_perms["edit_dept_entities"] = True
            role_perms["delete_dept_entities"] = True
            role_perms["view_org_chats"] = False
            role_perms["view_dept_chats"] = True
            role_perms["view_org_calls"] = False
            role_perms["manage_departments"] = False
            role_perms["manage_org_members"] = False
            role_perms["impersonate_users"] = False
        elif role == "SUB_ADMIN":
            role_perms["view_all_users"] = False
            role_perms["create_users"] = False
            role_perms["delete_users"] = False
            role_perms["view_org_entities"] = False
            role_perms["view_dept_entities"] = perms["can_view_all_dept_data"]
            role_perms["view_own_entities"] = True
            role_perms["edit_org_entities"] = False
            role_perms["edit_dept_entities"] = True
            role_perms["delete_dept_entities"] = False
            role_perms["view_org_chats"] = False
            role_perms["view_dept_chats"] = True
            role_perms["view_org_calls"] = False
            role_perms["manage_departments"] = False
            role_perms["manage_org_members"] = False
            role_perms["impersonate_users"] = False
        elif role == "MEMBER":
            role_perms["view_all_users"] = False
            role_perms["create_users"] = False
            role_perms["delete_users"] = False
            role_perms["view_org_entities"] = False
            role_perms["view_dept_entities"] = False
            role_perms["view_own_entities"] = True
            role_perms["edit_org_entities"] = False
            role_perms["edit_dept_entities"] = False
            role_perms["delete_dept_entities"] = False
            role_perms["view_org_chats"] = False
            role_perms["view_dept_chats"] = False
            role_perms["view_org_calls"] = False
            role_perms["manage_departments"] = False
            role_perms["manage_org_members"] = False
            role_perms["impersonate_users"] = False

        matrix[role] = role_perms

    return {
        "roles": roles,
        "permissions": permissions,
        "matrix": matrix
    }


@router.post("/simulate-access")
async def simulate_access(
    request_body: SimulateAccessRequest,
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Simulate access control for a specific role.

    This endpoint allows you to test what permissions a role has
    in a given organization/department context.

    **Only SUPERADMIN can access this endpoint.**
    """
    role = request_body.role
    org_id = request_body.org_id
    dept_id = request_body.dept_id

    # Build context
    context = {}
    if dept_id:
        context["is_dept_admin"] = True
        context["same_department"] = True
    elif role.upper() == "MEMBER":
        context["is_owner"] = True

    # Get permissions for this role
    perms = get_role_permissions(role.lower(), context)

    # Build response based on role
    response = {}

    if role.upper() == "SUPERADMIN":
        response = {
            "can_view_all_users": True,
            "can_delete_users": True,
            "can_impersonate": True,
            "can_view_all_orgs": True,
            "can_manage_departments": True
        }
    elif role.upper() == "OWNER":
        response = {
            "can_view_org_entities": True,
            "can_edit_org_entities": True,
            "can_delete_org_entities": True,
            "can_manage_org_members": perms.get("can_manage_dept_members", True),
            "can_manage_departments": perms["can_manage_departments"],
            "can_impersonate": perms["can_impersonate_users"],
            "can_view_all_orgs": perms["can_view_all_orgs"]
        }
    elif role.upper() == "ADMIN":
        response = {
            "can_view_dept_entities": perms["can_view_all_dept_data"],
            "can_edit_dept_entities": True,
            "can_delete_dept_entities": True,
            "can_manage_dept_members": perms["can_manage_dept_members"],
            "can_view_all_org_entities": False,
            "can_manage_org_members": False,
            "can_impersonate": perms["can_impersonate_users"]
        }
    elif role.upper() == "SUB_ADMIN":
        response = {
            "can_view_dept_entities": perms["can_view_all_dept_data"],
            "can_view_dept_chats": perms["can_view_all_dept_data"],
            "can_edit_dept_entities": True,
            "can_delete_dept_admins": False,
            "can_manage_dept_members": True,
            "can_delete_dept_members": False
        }
    elif role.upper() == "MEMBER":
        response = {
            "can_view_own_entities": True,
            "can_edit_own_entities": True,
            "can_view_dept_entities": False,
            "can_view_all_dept_chats": False,
            "can_view_shared_entities": True,
            "can_manage_dept_members": False,
            "can_impersonate": perms["can_impersonate_users"]
        }

    return response


@router.post("/impersonate")
async def impersonate_user(
    request_body: ImpersonateRequest,
    request: Request,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Impersonate a user as SUPERADMIN.

    Creates a special JWT token with:
    - subject (sub): impersonated user's ID
    - original_user_id: superadmin's ID
    - is_impersonating: true
    - Token expires in 1 hour

    All impersonation sessions are logged for audit purposes.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get target user
    result = await db.execute(select(User).where(User.id == request_body.user_id))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot impersonate yourself
    if target_user.id == superadmin.id:
        raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

    # Cannot impersonate another superadmin
    if target_user.role == UserRole.superadmin:
        raise HTTPException(status_code=403, detail="Cannot impersonate another superadmin")

    # Cannot impersonate inactive users
    if not target_user.is_active:
        raise HTTPException(status_code=400, detail="Cannot impersonate inactive user")

    # Create impersonation token (expires in 1 hour)
    token = create_impersonation_token(
        impersonated_user_id=target_user.id,
        original_user_id=superadmin.id,
        token_version=target_user.token_version
    )

    # Log impersonation session for audit
    impersonation_log = ImpersonationLog(
        superadmin_id=superadmin.id,
        impersonated_user_id=target_user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent")
    )
    db.add(impersonation_log)
    await db.commit()

    return {
        "token": token,
        "impersonated_user": {
            "id": target_user.id,
            "email": target_user.email,
            "name": target_user.name,
            "role": target_user.role.value,
            "is_active": target_user.is_active,
            "created_at": target_user.created_at.isoformat()
        }
    }


@router.post("/exit-impersonation")
async def exit_impersonation(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """
    Exit impersonation and return to original SUPERADMIN account.

    This endpoint should be called when a SUPERADMIN wants to stop
    impersonating and return to their own account.

    **Returns a regular token for the SUPERADMIN.**
    """
    # Decode the impersonation token to get original user
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm]
        )
        is_impersonating = payload.get("is_impersonating", False)
        original_user_id = payload.get("original_user_id")

        if not is_impersonating or not original_user_id:
            raise HTTPException(
                status_code=400,
                detail="Not in impersonation mode"
            )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Get the original superadmin user
    result = await db.execute(select(User).where(User.id == original_user_id))
    original_user = result.scalar_one_or_none()

    if not original_user:
        raise HTTPException(status_code=404, detail="Original user not found")

    # Verify original user is a SUPERADMIN
    if original_user.role != UserRole.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only superadmin can use impersonation"
        )

    # Create regular token for superadmin
    token = create_access_token({
        "sub": str(original_user.id),
        "token_version": original_user.token_version
    })

    return {
        "token": token,
        "message": "Exited impersonation mode"
    }


@router.get("/impersonation-logs", response_model=List[ImpersonationLogResponse])
async def get_impersonation_logs(
    limit: int = Query(100, description="Maximum number of logs to return"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin)
):
    """
    Get audit log of all impersonation sessions.

    Returns a list of all impersonation sessions, including:
    - Who impersonated whom
    - When the session started
    - IP address and user agent
    - Session duration

    **Only accessible by SUPERADMIN.**
    """
    result = await db.execute(
        select(ImpersonationLog)
        .order_by(ImpersonationLog.started_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()

    # Get user info for all logs
    log_responses = []
    for log in logs:
        superadmin_result = await db.execute(
            select(User).where(User.id == log.superadmin_id)
        )
        superadmin = superadmin_result.scalar_one_or_none()

        impersonated_result = await db.execute(
            select(User).where(User.id == log.impersonated_user_id)
        )
        impersonated = impersonated_result.scalar_one_or_none()

        log_responses.append(ImpersonationLogResponse(
            id=log.id,
            superadmin_id=log.superadmin_id,
            superadmin_name=superadmin.name if superadmin else "Unknown",
            superadmin_email=superadmin.email if superadmin else "Unknown",
            impersonated_user_id=log.impersonated_user_id,
            impersonated_user_name=impersonated.name if impersonated else "Unknown",
            impersonated_user_email=impersonated.email if impersonated else "Unknown",
            started_at=log.started_at,
            ended_at=log.ended_at,
            ip_address=log.ip_address,
            user_agent=log.user_agent,
        ))

    return log_responses


@router.get("/role-permissions")
async def get_role_permissions_list(
    role: Optional[str] = Query(None, description="Filter by specific role"),
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed permissions for each role (or a specific role).

    This endpoint provides a detailed breakdown of what each role can do.
    Useful for:
    - Understanding the permission model
    - Generating documentation
    - Building UI permission indicators

    **Query Parameters:**
    - `role` (optional): Filter to show only one role's permissions

    **Only SUPERADMIN can access this endpoint.**
    """
    roles = ["SUPERADMIN", "OWNER", "ADMIN", "SUB_ADMIN", "MEMBER"]

    if role:
        role_upper = role.upper()
        if role_upper not in roles:
            raise HTTPException(status_code=404, detail=f"Role '{role}' not found")
        roles = [role_upper]

    result = {}

    for role_name in roles:
        role_lower = role_name.lower()
        context = {}
        if role_name in ["ADMIN", "SUB_ADMIN"]:
            context = {"is_dept_admin": True, "same_department": True}
        elif role_name == "MEMBER":
            context = {"is_owner": True}

        perms = get_role_permissions(role_lower, context)

        # Group permissions by category
        role_perms = {
            "users": {},
            "organizations": {},
            "departments": {},
            "entities": {},
            "chats": {},
            "calls": {},
            "sharing": {},
            "admin": {}
        }

        if role_name == "SUPERADMIN":
            role_perms["users"] = {
                "view_all_users": True,
                "create_users": True,
                "delete_users": True
            }
            role_perms["organizations"] = {
                "view_all_orgs": True,
                "edit_org_settings": True
            }
            role_perms["departments"] = {
                "manage_departments": True,
                "view_all_dept_data": True
            }
            role_perms["entities"] = {
                "view_org_entities": True,
                "view_dept_entities": True,
                "edit_org_entities": True,
                "edit_dept_entities": True,
                "delete_dept_entities": True
            }
            role_perms["chats"] = {
                "view_org_chats": True,
                "view_dept_chats": True
            }
            role_perms["calls"] = {
                "view_org_calls": True
            }
            role_perms["sharing"] = {
                "share_resources": True,
                "transfer_resources": True
            }
            role_perms["admin"] = {
                "impersonate": True,
                "manage_org": True,
                "access_admin_panel": True
            }
        elif role_name == "OWNER":
            role_perms["users"] = {
                "view_all_users": True,
                "create_users": True,
                "delete_users": True
            }
            role_perms["organizations"] = {
                "view_all_orgs": False,
                "edit_org_settings": True
            }
            role_perms["departments"] = {
                "manage_departments": True,
                "view_all_dept_data": True
            }
            role_perms["entities"] = {
                "view_org_entities": True,
                "view_dept_entities": True,
                "edit_org_entities": True,
                "edit_dept_entities": True,
                "delete_dept_entities": True
            }
            role_perms["chats"] = {
                "view_org_chats": True,
                "view_dept_chats": True
            }
            role_perms["calls"] = {
                "view_org_calls": True
            }
            role_perms["sharing"] = {
                "share_resources": True,
                "transfer_resources": True
            }
            role_perms["admin"] = {
                "impersonate": False,
                "manage_org": True,
                "access_admin_panel": True
            }
        elif role_name == "ADMIN":
            role_perms["users"] = {
                "view_all_users": False,
                "create_users": perms["can_create_users"],
                "delete_users": False
            }
            role_perms["organizations"] = {
                "view_all_orgs": False,
                "edit_org_settings": False
            }
            role_perms["departments"] = {
                "manage_departments": False,
                "view_all_dept_data": perms["can_view_all_dept_data"]
            }
            role_perms["entities"] = {
                "view_org_entities": False,
                "view_dept_entities": True,
                "edit_org_entities": False,
                "edit_dept_entities": True,
                "delete_dept_entities": True
            }
            role_perms["chats"] = {
                "view_org_chats": False,
                "view_dept_chats": True
            }
            role_perms["calls"] = {
                "view_org_calls": False
            }
            role_perms["sharing"] = {
                "share_resources": perms["can_share_resources"],
                "transfer_resources": perms["can_transfer_resources"]
            }
            role_perms["admin"] = {
                "impersonate": False,
                "manage_org": False,
                "access_admin_panel": True
            }
        elif role_name == "SUB_ADMIN":
            role_perms["users"] = {
                "view_all_users": False,
                "create_users": False,
                "delete_users": False
            }
            role_perms["organizations"] = {
                "view_all_orgs": False,
                "edit_org_settings": False
            }
            role_perms["departments"] = {
                "manage_departments": False,
                "view_all_dept_data": perms["can_view_all_dept_data"]
            }
            role_perms["entities"] = {
                "view_org_entities": False,
                "view_dept_entities": True,
                "edit_org_entities": False,
                "edit_dept_entities": True,
                "delete_dept_entities": False
            }
            role_perms["chats"] = {
                "view_org_chats": False,
                "view_dept_chats": True
            }
            role_perms["calls"] = {
                "view_org_calls": False
            }
            role_perms["sharing"] = {
                "share_resources": perms["can_share_resources"],
                "transfer_resources": False
            }
            role_perms["admin"] = {
                "impersonate": False,
                "manage_org": False,
                "access_admin_panel": True
            }
        elif role_name == "MEMBER":
            role_perms["users"] = {
                "view_all_users": False,
                "create_users": False,
                "delete_users": False
            }
            role_perms["organizations"] = {
                "view_all_orgs": False,
                "edit_org_settings": False
            }
            role_perms["departments"] = {
                "manage_departments": False,
                "view_all_dept_data": False
            }
            role_perms["entities"] = {
                "view_org_entities": False,
                "view_dept_entities": False,
                "edit_org_entities": False,
                "edit_dept_entities": False,
                "delete_dept_entities": False
            }
            role_perms["chats"] = {
                "view_org_chats": False,
                "view_dept_chats": False
            }
            role_perms["calls"] = {
                "view_org_calls": False
            }
            role_perms["sharing"] = {
                "share_resources": perms["can_share_resources"],
                "transfer_resources": False
            }
            role_perms["admin"] = {
                "impersonate": False,
                "manage_org": False,
                "access_admin_panel": False
            }

        result[role_name] = role_perms

    return result


@router.get("/users/{user_id}/details", response_model=UserDetailResponse)
async def get_user_details(
    user_id: int,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed information about a specific user.

    This endpoint provides comprehensive user information including:
    - Basic user data (email, name, role, etc.)
    - Organization memberships and roles
    - Department memberships and roles
    - Security information (token version, login attempts, lockout status)

    Useful for:
    - Debugging user access issues
    - Understanding user's permissions
    - Verifying user setup is correct

    **Only SUPERADMIN can access this endpoint.**
    """
    # Get user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get organization memberships
    org_memberships = await db.execute(
        select(OrgMember, Organization)
        .join(Organization, Organization.id == OrgMember.org_id)
        .where(OrgMember.user_id == user_id)
    )

    organizations = []
    for org_member, org in org_memberships.all():
        organizations.append({
            "org_id": org.id,
            "org_name": org.name,
            "org_slug": org.slug,
            "role": org_member.role.value,
            "joined_at": org_member.created_at.isoformat() if org_member.created_at else None,
        })

    # Get department memberships
    dept_memberships = await db.execute(
        select(DepartmentMember, Department)
        .join(Department, Department.id == DepartmentMember.department_id)
        .where(DepartmentMember.user_id == user_id)
    )

    departments = []
    for dept_member, dept in dept_memberships.all():
        departments.append({
            "dept_id": dept.id,
            "dept_name": dept.name,
            "dept_color": dept.color,
            "role": dept_member.role.value,
            "joined_at": dept_member.created_at.isoformat() if dept_member.created_at else None,
        })

    return UserDetailResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at,
        telegram_id=user.telegram_id,
        telegram_username=user.telegram_username,
        organizations=organizations,
        departments=departments,
        token_version=user.token_version,
        failed_login_attempts=user.failed_login_attempts,
        locked_until=user.locked_until,
    )


# ==================== Sandbox Test Environment Endpoints ====================


@router.post("/sandbox/create", response_model=SandboxCreateResponse)
async def create_sandbox(
    request_body: Optional[SandboxCreateRequest] = None,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Create an isolated test environment for testing and development.

    Creates:
    - "Sandbox Test Department" department in specified organization
    - 4 test users with different roles:
      - sandbox_owner@test.local (OrgRole.owner)
      - sandbox_admin@test.local (DeptRole.lead)
      - sandbox_subadmin@test.local (DeptRole.sub_admin)
      - sandbox_member@test.local (DeptRole.member)
    - 5 test entities (contacts) with different owners
    - 3 test chats linked to entities
    - 2 test call recordings
    - Sharing relationships between users

    All sandbox data is tagged with "sandbox" for easy identification.
    All sandbox users have password: "sandbox123"

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get organization from request or auto-detect first available
    org_id = request_body.org_id if request_body else None

    if org_id:
        org_result = await db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise HTTPException(
                status_code=404,
                detail=f"Organization with id {org_id} not found"
            )
    else:
        # Auto-detect first organization
        org_result = await db.execute(
            select(Organization).order_by(Organization.id).limit(1)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise HTTPException(
                status_code=404,
                detail="No organizations found. Create an organization first."
            )

    # Check if sandbox already exists in this organization
    result = await db.execute(
        select(Department)
        .where(Department.org_id == org.id)
        .where(Department.name == "Sandbox Test Department")
    )
    existing_dept = result.scalar_one_or_none()

    if existing_dept:
        raise HTTPException(
            status_code=409,
            detail="Sandbox already exists. Delete it first using DELETE /api/admin/sandbox"
        )

    # Check if sandbox users already exist (could be leftover from failed creation)
    sandbox_emails = [
        "sandbox_owner@test.local",
        "sandbox_admin@test.local",
        "sandbox_subadmin@test.local",
        "sandbox_member@test.local"
    ]
    existing_users_result = await db.execute(
        select(User).where(User.email.in_(sandbox_emails))
    )
    existing_users = existing_users_result.scalars().all()

    if existing_users:
        existing_emails = [u.email for u in existing_users]
        raise HTTPException(
            status_code=409,
            detail=f"Sandbox users already exist: {', '.join(existing_emails)}. "
                   f"Delete them first or run DELETE /api/admin/sandbox to clean up."
        )

    # 1. Create Sandbox Test Department
    sandbox_dept = Department(
        org_id=org.id,
        name="Sandbox Test Department",
        description="Automated test environment for QA and development",
        color="#FF6B35",
        is_active=True
    )
    db.add(sandbox_dept)
    await db.flush()

    # 2. Create 4 test users
    password_hash_value = hash_password("sandbox123")

    sandbox_users = [
        {
            "email": "sandbox_owner@test.local",
            "name": "Sandbox Owner",
            "role": UserRole.admin,
            "org_role": OrgRole.owner,
            "dept_role": DeptRole.lead
        },
        {
            "email": "sandbox_admin@test.local",
            "name": "Sandbox Admin",
            "role": UserRole.admin,
            "org_role": OrgRole.admin,
            "dept_role": DeptRole.lead
        },
        {
            "email": "sandbox_subadmin@test.local",
            "name": "Sandbox SubAdmin",
            "role": UserRole.sub_admin,
            "org_role": OrgRole.member,
            "dept_role": DeptRole.sub_admin
        },
        {
            "email": "sandbox_member@test.local",
            "name": "Sandbox Member",
            "role": UserRole.admin,
            "org_role": OrgRole.member,
            "dept_role": DeptRole.member
        }
    ]

    created_users = []
    user_objects = []

    for user_data in sandbox_users:
        # Create user
        user = User(
            email=user_data["email"],
            name=user_data["name"],
            password_hash=password_hash_value,
            role=user_data["role"],
            is_active=True
        )
        db.add(user)
        await db.flush()

        # Add to organization
        org_member = OrgMember(
            org_id=org.id,
            user_id=user.id,
            role=user_data["org_role"],
            invited_by=superadmin.id
        )
        db.add(org_member)

        # Add to sandbox department
        dept_member = DepartmentMember(
            department_id=sandbox_dept.id,
            user_id=user.id,
            role=user_data["dept_role"]
        )
        db.add(dept_member)

        created_users.append(SandboxUserInfo(
            id=user.id,
            email=user.email,
            name=user.name,
            password="sandbox123",
            role=user.role.value,
            org_role=user_data["org_role"].value,
            dept_role=user_data["dept_role"].value
        ))
        user_objects.append(user)

    await db.flush()

    # 3. Create 5 test entities (contacts)
    entity_data = [
        {
            "name": "John Candidate",
            "type": EntityType.candidate,
            "status": EntityStatus.interview,
            "email": "john.candidate@example.com",
            "phone": "+1234567890",
            "position": "Senior Developer",
            "company": "Tech Corp",
            "owner_idx": 0
        },
        {
            "name": "Sarah Client",
            "type": EntityType.client,
            "status": EntityStatus.active,
            "email": "sarah.client@example.com",
            "phone": "+1234567891",
            "company": "Client Corp",
            "owner_idx": 1
        },
        {
            "name": "Mike Contractor",
            "type": EntityType.contractor,
            "status": EntityStatus.negotiation,
            "email": "mike.contractor@example.com",
            "phone": "+1234567892",
            "position": "QA Engineer",
            "owner_idx": 1
        },
        {
            "name": "Lisa Lead",
            "type": EntityType.lead,
            "status": EntityStatus.new,
            "email": "lisa.lead@example.com",
            "phone": "+1234567893",
            "company": "Startup Inc",
            "owner_idx": 2
        },
        {
            "name": "Alex Partner",
            "type": EntityType.partner,
            "status": EntityStatus.active,
            "email": "alex.partner@example.com",
            "phone": "+1234567894",
            "company": "Partner LLC",
            "owner_idx": 3
        }
    ]

    entity_ids = []
    entity_objects = []

    for entity_info in entity_data:
        entity = Entity(
            org_id=org.id,
            department_id=sandbox_dept.id,
            type=entity_info["type"],
            name=entity_info["name"],
            status=entity_info["status"],
            email=entity_info["email"],
            phone=entity_info["phone"],
            position=entity_info.get("position"),
            company=entity_info.get("company"),
            tags=["sandbox"],
            created_by=user_objects[entity_info["owner_idx"]].id
        )
        db.add(entity)
        await db.flush()
        entity_ids.append(entity.id)
        entity_objects.append(entity)

    # 4. Create test chats linked to entities (more variety)
    chat_data = [
        {
            "title": "Interview with John Candidate",
            "chat_type": ChatType.hr,
            "entity_idx": 0,
            "owner_idx": 0  # Owner
        },
        {
            "title": "Client Meeting - Sarah",
            "chat_type": ChatType.client,
            "entity_idx": 1,
            "owner_idx": 1  # Admin
        },
        {
            "title": "Contractor Negotiation - Mike",
            "chat_type": ChatType.contractor,
            "entity_idx": 2,
            "owner_idx": 1  # Admin
        },
        {
            "title": "Lead Discussion - Lisa",
            "chat_type": ChatType.sales,
            "entity_idx": 3,
            "owner_idx": 2  # SubAdmin
        },
        {
            "title": "Partner Onboarding - Alex",
            "chat_type": ChatType.work,
            "entity_idx": 4,
            "owner_idx": 3  # Member
        },
        {
            "title": "Technical Support Chat",
            "chat_type": ChatType.support,
            "entity_idx": None,
            "owner_idx": 0  # Owner - no entity linked
        },
        {
            "title": "Project Alpha Discussion",
            "chat_type": ChatType.project,
            "entity_idx": None,
            "owner_idx": 1  # Admin - no entity linked
        }
    ]

    chat_ids = []
    chat_objects = []

    for idx, chat_info in enumerate(chat_data):
        # Handle optional entity linking
        entity_id = None
        if chat_info["entity_idx"] is not None:
            entity_id = entity_objects[chat_info["entity_idx"]].id

        chat = Chat(
            org_id=org.id,
            telegram_chat_id=1000000 + idx,  # Fake telegram chat IDs
            title=chat_info["title"],
            custom_name=chat_info["title"],
            chat_type=chat_info["chat_type"],
            owner_id=user_objects[chat_info["owner_idx"]].id,
            entity_id=entity_id,
            is_active=True
        )
        db.add(chat)
        await db.flush()
        chat_ids.append(chat.id)
        chat_objects.append(chat)

        # Add some sample messages
        for msg_idx in range(3):
            message = Message(
                chat_id=chat.id,
                telegram_message_id=1000 + idx * 10 + msg_idx,
                telegram_user_id=12345678 + idx,
                username=f"test_user_{idx}",
                first_name=user_objects[chat_info["owner_idx"]].name.split()[0],
                last_name=user_objects[chat_info["owner_idx"]].name.split()[1] if len(user_objects[chat_info["owner_idx"]].name.split()) > 1 else "",
                content=f"Test message {msg_idx + 1} in {chat_info['title']}",
                content_type="text",
                is_imported=False
            )
            db.add(message)

    # 5. Create test call recordings (more variety)
    call_data = [
        {
            "title": "Technical Interview Call",
            "entity_idx": 0,
            "owner_idx": 0,  # Owner
            "source_type": CallSource.meet,
            "status": CallStatus.done,
            "duration_seconds": 3600
        },
        {
            "title": "Client Discovery Call",
            "entity_idx": 1,
            "owner_idx": 1,  # Admin
            "source_type": CallSource.zoom,
            "status": CallStatus.done,
            "duration_seconds": 2400
        },
        {
            "title": "Contractor Onboarding",
            "entity_idx": 2,
            "owner_idx": 1,  # Admin
            "source_type": CallSource.fireflies,
            "status": CallStatus.done,
            "duration_seconds": 1800
        },
        {
            "title": "Sales Demo Call",
            "entity_idx": 3,
            "owner_idx": 2,  # SubAdmin
            "source_type": CallSource.meet,
            "status": CallStatus.done,
            "duration_seconds": 2700
        },
        {
            "title": "Partner Strategy Session",
            "entity_idx": 4,
            "owner_idx": 3,  # Member
            "source_type": CallSource.zoom,
            "status": CallStatus.done,
            "duration_seconds": 3300
        },
        {
            "title": "Team Standup Recording",
            "entity_idx": None,
            "owner_idx": 0,  # Owner - no entity linked
            "source_type": CallSource.meet,
            "status": CallStatus.done,
            "duration_seconds": 900
        }
    ]

    call_ids = []
    call_objects = []

    for call_info in call_data:
        # Handle optional entity linking
        call_entity_id = None
        if call_info["entity_idx"] is not None:
            call_entity_id = entity_objects[call_info["entity_idx"]].id

        call = CallRecording(
            org_id=org.id,
            title=call_info["title"],
            entity_id=call_entity_id,
            owner_id=user_objects[call_info["owner_idx"]].id,
            source_type=call_info["source_type"],
            status=call_info["status"],
            duration_seconds=call_info["duration_seconds"],
            transcript=f"Sample transcript for {call_info['title']}",
            summary=f"This is a test call recording for sandbox environment.",
            started_at=datetime.utcnow() - timedelta(hours=2),
            ended_at=datetime.utcnow() - timedelta(hours=1),
            processed_at=datetime.utcnow()
        )
        db.add(call)
        await db.flush()
        call_ids.append(call.id)
        call_objects.append(call)

    # 6. Create sharing relationships (comprehensive cross-user sharing)
    sharing_data = [
        # Owner shares with others
        {
            "resource_type": ResourceType.entity,
            "resource": entity_objects[0],  # John Candidate
            "from_idx": 0,  # Owner
            "to_idx": 1,    # Admin
            "access_level": AccessLevel.edit,
            "note": "Admin has edit access to candidate"
        },
        {
            "resource_type": ResourceType.chat,
            "resource": chat_objects[0],  # Interview with John
            "from_idx": 0,  # Owner
            "to_idx": 2,    # SubAdmin
            "access_level": AccessLevel.view,
            "note": "SubAdmin can view interview chat"
        },
        {
            "resource_type": ResourceType.call,
            "resource": call_objects[0],  # Technical Interview Call
            "from_idx": 0,  # Owner
            "to_idx": 3,    # Member
            "access_level": AccessLevel.view,
            "note": "Member can view call recording"
        },
        # Admin shares with others
        {
            "resource_type": ResourceType.entity,
            "resource": entity_objects[1],  # Sarah Client
            "from_idx": 1,  # Admin
            "to_idx": 2,    # SubAdmin
            "access_level": AccessLevel.view,
            "note": "SubAdmin can view client info"
        },
        {
            "resource_type": ResourceType.chat,
            "resource": chat_objects[1],  # Client Meeting - Sarah
            "from_idx": 1,  # Admin
            "to_idx": 3,    # Member
            "access_level": AccessLevel.view,
            "note": "Member can view client meeting"
        },
        {
            "resource_type": ResourceType.call,
            "resource": call_objects[1],  # Client Discovery Call
            "from_idx": 1,  # Admin
            "to_idx": 0,    # Owner
            "access_level": AccessLevel.full,
            "note": "Owner has full access"
        },
        # SubAdmin shares with member
        {
            "resource_type": ResourceType.entity,
            "resource": entity_objects[3],  # Lisa Lead
            "from_idx": 2,  # SubAdmin
            "to_idx": 3,    # Member
            "access_level": AccessLevel.view,
            "note": "Member can view lead info"
        },
        {
            "resource_type": ResourceType.call,
            "resource": call_objects[3],  # Sales Demo Call
            "from_idx": 2,  # SubAdmin
            "to_idx": 0,    # Owner
            "access_level": AccessLevel.edit,
            "note": "Owner can edit sales demo"
        },
        # Cross-sharing for member
        {
            "resource_type": ResourceType.call,
            "resource": call_objects[4],  # Partner Strategy Session
            "from_idx": 3,  # Member
            "to_idx": 1,    # Admin
            "access_level": AccessLevel.view,
            "note": "Admin can review partner session"
        },
    ]

    for share_info in sharing_data:
        resource = share_info["resource"]
        share = SharedAccess(
            resource_type=share_info["resource_type"],
            resource_id=resource.id,
            shared_by_id=user_objects[share_info["from_idx"]].id,
            shared_with_id=user_objects[share_info["to_idx"]].id,
            access_level=share_info["access_level"],
            note=share_info["note"]
        )
        # Set the appropriate foreign key based on resource type
        if share_info["resource_type"] == ResourceType.entity:
            share.entity_id = resource.id
        elif share_info["resource_type"] == ResourceType.chat:
            share.chat_id = resource.id
        elif share_info["resource_type"] == ResourceType.call:
            share.call_id = resource.id
        db.add(share)

    # Commit with error handling
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        error_detail = str(e.orig) if hasattr(e, 'orig') else str(e)
        raise HTTPException(
            status_code=409,
            detail=f"Database integrity error during sandbox creation. "
                   f"This usually means some sandbox data already exists. "
                   f"Try running DELETE /api/admin/sandbox first. Error: {error_detail}"
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create sandbox: {str(e)}"
        )

    # Build response with full objects
    entities_response = [
        SandboxEntityInfo(
            id=entity.id,
            created_by=entity.created_by,
            name=entity.name,
            email=entity.email or "",
            tags=entity.tags or []
        )
        for entity in entity_objects
    ]

    chats_response = [
        SandboxChatInfo(
            id=chat.id,
            owner_id=chat.owner_id,
            title=chat.title or ""
        )
        for chat in chat_objects
    ]

    calls_response = [
        SandboxCallInfo(
            id=call.id,
            owner_id=call.owner_id,
            title=call.title or ""
        )
        for call in call_objects
    ]

    return SandboxCreateResponse(
        department_id=sandbox_dept.id,
        users=created_users,
        entities=entities_response,
        chats=chats_response,
        calls=calls_response
    )


@router.delete("/sandbox")
async def delete_sandbox(
    org_id: Optional[int] = Query(None, description="Organization ID (optional, auto-detects if not provided)"),
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete all sandbox test data.

    Removes:
    - All sandbox users (sandbox_*@test.local)
    - Sandbox Test Department
    - All associated entities, chats, calls
    - All shared access records
    - Cascade cleanup of all related data

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get organization from request or auto-detect
    if org_id:
        org_result = await db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise HTTPException(
                status_code=404,
                detail=f"Organization with id {org_id} not found"
            )
    else:
        # Auto-detect organization that has sandbox
        org_result = await db.execute(
            select(Organization)
            .join(Department, Department.org_id == Organization.id)
            .where(Department.name == "Sandbox Test Department")
            .limit(1)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise HTTPException(
                status_code=404,
                detail="No sandbox found in any organization"
            )

    # Find sandbox department
    result = await db.execute(
        select(Department)
        .where(Department.org_id == org.id)
        .where(Department.name == "Sandbox Test Department")
    )
    sandbox_dept = result.scalar_one_or_none()

    if not sandbox_dept:
        raise HTTPException(
            status_code=404,
            detail="Sandbox does not exist"
        )

    # Find all sandbox users
    sandbox_emails = [
        "sandbox_owner@test.local",
        "sandbox_admin@test.local",
        "sandbox_subadmin@test.local",
        "sandbox_member@test.local"
    ]

    sandbox_users_result = await db.execute(
        select(User).where(User.email.in_(sandbox_emails))
    )
    sandbox_users = sandbox_users_result.scalars().all()

    # Count items before deletion
    deleted_count = {
        "users": len(sandbox_users),
        "entities": 0,
        "chats": 0,
        "calls": 0,
        "messages": 0,
        "shared_access": 0
    }

    # Count entities
    entities_result = await db.execute(
        select(Entity).where(Entity.department_id == sandbox_dept.id)
    )
    entities = entities_result.scalars().all()
    deleted_count["entities"] = len(entities)

    # Count chats and messages
    for user in sandbox_users:
        chats_result = await db.execute(
            select(Chat).where(Chat.owner_id == user.id)
        )
        chats = chats_result.scalars().all()
        deleted_count["chats"] += len(chats)

        for chat in chats:
            messages_result = await db.execute(
                select(Message).where(Message.chat_id == chat.id)
            )
            messages = messages_result.scalars().all()
            deleted_count["messages"] += len(messages)

    # Count calls
    for user in sandbox_users:
        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.owner_id == user.id)
        )
        calls = calls_result.scalars().all()
        deleted_count["calls"] += len(calls)

    # Count shared access
    for user in sandbox_users:
        shared_result = await db.execute(
            select(SharedAccess).where(
                (SharedAccess.shared_by_id == user.id) | (SharedAccess.shared_with_id == user.id)
            )
        )
        shared = shared_result.scalars().all()
        deleted_count["shared_access"] += len(shared)

    # Delete in proper order to avoid FK constraints
    # 1. Delete shared access records first
    await db.execute(
        delete(SharedAccess).where(
            SharedAccess.shared_by_id.in_([u.id for u in sandbox_users])
        )
    )
    await db.execute(
        delete(SharedAccess).where(
            SharedAccess.shared_with_id.in_([u.id for u in sandbox_users])
        )
    )

    # 2. Delete messages
    for user in sandbox_users:
        chats_result = await db.execute(
            select(Chat).where(Chat.owner_id == user.id)
        )
        chats = chats_result.scalars().all()
        for chat in chats:
            await db.execute(delete(Message).where(Message.chat_id == chat.id))

    # 3. Delete chats
    for user in sandbox_users:
        await db.execute(delete(Chat).where(Chat.owner_id == user.id))

    # 4. Delete call recordings
    for user in sandbox_users:
        await db.execute(delete(CallRecording).where(CallRecording.owner_id == user.id))

    # 5. Delete entities
    await db.execute(delete(Entity).where(Entity.department_id == sandbox_dept.id))

    # 6. Delete department members
    await db.execute(delete(DepartmentMember).where(DepartmentMember.department_id == sandbox_dept.id))

    # 7. Delete org members for sandbox users
    for user in sandbox_users:
        await db.execute(delete(OrgMember).where(OrgMember.user_id == user.id))

    # 8. Delete sandbox users
    for user in sandbox_users:
        await db.execute(delete(User).where(User.id == user.id))

    # 9. Delete sandbox department
    await db.execute(delete(Department).where(Department.id == sandbox_dept.id))

    # Commit with error handling
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete sandbox: {str(e)}"
        )

    return {
        "message": "Sandbox environment deleted successfully",
        "deleted": deleted_count
    }


@router.get("/sandbox/status", response_model=SandboxStatusResponse)
async def get_sandbox_status(
    org_id: Optional[int] = Query(None, description="Organization ID (optional, auto-detects if not provided)"),
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Check if sandbox test environment exists.

    Returns:
    - Whether sandbox exists
    - Department ID and name if exists
    - List of sandbox users with roles
    - Stats: count of entities, chats, and calls

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get organization from request or auto-detect
    if org_id:
        org_result = await db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise HTTPException(
                status_code=404,
                detail=f"Organization with id {org_id} not found"
            )
    else:
        # Try to find organization with sandbox first, otherwise use first org
        org_result = await db.execute(
            select(Organization)
            .join(Department, Department.org_id == Organization.id)
            .where(Department.name == "Sandbox Test Department")
            .limit(1)
        )
        org = org_result.scalar_one_or_none()

        if not org:
            # Fallback to first organization
            org_result = await db.execute(
                select(Organization).order_by(Organization.id).limit(1)
            )
            org = org_result.scalar_one_or_none()

        if not org:
            # No organizations at all - return empty status
            return {
                "exists": False,
                "department_id": None,
                "department_name": None,
                "users": [],
                "stats": {"contacts": 0, "chats": 0, "calls": 0}
            }

    # Find sandbox department
    result = await db.execute(
        select(Department)
        .where(Department.org_id == org.id)
        .where(Department.name == "Sandbox Test Department")
    )
    sandbox_dept = result.scalar_one_or_none()

    if not sandbox_dept:
        return {
            "exists": False,
            "department_id": None,
            "department_name": None,
            "users": [],
            "stats": {"contacts": 0, "chats": 0, "calls": 0}
        }

    # Find sandbox users
    sandbox_emails = [
        "sandbox_owner@test.local",
        "sandbox_admin@test.local",
        "sandbox_subadmin@test.local",
        "sandbox_member@test.local"
    ]

    sandbox_users_result = await db.execute(
        select(User).where(User.email.in_(sandbox_emails))
    )
    sandbox_users = sandbox_users_result.scalars().all()

    users_info = []
    for user in sandbox_users:
        # Get org role
        org_member_result = await db.execute(
            select(OrgMember)
            .where(OrgMember.user_id == user.id)
            .where(OrgMember.org_id == org.id)
        )
        org_member = org_member_result.scalar_one_or_none()

        # Get dept role
        dept_member_result = await db.execute(
            select(DepartmentMember)
            .where(DepartmentMember.user_id == user.id)
            .where(DepartmentMember.department_id == sandbox_dept.id)
        )
        dept_member = dept_member_result.scalar_one_or_none()

        # Determine display role and label
        if org_member and org_member.role.value == "owner":
            role = "owner"
            role_label = "Владелец"
        elif dept_member:
            role = dept_member.role.value
            role_labels = {
                "lead": "Админ (Лид)",
                "sub_admin": "Саб-Админ",
                "member": "Сотрудник"
            }
            role_label = role_labels.get(role, role)
        else:
            role = user.role.value
            role_label = role

        users_info.append({
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": role,
            "role_label": role_label,
            "is_active": user.is_active
        })

    # Count entities
    entities_result = await db.execute(
        select(Entity).where(Entity.department_id == sandbox_dept.id)
    )
    entity_count = len(entities_result.scalars().all())

    # Count chats
    chat_count = 0
    for user in sandbox_users:
        chats_result = await db.execute(
            select(Chat).where(Chat.owner_id == user.id)
        )
        chat_count += len(chats_result.scalars().all())

    # Count calls
    call_count = 0
    for user in sandbox_users:
        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.owner_id == user.id)
        )
        call_count += len(calls_result.scalars().all())

    return {
        "exists": True,
        "department_id": sandbox_dept.id,
        "department_name": sandbox_dept.name,
        "users": users_info,
        "stats": {
            "contacts": entity_count,
            "chats": chat_count,
            "calls": call_count
        }
    }


def is_secure_context(request: Request) -> bool:
    """Check if request is from a secure context (HTTPS)."""
    forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
    if forwarded_proto == "https":
        return True
    if forwarded_proto == "http":
        return False
    if request.url.scheme == "https":
        return True
    return settings.cookie_secure


@router.post("/sandbox/switch/{email:path}")
async def switch_to_sandbox_user_by_email(
    email: str,
    request: Request,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Quick switch to a sandbox user account by email.

    Creates an impersonation token and sets it as httpOnly cookie.
    Only works for sandbox_*@test.local users.

    This is a convenience endpoint for quickly testing different roles
    without manually logging in with credentials.

    **Only SUPERADMIN can access this endpoint.**
    """
    from fastapi.responses import JSONResponse

    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get target user by email
    result = await db.execute(select(User).where(User.email == email))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(
            status_code=404,
            detail=f"User with email {email} not found"
        )

    # Verify this is a sandbox user email
    if not target_user.email.endswith("@test.local"):
        raise HTTPException(
            status_code=400,
            detail="Only sandbox users (@test.local) can be switched to via this endpoint"
        )

    # Cannot impersonate inactive users
    if not target_user.is_active:
        raise HTTPException(status_code=400, detail="Cannot impersonate inactive user")

    # Create impersonation token (expires in 1 hour)
    token = create_impersonation_token(
        impersonated_user_id=target_user.id,
        original_user_id=superadmin.id,
        token_version=target_user.token_version
    )

    # Log impersonation session for audit
    impersonation_log = ImpersonationLog(
        superadmin_id=superadmin.id,
        impersonated_user_id=target_user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent")
    )
    db.add(impersonation_log)
    await db.commit()

    # Create response with user data
    response = JSONResponse(content={
        "user": {
            "id": target_user.id,
            "email": target_user.email,
            "name": target_user.name,
            "role": target_user.role.value,
            "telegram_id": target_user.telegram_id,
            "telegram_username": target_user.telegram_username,
            "is_active": target_user.is_active,
            "created_at": target_user.created_at.isoformat(),
        },
        "message": f"Switched to {target_user.email}"
    })

    # Set httpOnly cookie (like login does)
    use_secure = is_secure_context(request)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=use_secure,
        samesite="lax",
        max_age=3600,  # 1 hour for impersonation
        path="/"  # Must match login cookie path for cookie to work site-wide
    )

    return response
# ==================== Custom Roles Management Endpoints ====================


@router.post("/custom-roles", response_model=CustomRoleResponse)
async def create_custom_role(
    request_body: CustomRoleCreate,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new custom role.

    Custom roles inherit permissions from a base role (owner, admin, sub_admin, member)
    and can have specific permission overrides.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Validate base_role
    valid_base_roles = ["owner", "admin", "sub_admin", "member"]
    if request_body.base_role not in valid_base_roles:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base_role. Must be one of: {', '.join(valid_base_roles)}"
        )

    # If org_id provided, validate it exists
    if request_body.org_id:
        org_result = await db.execute(
            select(Organization).where(Organization.id == request_body.org_id)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise HTTPException(
                status_code=404,
                detail=f"Organization with id {request_body.org_id} not found"
            )

    # Create custom role
    custom_role = CustomRole(
        name=request_body.name,
        description=request_body.description,
        base_role=request_body.base_role,
        org_id=request_body.org_id,
        is_active=True
    )
    db.add(custom_role)
    await db.flush()

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=custom_role.id,
        action="create_custom_role",
        changed_by_id=superadmin.id,
        details={
            "name": request_body.name,
            "base_role": request_body.base_role,
            "org_id": request_body.org_id
        }
    )
    db.add(audit_log)

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Custom role with name '{request_body.name}' already exists"
        )

    # Get base role permissions
    base_permissions = get_role_permissions(request_body.base_role)

    return CustomRoleResponse(
        id=custom_role.id,
        name=custom_role.name,
        description=custom_role.description,
        base_role=custom_role.base_role,
        org_id=custom_role.org_id,
        is_active=custom_role.is_active,
        created_at=custom_role.created_at,
        permissions=base_permissions
    )


@router.get("/custom-roles", response_model=List[CustomRoleResponse])
async def list_custom_roles(
    org_id: Optional[int] = Query(None, description="Filter by organization ID"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    List all custom roles with optional filters.

    **Query Parameters:**
    - `org_id` (optional): Filter by organization ID
    - `is_active` (optional): Filter by active status

    **Only SUPERADMIN can access this endpoint.**
    """
    query = select(CustomRole)

    # Apply filters
    if org_id is not None:
        query = query.where(CustomRole.org_id == org_id)
    if is_active is not None:
        query = query.where(CustomRole.is_active == is_active)

    result = await db.execute(query.order_by(CustomRole.created_at.desc()))
    custom_roles = result.scalars().all()

    # Build response with merged permissions
    response = []
    for role in custom_roles:
        # Get base permissions
        base_permissions = get_role_permissions(role.base_role)

        # Get permission overrides
        overrides_result = await db.execute(
            select(RolePermissionOverride)
            .where(RolePermissionOverride.custom_role_id == role.id)
        )
        overrides = overrides_result.scalars().all()

        # Merge permissions
        merged_permissions = base_permissions.copy()
        for override in overrides:
            merged_permissions[override.permission] = override.allowed

        response.append(CustomRoleResponse(
            id=role.id,
            name=role.name,
            description=role.description,
            base_role=role.base_role,
            org_id=role.org_id,
            is_active=role.is_active,
            created_at=role.created_at,
            permissions=merged_permissions
        ))

    return response


@router.get("/custom-roles/{role_id}", response_model=CustomRoleResponse)
async def get_custom_role(
    role_id: int,
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific custom role with all merged permissions.

    Returns the custom role with permissions merged from:
    - Base role default permissions
    - Custom permission overrides

    **Only SUPERADMIN can access this endpoint.**
    """
    # Get custom role
    result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    # Get base permissions
    base_permissions = get_role_permissions(custom_role.base_role)

    # Get permission overrides
    overrides_result = await db.execute(
        select(RolePermissionOverride)
        .where(RolePermissionOverride.custom_role_id == role_id)
    )
    overrides = overrides_result.scalars().all()

    # Merge permissions
    merged_permissions = base_permissions.copy()
    for override in overrides:
        merged_permissions[override.permission] = override.allowed

    return CustomRoleResponse(
        id=custom_role.id,
        name=custom_role.name,
        description=custom_role.description,
        base_role=custom_role.base_role,
        org_id=custom_role.org_id,
        is_active=custom_role.is_active,
        created_at=custom_role.created_at,
        permissions=merged_permissions
    )


@router.patch("/custom-roles/{role_id}", response_model=CustomRoleResponse)
async def update_custom_role(
    role_id: int,
    request_body: CustomRoleUpdate,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a custom role's basic information.

    Can update:
    - Name
    - Description
    - Active status

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get custom role
    result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    # Track changes for audit log
    changes = {}

    # Update fields
    if request_body.name is not None:
        changes["name"] = {"old": custom_role.name, "new": request_body.name}
        custom_role.name = request_body.name

    if request_body.description is not None:
        changes["description"] = {"old": custom_role.description, "new": request_body.description}
        custom_role.description = request_body.description

    if request_body.is_active is not None:
        changes["is_active"] = {"old": custom_role.is_active, "new": request_body.is_active}
        custom_role.is_active = request_body.is_active

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=role_id,
        action="update_custom_role",
        changed_by_id=superadmin.id,
        details={"changes": changes}
    )
    db.add(audit_log)
    await db.commit()

    # Get merged permissions for response
    base_permissions = get_role_permissions(custom_role.base_role)
    overrides_result = await db.execute(
        select(RolePermissionOverride)
        .where(RolePermissionOverride.custom_role_id == role_id)
    )
    overrides = overrides_result.scalars().all()
    merged_permissions = base_permissions.copy()
    for override in overrides:
        merged_permissions[override.permission] = override.allowed

    return CustomRoleResponse(
        id=custom_role.id,
        name=custom_role.name,
        description=custom_role.description,
        base_role=custom_role.base_role,
        org_id=custom_role.org_id,
        is_active=custom_role.is_active,
        created_at=custom_role.created_at,
        permissions=merged_permissions
    )


@router.delete("/custom-roles/{role_id}")
async def delete_custom_role(
    role_id: int,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Soft delete a custom role (set is_active=False).

    This will not delete the role from the database, but will make it
    inactive and prevent it from being assigned to new users.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get custom role
    result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    # Soft delete
    custom_role.is_active = False

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=role_id,
        action="delete_custom_role",
        changed_by_id=superadmin.id,
        details={"role_name": custom_role.name}
    )
    db.add(audit_log)
    await db.commit()

    return {
        "message": f"Custom role '{custom_role.name}' has been deactivated",
        "role_id": role_id,
        "is_active": False
    }


@router.post("/custom-roles/{role_id}/permissions")
async def add_permission_override(
    role_id: int,
    request_body: PermissionOverride,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Add or update a permission override for a custom role.

    This allows you to grant or deny specific permissions that differ
    from the base role's default permissions.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get custom role
    result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    # Validate permission key exists in base permissions
    base_permissions = get_role_permissions(custom_role.base_role)
    if request_body.permission not in base_permissions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid permission key: {request_body.permission}. "
                   f"Valid permissions: {', '.join(base_permissions.keys())}"
        )

    # Check if override already exists
    override_result = await db.execute(
        select(RolePermissionOverride)
        .where(RolePermissionOverride.custom_role_id == role_id)
        .where(RolePermissionOverride.permission == request_body.permission)
    )
    existing_override = override_result.scalar_one_or_none()

    if existing_override:
        # Update existing override
        old_value = existing_override.allowed
        existing_override.allowed = request_body.allowed
        action = "update_permission_override"
    else:
        # Create new override
        new_override = RolePermissionOverride(
            custom_role_id=role_id,
            permission=request_body.permission,
            allowed=request_body.allowed
        )
        db.add(new_override)
        old_value = base_permissions.get(request_body.permission)
        action = "add_permission_override"

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=role_id,
        action=action,
        changed_by_id=superadmin.id,
        details={
            "permission": request_body.permission,
            "old_value": old_value,
            "new_value": request_body.allowed
        }
    )
    db.add(audit_log)
    await db.commit()

    return {
        "message": f"Permission '{request_body.permission}' override {'updated' if existing_override else 'added'}",
        "role_id": role_id,
        "permission": request_body.permission,
        "allowed": request_body.allowed
    }


@router.delete("/custom-roles/{role_id}/permissions/{permission}")
async def remove_permission_override(
    role_id: int,
    permission: str,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a permission override from a custom role.

    This will revert the permission back to the base role's default value.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get custom role
    role_result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = role_result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    # Get permission override
    override_result = await db.execute(
        select(RolePermissionOverride)
        .where(RolePermissionOverride.custom_role_id == role_id)
        .where(RolePermissionOverride.permission == permission)
    )
    override = override_result.scalar_one_or_none()

    if not override:
        raise HTTPException(
            status_code=404,
            detail=f"Permission override '{permission}' not found for role {role_id}"
        )

    # Store old value for audit log
    old_value = override.allowed

    # Delete override
    await db.execute(
        delete(RolePermissionOverride)
        .where(RolePermissionOverride.id == override.id)
    )

    # Get base permission value
    base_permissions = get_role_permissions(custom_role.base_role)
    base_value = base_permissions.get(permission)

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=role_id,
        action="remove_permission_override",
        changed_by_id=superadmin.id,
        details={
            "permission": permission,
            "old_value": old_value,
            "reverted_to": base_value
        }
    )
    db.add(audit_log)
    await db.commit()

    return {
        "message": f"Permission override '{permission}' removed. Reverted to base role default.",
        "role_id": role_id,
        "permission": permission,
        "reverted_to": base_value
    }


@router.post("/custom-roles/{role_id}/assign/{user_id}")
async def assign_custom_role_to_user(
    role_id: int,
    user_id: int,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Assign a custom role to a user.

    This creates a UserCustomRole relationship between the user and the custom role.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get custom role
    role_result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = role_result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    if not custom_role.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot assign inactive custom role '{custom_role.name}'"
        )

    # Get user
    user_result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User with id {user_id} not found"
        )

    # Check if already assigned
    existing_result = await db.execute(
        select(UserCustomRole)
        .where(UserCustomRole.user_id == user_id)
        .where(UserCustomRole.role_id == role_id)
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"User {user.name} already has custom role '{custom_role.name}' assigned"
        )

    # Create assignment
    assignment = UserCustomRole(
        user_id=user_id,
        custom_role_id=role_id
    )
    db.add(assignment)

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=role_id,
        user_id=user_id,
        action="assign_custom_role",
        changed_by_id=superadmin.id,
        details={
            "user_name": user.name,
            "user_email": user.email,
            "role_name": custom_role.name
        }
    )
    db.add(audit_log)
    await db.commit()

    return {
        "message": f"Custom role '{custom_role.name}' assigned to user {user.name}",
        "role_id": role_id,
        "user_id": user_id,
        "user_name": user.name,
        "role_name": custom_role.name
    }


@router.delete("/custom-roles/{role_id}/assign/{user_id}")
async def remove_custom_role_from_user(
    role_id: int,
    user_id: int,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a custom role from a user.

    This deletes the UserCustomRole relationship between the user and the custom role.

    **Only SUPERADMIN can access this endpoint.**
    """
    # Re-fetch superadmin to avoid detached instance issues
    superadmin_result = await db.execute(
        select(User).where(User.id == superadmin.id)
    )
    superadmin = superadmin_result.scalar_one_or_none()
    if not superadmin:
        raise HTTPException(status_code=401, detail="Superadmin not found")

    # Get custom role
    role_result = await db.execute(
        select(CustomRole).where(CustomRole.id == role_id)
    )
    custom_role = role_result.scalar_one_or_none()

    if not custom_role:
        raise HTTPException(
            status_code=404,
            detail=f"Custom role with id {role_id} not found"
        )

    # Get user
    user_result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User with id {user_id} not found"
        )

    # Get assignment
    assignment_result = await db.execute(
        select(UserCustomRole)
        .where(UserCustomRole.user_id == user_id)
        .where(UserCustomRole.role_id == role_id)
    )
    assignment = assignment_result.scalar_one_or_none()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail=f"User {user.name} does not have custom role '{custom_role.name}' assigned"
        )

    # Delete assignment
    await db.execute(
        delete(UserCustomRole).where(UserCustomRole.id == assignment.id)
    )

    # Create audit log entry
    audit_log = PermissionAuditLog(
        custom_role_id=role_id,
        user_id=user_id,
        action="remove_custom_role",
        changed_by_id=superadmin.id,
        details={
            "user_name": user.name,
            "user_email": user.email,
            "role_name": custom_role.name
        }
    )
    db.add(audit_log)
    await db.commit()

    return {
        "message": f"Custom role '{custom_role.name}' removed from user {user.name}",
        "role_id": role_id,
        "user_id": user_id,
        "user_name": user.name,
        "role_name": custom_role.name
    }


@router.get("/permission-audit-logs", response_model=List[PermissionAuditLogResponse])
async def get_permission_audit_logs(
    role_id: Optional[int] = Query(None, description="Filter by custom role ID"),
    changed_by: Optional[int] = Query(None, description="Filter by user who made the change"),
    limit: int = Query(100, description="Maximum number of logs to return"),
    offset: int = Query(0, description="Number of logs to skip"),
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get audit trail for custom roles and permission changes.

    Returns a log of all changes made to custom roles, including:
    - Role creation/updates/deletions
    - Permission overrides added/removed
    - Role assignments to users

    **Query Parameters:**
    - `role_id` (optional): Filter by custom role ID
    - `changed_by` (optional): Filter by user ID who made the change
    - `limit`: Maximum number of logs to return (default: 100)
    - `offset`: Number of logs to skip (default: 0)

    **Only SUPERADMIN can access this endpoint.**
    """
    query = select(PermissionAuditLog)

    # Apply filters
    if role_id is not None:
        query = query.where(PermissionAuditLog.custom_role_id == role_id)
    if changed_by is not None:
        query = query.where(PermissionAuditLog.changed_by_id == changed_by)

    # Order by most recent first
    query = query.order_by(PermissionAuditLog.created_at.desc())

    # Apply pagination
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    logs = result.scalars().all()

    # Build response with user information
    response = []
    for log in logs:
        # Get user who made the change
        user_result = await db.execute(
            select(User).where(User.id == log.changed_by_id)
        )
        user = user_result.scalar_one_or_none()

        response.append(PermissionAuditLogResponse(
            id=log.id,
            custom_role_id=log.custom_role_id,
            user_id=log.user_id,
            action=log.action,
            changed_by_id=log.changed_by_id,
            changed_by_name=user.name if user else "Unknown",
            changed_by_email=user.email if user else "Unknown",
            details=log.details,
            created_at=log.created_at
        ))

    return response


# ============================================================================
# USER EFFECTIVE PERMISSIONS
# ============================================================================

class EffectivePermissionsResponse(BaseModel):
    """Response schema for effective permissions."""
    permissions: Dict[str, bool]
    source: str  # 'custom_role', 'org_role', 'default'
    custom_role_id: Optional[int] = None
    custom_role_name: Optional[str] = None
    base_role: str


@router.get("/me/permissions", response_model=EffectivePermissionsResponse)
async def get_my_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get the current user's effective permissions.

    Returns the merged permissions from custom role (if assigned) or default role permissions.
    This endpoint is used by the frontend to dynamically show/hide UI elements.
    """
    # Check if user has custom role
    custom_role_query = await db.execute(
        select(UserCustomRole, CustomRole)
        .join(CustomRole, CustomRole.id == UserCustomRole.role_id)
        .where(
            UserCustomRole.user_id == current_user.id,
            CustomRole.is_active == True
        )
        .order_by(UserCustomRole.assigned_at.desc())
        .limit(1)
    )
    custom_role_result = custom_role_query.first()

    if custom_role_result:
        user_custom_role, custom_role = custom_role_result

        # Get base permissions from the custom role's base_role
        base_permissions = get_role_permissions(custom_role.base_role)

        # Get permission overrides
        overrides_query = await db.execute(
            select(RolePermissionOverride)
            .where(RolePermissionOverride.role_id == custom_role.id)
        )
        overrides = overrides_query.scalars().all()

        # Merge overrides into base permissions
        permissions = base_permissions.copy()
        for override in overrides:
            permissions[override.permission] = override.allowed

        return EffectivePermissionsResponse(
            permissions=permissions,
            source="custom_role",
            custom_role_id=custom_role.id,
            custom_role_name=custom_role.name,
            base_role=custom_role.base_role
        )

    # No custom role - check department role first, then fall back to user role
    user_role = current_user.role.value if current_user.role else "member"
    effective_role = user_role
    source = "user_role"

    # Check if user is a department lead/sub_admin - this takes priority over user role
    dept_member_query = await db.execute(
        select(DepartmentMember)
        .where(DepartmentMember.user_id == current_user.id)
        .order_by(
            # Prioritize lead > sub_admin > member
            DepartmentMember.role.desc()
        )
        .limit(1)
    )
    dept_member = dept_member_query.scalar_one_or_none()

    if dept_member and dept_member.role:
        dept_role = dept_member.role.value if hasattr(dept_member.role, 'value') else dept_member.role
        # Department roles (lead, sub_admin) can override user role if they grant more permissions
        if dept_role in ["lead", "sub_admin"]:
            effective_role = dept_role
            source = "dept_role"

    permissions = get_role_permissions(effective_role)

    return EffectivePermissionsResponse(
        permissions=permissions,
        source=source,
        custom_role_id=None,
        custom_role_name=None,
        base_role=effective_role
    )


# ============================================================================
# MENU CONFIGURATION
# ============================================================================

class MenuItemConfig(BaseModel):
    """Configuration for a menu item."""
    id: str
    label: str
    path: str
    icon: str
    required_permission: Optional[str] = None
    superadmin_only: bool = False


class MenuConfigResponse(BaseModel):
    """Response schema for menu configuration."""
    items: List[MenuItemConfig]


# Default menu configuration
DEFAULT_MENU_ITEMS = [
    MenuItemConfig(id="dashboard", label="Dashboard", path="/", icon="LayoutDashboard"),
    MenuItemConfig(id="chats", label="Chats", path="/chats", icon="MessageSquare", required_permission="can_view_chats"),
    MenuItemConfig(id="contacts", label="Contacts", path="/contacts", icon="Users", required_permission="can_view_contacts"),
    MenuItemConfig(id="calls", label="Calls", path="/calls", icon="Phone", required_permission="can_view_calls"),
    MenuItemConfig(id="departments", label="Departments", path="/departments", required_permission="can_view_departments", icon="Building2"),
    MenuItemConfig(id="users", label="Users", path="/users", icon="UserCog", required_permission="can_view_all_users"),
    MenuItemConfig(id="invite", label="Invite", path="/invite", icon="UserPlus", required_permission="can_invite_users"),
    MenuItemConfig(id="settings", label="Settings", path="/settings", icon="Settings"),
    MenuItemConfig(id="admin", label="Admin Panel", path="/admin", icon="Shield", superadmin_only=True),
    MenuItemConfig(id="trash", label="Trash", path="/trash", icon="Trash2", required_permission="can_delete_resources"),
]


@router.get("/me/menu", response_model=MenuConfigResponse)
async def get_my_menu(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get the menu configuration for the current user.

    Returns only menu items that the user has permission to see.
    This endpoint filters menu items based on user's effective permissions.
    """
    # Get user's effective permissions
    permissions_response = await get_my_permissions(current_user, db)
    permissions = permissions_response.permissions
    is_superadmin = current_user.role and current_user.role.value == "superadmin"

    visible_items = []
    for item in DEFAULT_MENU_ITEMS:
        # Check superadmin-only items
        if item.superadmin_only and not is_superadmin:
            continue

        # Check required permission
        if item.required_permission:
            has_permission = permissions.get(item.required_permission, False)
            # For basic "can_view_*" permissions, default to True for non-members
            if not has_permission:
                if item.required_permission.startswith("can_view_"):
                    # Allow if user is admin or higher (including department lead)
                    if permissions_response.base_role in ["superadmin", "owner", "admin", "sub_admin", "lead"]:
                        has_permission = True
                if not has_permission:
                    continue

        visible_items.append(item)

    return MenuConfigResponse(items=visible_items)
