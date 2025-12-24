from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from ..database import get_db
from ..models.database import (
    User, UserRole, OrgRole, DeptRole, Organization, OrgMember, Department,
    DepartmentMember, ImpersonationLog, Entity, EntityType, EntityStatus,
    Chat, ChatType, Message, CallRecording, CallSource, CallStatus,
    SharedAccess, ResourceType, AccessLevel
)
from ..services.auth import get_superadmin, get_current_user, create_access_token, create_impersonation_token, hash_password
from ..models.schemas import TokenResponse, UserResponse

router = APIRouter()


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
    roles: List[RolePermission]
    generated_at: datetime


class SimulateAccessRequest(BaseModel):
    """Request to simulate access for a role"""
    role: str
    action: str
    resource_type: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class SimulateAccessResponse(BaseModel):
    """Response for access simulation"""
    role: str
    action: str
    resource_type: Optional[str]
    allowed: bool
    reason: str
    context: Optional[Dict[str, Any]] = None


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


class SandboxUserInfo(BaseModel):
    """Information about a sandbox user"""
    id: int
    email: str
    name: str
    password: str
    role: str
    org_role: str
    dept_role: str


class SandboxCreateResponse(BaseModel):
    """Response for sandbox creation"""
    message: str
    department_id: int
    department_name: str
    users: List[SandboxUserInfo]
    entity_ids: List[int]
    chat_ids: List[int]
    call_ids: List[int]
    created_at: datetime


class SandboxStatusResponse(BaseModel):
    """Response for sandbox status check"""
    exists: bool
    department_id: Optional[int] = None
    users: List[Dict[str, Any]] = []
    entity_count: int = 0
    chat_count: int = 0
    call_count: int = 0


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

    if role == "superadmin" or role == UserRole.SUPERADMIN.value:
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

    elif role == "admin" or role == UserRole.ADMIN.value or role == OrgRole.admin.value:
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

    elif role == "sub_admin" or role == UserRole.SUB_ADMIN.value or role == DeptRole.sub_admin.value:
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

@router.get("/access-matrix", response_model=AccessMatrixResponse)
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
    roles_data = [
        {
            "role": "superadmin",
            "description": "System superadmin with full access to everything across all organizations"
        },
        {
            "role": "owner",
            "description": "Organization owner with full access within their organization"
        },
        {
            "role": "admin",
            "description": "Department admin with full access within their department"
        },
        {
            "role": "sub_admin",
            "description": "Department sub-admin with view access to department data and limited management"
        },
        {
            "role": "member",
            "description": "Regular member with access to their own data and shared resources"
        },
    ]

    role_permissions = []

    for role_info in roles_data:
        role = role_info["role"]
        permissions = get_role_permissions(role)

        role_permissions.append(RolePermission(
            role=role,
            can_view_all_orgs=permissions["can_view_all_orgs"],
            can_delete_users=permissions["can_delete_users"],
            can_share_resources=permissions["can_share_resources"],
            can_transfer_resources=permissions["can_transfer_resources"],
            can_manage_departments=permissions["can_manage_departments"],
            can_create_users=permissions["can_create_users"],
            can_edit_org_settings=permissions["can_edit_org_settings"],
            can_view_all_dept_data=permissions["can_view_all_dept_data"],
            can_manage_dept_members=permissions["can_manage_dept_members"],
            can_impersonate_users=permissions["can_impersonate_users"],
            can_access_admin_panel=permissions["can_access_admin_panel"],
            description=role_info["description"]
        ))

    return AccessMatrixResponse(
        roles=role_permissions,
        generated_at=datetime.utcnow()
    )


