from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from ..database import get_db
from ..models.database import User, UserRole, OrgRole, DeptRole, Organization, OrgMember, Department, DepartmentMember, ImpersonationLog
from ..services.auth import get_superadmin, get_current_user, create_access_token, create_impersonation_token
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