@router.get("/simulate-access", response_model=SimulateAccessResponse)
async def simulate_access(
    role: str = Query(..., description="Role to simulate (superadmin, owner, admin, sub_admin, member)"),
    action: str = Query(..., description="Action to check (e.g., view_all_orgs, delete_users, share_resources)"),
    resource_type: Optional[str] = Query(None, description="Type of resource (chat, entity, call, user, department)"),
    same_department: bool = Query(False, description="Whether the action is within the same department"),
    is_dept_admin: bool = Query(False, description="Whether the user is a department admin"),
    is_owner: bool = Query(False, description="Whether the user is the resource owner"),
    _: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Simulate access control for a specific role and action.

    This endpoint allows you to test if a role can perform an action
    on a resource with specific context.

    **Examples:**
    - Can ADMIN delete users? `role=admin&action=delete_users`
    - Can SUB_ADMIN share resources in same dept? `role=sub_admin&action=share_resources&same_department=true`
    - Can MEMBER transfer resources? `role=member&action=transfer_resources`

    **Only SUPERADMIN can access this endpoint.**
    """
    # Build context from query parameters
    context = {
        "same_department": same_department,
        "is_dept_admin": is_dept_admin,
        "is_owner": is_owner,
    }

    # Check permission
    allowed, reason = check_action_permission(role, action, context)

    return SimulateAccessResponse(
        role=role,
        action=action,
        resource_type=resource_type,
        allowed=allowed,
        reason=reason,
        context=context
    )


@router.post("/impersonate/{user_id}", response_model=TokenResponse)
async def impersonate_user(
    user_id: int,
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
    superadmin = await db.merge(superadmin)

    # Get target user
    result = await db.execute(select(User).where(User.id == user_id))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot impersonate yourself
    if target_user.id == superadmin.id:
        raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

    # Cannot impersonate another superadmin
    if target_user.role == UserRole.SUPERADMIN:
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

    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=target_user.id,
            email=target_user.email,
            name=target_user.name,
            role=target_user.role.value,
            telegram_id=target_user.telegram_id,
            telegram_username=target_user.telegram_username,
            is_active=target_user.is_active,
            created_at=target_user.created_at,
            chats_count=0
        )
    )


@router.post("/exit-impersonation", response_model=TokenResponse)
async def exit_impersonation(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Exit impersonation and return to original SUPERADMIN account.

    This endpoint should be called when a SUPERADMIN wants to stop
    impersonating and return to their own account. The frontend should
    track the original superadmin ID from the impersonation token.

    **Returns a regular token for the SUPERADMIN.**
    """
    current_user = await db.merge(current_user)

    # Verify this is a SUPERADMIN
    if current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only superadmin can exit impersonation"
        )

    # Create regular token for superadmin
    token = create_access_token({
        "sub": str(current_user.id),
        "token_version": current_user.token_version
    })

    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=current_user.id,
            email=current_user.email,
            name=current_user.name,
            role=current_user.role.value,
            telegram_id=current_user.telegram_id,
            telegram_username=current_user.telegram_username,
            is_active=current_user.is_active,
            created_at=current_user.created_at,
            chats_count=0
        )
    )


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


@router.get("/role-permissions", response_model=List[RolePermission])
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
    roles_data = [
        {
            "role": "superadmin",
            "description": "System superadmin with full access to everything across all organizations. Can impersonate users, manage all orgs, and has no restrictions."
        },
        {
            "role": "owner",
            "description": "Organization owner with full access within their organization. Can manage all departments, users, and settings. Cannot impersonate or access other orgs."
        },
        {
            "role": "admin",
            "description": "Department admin (LEAD role in department). Can view all data in their department, manage department members, create users, and share/transfer resources within department. Can share with other admins across departments."
        },
        {
            "role": "sub_admin",
            "description": "Department sub-admin with view-only access to all department data. Can share resources within department but cannot manage members or transfer resources. Limited management capabilities."
        },
        {
            "role": "member",
            "description": "Regular member with access to their own data and shared resources only. Can share their own resources within their department. No management capabilities."
        },
    ]

    # Filter by role if specified
    if role:
        roles_data = [r for r in roles_data if r["role"] == role.lower()]
        if not roles_data:
            raise HTTPException(status_code=404, detail=f"Role '{role}' not found")

    role_permissions = []

    for role_info in roles_data:
        role_name = role_info["role"]

        # Get permissions with different contexts to show the full picture
        # For admin/sub_admin, show permissions when they ARE dept admin
        context = {}
        if role_name in ["admin", "sub_admin"]:
            context = {"is_dept_admin": True, "same_department": True}
        elif role_name == "member":
            context = {"is_owner": True}

        permissions = get_role_permissions(role_name, context)

        role_permissions.append(RolePermission(
            role=role_name,
            can_view_all_orgs=permissions["can_view_all_orgs"],
            can_delete_users=permissions["can_delete_users"],
            can_share_resources=permissions["can_share_resources"],
            can_transfer_resources=permissions["can_transfer_resources"],
            can_manage_departments=permissions["can_manage_departments"],
            can_create_users=permissions["can_create_users"],
            can_edit_org_settings=permissions["can_edit_org_settings"],
            can_view_all_dept_data=permissions["can_view_all_dept_data"],
            can_manage_dept_members=permissions["can_manage_dept_members"],
            can_impersonate_users=permissions["can_impersonate_users"],
            can_access_admin_panel=permissions["can_access_admin_panel"],
            description=role_info["description"]
        ))

    return role_permissions


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
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Create an isolated test environment for testing and development.

    Creates:
    - "QA Sandbox" department in superadmin's organization
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
    superadmin = await db.merge(superadmin)

    # Check if sandbox already exists
    result = await db.execute(
        select(Department)
        .join(Organization)
        .join(OrgMember)
        .where(OrgMember.user_id == superadmin.id)
        .where(Department.name == "QA Sandbox")
    )
    existing_dept = result.scalar_one_or_none()

    if existing_dept:
        raise HTTPException(
            status_code=400,
            detail="Sandbox already exists. Delete it first using DELETE /api/admin/sandbox/delete"
        )

    # Get superadmin's organization
    org_result = await db.execute(
        select(Organization)
        .join(OrgMember)
        .where(OrgMember.user_id == superadmin.id)
    )
    org = org_result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Superadmin must be part of an organization"
        )

    # 1. Create QA Sandbox department
    sandbox_dept = Department(
        org_id=org.id,
        name="QA Sandbox",
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
            "role": UserRole.ADMIN,
            "org_role": OrgRole.owner,
            "dept_role": DeptRole.lead
        },
        {
            "email": "sandbox_admin@test.local",
            "name": "Sandbox Admin",
            "role": UserRole.ADMIN,
            "org_role": OrgRole.admin,
            "dept_role": DeptRole.lead
        },
        {
            "email": "sandbox_subadmin@test.local",
            "name": "Sandbox SubAdmin",
            "role": UserRole.SUB_ADMIN,
            "org_role": OrgRole.member,
            "dept_role": DeptRole.sub_admin
        },
        {
            "email": "sandbox_member@test.local",
            "name": "Sandbox Member",
            "role": UserRole.ADMIN,
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

    # 4. Create 3 test chats linked to entities
    chat_data = [
        {
            "title": "Interview with John Candidate",
            "chat_type": ChatType.hr,
            "entity_idx": 0,
            "owner_idx": 0
        },
        {
            "title": "Client Meeting - Sarah",
            "chat_type": ChatType.client,
            "entity_idx": 1,
            "owner_idx": 1
        },
        {
            "title": "Contractor Negotiation - Mike",
            "chat_type": ChatType.contractor,
            "entity_idx": 2,
            "owner_idx": 1
        }
    ]

    chat_ids = []
    chat_objects = []

    for idx, chat_info in enumerate(chat_data):
        chat = Chat(
            org_id=org.id,
            telegram_chat_id=1000000 + idx,  # Fake telegram chat IDs
            title=chat_info["title"],
            custom_name=chat_info["title"],
            chat_type=chat_info["chat_type"],
            owner_id=user_objects[chat_info["owner_idx"]].id,
            entity_id=entity_objects[chat_info["entity_idx"]].id,
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

    # 5. Create 2 test call recordings
    call_data = [
        {
            "title": "Technical Interview Call",
            "entity_idx": 0,
            "owner_idx": 0,
            "source_type": CallSource.meet,
            "status": CallStatus.done,
            "duration_seconds": 3600
        },
        {
            "title": "Client Discovery Call",
            "entity_idx": 1,
            "owner_idx": 1,
            "source_type": CallSource.zoom,
            "status": CallStatus.done,
            "duration_seconds": 2400
        }
    ]

    call_ids = []
    call_objects = []

    for call_info in call_data:
        call = CallRecording(
            org_id=org.id,
            title=call_info["title"],
            entity_id=entity_objects[call_info["entity_idx"]].id,
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

    # 6. Create sharing relationships
    # Share entity 0 from owner to admin
    share1 = SharedAccess(
        resource_type=ResourceType.entity,
        resource_id=entity_objects[0].id,
        entity_id=entity_objects[0].id,
        shared_by_id=user_objects[0].id,
        shared_with_id=user_objects[1].id,
        access_level=AccessLevel.edit,
        note="Shared for collaboration"
    )
    db.add(share1)

    # Share chat 0 from owner to subadmin
    share2 = SharedAccess(
        resource_type=ResourceType.chat,
        resource_id=chat_objects[0].id,
        chat_id=chat_objects[0].id,
        shared_by_id=user_objects[0].id,
        shared_with_id=user_objects[2].id,
        access_level=AccessLevel.view,
        note="View-only access"
    )
    db.add(share2)

    # Share call 0 from owner to member
    share3 = SharedAccess(
        resource_type=ResourceType.call,
        resource_id=call_objects[0].id,
        call_id=call_objects[0].id,
        shared_by_id=user_objects[0].id,
        shared_with_id=user_objects[3].id,
        access_level=AccessLevel.view,
        note="Call recording access"
    )
    db.add(share3)

    await db.commit()

    return SandboxCreateResponse(
        message="Sandbox environment created successfully",
        department_id=sandbox_dept.id,
        department_name=sandbox_dept.name,
        users=created_users,
        entity_ids=entity_ids,
        chat_ids=chat_ids,
        call_ids=call_ids,
        created_at=datetime.utcnow()
    )


@router.delete("/sandbox/delete")
async def delete_sandbox(
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete all sandbox test data.

    Removes:
    - All sandbox users (sandbox_*@test.local)
    - QA Sandbox department
    - All associated entities, chats, calls
    - All shared access records
    - Cascade cleanup of all related data

    **Only SUPERADMIN can access this endpoint.**
    """
    superadmin = await db.merge(superadmin)

    # Get superadmin's organization
    org_result = await db.execute(
        select(Organization)
        .join(OrgMember)
        .where(OrgMember.user_id == superadmin.id)
    )
    org = org_result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Superadmin must be part of an organization"
        )

    # Find sandbox department
    result = await db.execute(
        select(Department)
        .where(Department.org_id == org.id)
        .where(Department.name == "QA Sandbox")
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

    deleted_count = {
        "users": 0,
        "entities": 0,
        "chats": 0,
        "calls": 0,
        "messages": 0,
        "shared_access": 0
    }

    # Delete entities in sandbox department (cascade will handle chats, calls, shared access)
    entities_result = await db.execute(
        select(Entity).where(Entity.department_id == sandbox_dept.id)
    )
    entities = entities_result.scalars().all()
    deleted_count["entities"] = len(entities)

    for entity in entities:
        await db.delete(entity)

    # Delete chats owned by sandbox users
    for user in sandbox_users:
        chats_result = await db.execute(
            select(Chat).where(Chat.owner_id == user.id)
        )
        chats = chats_result.scalars().all()
        deleted_count["chats"] += len(chats)

        for chat in chats:
            # Count messages
            messages_result = await db.execute(
                select(Message).where(Message.chat_id == chat.id)
            )
            messages = messages_result.scalars().all()
            deleted_count["messages"] += len(messages)

    # Delete calls owned by sandbox users
    for user in sandbox_users:
        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.owner_id == user.id)
        )
        calls = calls_result.scalars().all()
        deleted_count["calls"] += len(calls)

    # Delete shared access records
    for user in sandbox_users:
        shared_result = await db.execute(
            select(SharedAccess).where(
                (SharedAccess.shared_by_id == user.id) | (SharedAccess.shared_with_id == user.id)
            )
        )
        shared = shared_result.scalars().all()
        deleted_count["shared_access"] += len(shared)

    # Delete all sandbox users (cascade will handle org memberships, dept memberships)
    for user in sandbox_users:
        await db.delete(user)
        deleted_count["users"] += 1

    # Delete sandbox department (cascade will handle remaining references)
    await db.delete(sandbox_dept)

    await db.commit()

    return {
        "message": "Sandbox environment deleted successfully",
        "deleted": deleted_count
    }


@router.get("/sandbox/status", response_model=SandboxStatusResponse)
async def get_sandbox_status(
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Check if sandbox test environment exists.

    Returns:
    - Whether sandbox exists
    - Department ID if exists
    - List of sandbox users
    - Count of entities, chats, and calls

    **Only SUPERADMIN can access this endpoint.**
    """
    superadmin = await db.merge(superadmin)

    # Get superadmin's organization
    org_result = await db.execute(
        select(Organization)
        .join(OrgMember)
        .where(OrgMember.user_id == superadmin.id)
    )
    org = org_result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Superadmin must be part of an organization"
        )

    # Find sandbox department
    result = await db.execute(
        select(Department)
        .where(Department.org_id == org.id)
        .where(Department.name == "QA Sandbox")
    )
    sandbox_dept = result.scalar_one_or_none()

    if not sandbox_dept:
        return SandboxStatusResponse(
            exists=False,
            department_id=None,
            users=[],
            entity_count=0,
            chat_count=0,
            call_count=0
        )

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

        users_info.append({
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role.value,
            "org_role": org_member.role.value if org_member else None,
            "dept_role": dept_member.role.value if dept_member else None,
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

    return SandboxStatusResponse(
        exists=True,
        department_id=sandbox_dept.id,
        users=users_info,
        entity_count=entity_count,
        chat_count=chat_count,
        call_count=call_count
    )


@router.post("/sandbox/switch/{user_email}", response_model=TokenResponse)
async def switch_to_sandbox_user(
    user_email: str,
    request: Request,
    superadmin: User = Depends(get_superadmin),
    db: AsyncSession = Depends(get_db)
):
    """
    Quick switch to a sandbox user account.

    Creates an impersonation token for the specified sandbox user.
    Only works for sandbox_*@test.local users.

    This is a convenience endpoint for quickly testing different roles
    without manually logging in with credentials.

    **Only SUPERADMIN can access this endpoint.**
    """
    superadmin = await db.merge(superadmin)

    # Verify this is a sandbox user email
    if not user_email.endswith("@test.local") or not user_email.startswith("sandbox_"):
        raise HTTPException(
            status_code=400,
            detail="Only sandbox users (sandbox_*@test.local) can be switched to via this endpoint"
        )

    # Get target user
    result = await db.execute(select(User).where(User.email == user_email))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(
            status_code=404,
            detail=f"Sandbox user '{user_email}' not found. Create sandbox first."
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

    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=target_user.id,
            email=target_user.email,
            name=target_user.name,
            role=target_user.role.value,
            telegram_id=target_user.telegram_id,
            telegram_username=target_user.telegram_username,
            is_active=target_user.is_active,
            created_at=target_user.created_at,
            chats_count=0
        )
    )
