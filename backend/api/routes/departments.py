"""API routes for department management"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel

from ..database import get_db
from ..models.database import (
    User, UserRole, Organization, OrgMember, OrgRole,
    Department, DepartmentMember, DeptRole
)
from ..services.auth import get_current_user, get_user_org

router = APIRouter()


# === Pydantic Schemas ===

class DepartmentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None  # For sub-departments


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


class DepartmentMemberAdd(BaseModel):
    user_id: int
    role: DeptRole = DeptRole.member


class DepartmentMemberUpdate(BaseModel):
    role: DeptRole


class DepartmentResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    is_active: bool
    parent_id: Optional[int] = None
    parent_name: Optional[str] = None
    members_count: int = 0
    entities_count: int = 0
    children_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class DepartmentMemberResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    user_email: str
    role: DeptRole
    created_at: datetime

    class Config:
        from_attributes = True


# === Helper Functions ===

async def is_org_admin_or_owner(user: User, org: Organization, db: AsyncSession) -> bool:
    """Check if user is admin or owner of organization"""
    if user.role == UserRole.SUPERADMIN:
        return True

    result = await db.execute(
        select(OrgMember).where(
            OrgMember.org_id == org.id,
            OrgMember.user_id == user.id,
            OrgMember.role.in_([OrgRole.owner, OrgRole.admin])
        )
    )
    return result.scalar_one_or_none() is not None


async def is_dept_lead(user: User, department_id: int, db: AsyncSession) -> bool:
    """Check if user is lead of department"""
    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.department_id == department_id,
            DepartmentMember.user_id == user.id,
            DepartmentMember.role == DeptRole.lead
        )
    )
    return result.scalar_one_or_none() is not None


async def get_user_departments(user: User, org: Organization, db: AsyncSession) -> List[Department]:
    """Get all departments user belongs to"""
    result = await db.execute(
        select(Department)
        .join(DepartmentMember, DepartmentMember.department_id == Department.id)
        .where(
            Department.org_id == org.id,
            DepartmentMember.user_id == user.id,
            Department.is_active == True
        )
    )
    return list(result.scalars().all())


# === Routes ===

@router.get("", response_model=List[DepartmentResponse])
async def list_departments(
    parent_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all departments in organization.

    Args:
        parent_id: Filter by parent department. None = top-level departments only.
                   Use parent_id=-1 to get all departments.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return []

    # Build query
    query = select(Department).where(Department.org_id == org.id)

    # Filter by parent_id (-1 means all departments)
    if parent_id is None:
        query = query.where(Department.parent_id.is_(None))
    elif parent_id != -1:
        query = query.where(Department.parent_id == parent_id)

    query = query.order_by(Department.name)
    result = await db.execute(query)
    departments = result.scalars().all()

    # Pre-fetch all parent names
    parent_ids = [d.parent_id for d in departments if d.parent_id]
    parent_names = {}
    if parent_ids:
        parents_result = await db.execute(
            select(Department).where(Department.id.in_(parent_ids))
        )
        for p in parents_result.scalars().all():
            parent_names[p.id] = p.name

    response = []
    for dept in departments:
        # Count members
        members_result = await db.execute(
            select(DepartmentMember).where(DepartmentMember.department_id == dept.id)
        )
        members_count = len(list(members_result.scalars().all()))

        # Count entities
        from ..models.database import Entity
        entities_result = await db.execute(
            select(Entity).where(Entity.department_id == dept.id)
        )
        entities_count = len(list(entities_result.scalars().all()))

        # Count children
        children_result = await db.execute(
            select(Department).where(Department.parent_id == dept.id)
        )
        children_count = len(list(children_result.scalars().all()))

        response.append(DepartmentResponse(
            id=dept.id,
            name=dept.name,
            description=dept.description,
            color=dept.color,
            is_active=dept.is_active,
            parent_id=dept.parent_id,
            parent_name=parent_names.get(dept.parent_id) if dept.parent_id else None,
            members_count=members_count,
            entities_count=entities_count,
            children_count=children_count,
            created_at=dept.created_at
        ))

    return response


@router.post("", response_model=DepartmentResponse)
async def create_department(
    data: DepartmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new department.

    - Org admins/owners can create top-level departments
    - Department leads can create sub-departments under their department
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    is_admin = await is_org_admin_or_owner(current_user, org, db)

    # Check permissions based on whether it's a sub-department
    if data.parent_id:
        # Creating sub-department - verify parent exists and user is lead of parent
        result = await db.execute(
            select(Department).where(
                Department.id == data.parent_id,
                Department.org_id == org.id
            )
        )
        parent_dept = result.scalar_one_or_none()
        if not parent_dept:
            raise HTTPException(status_code=404, detail="Parent department not found")

        # Check if user is lead of parent department or org admin
        is_parent_lead = await is_dept_lead(current_user, data.parent_id, db)
        if not is_admin and not is_parent_lead:
            raise HTTPException(
                status_code=403,
                detail="Only org admins or department leads can create sub-departments"
            )
    else:
        # Creating top-level department - only org admins
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only admins can create top-level departments")

    department = Department(
        org_id=org.id,
        parent_id=data.parent_id,
        name=data.name,
        description=data.description,
        color=data.color
    )
    db.add(department)
    await db.commit()
    await db.refresh(department)

    # If a lead creates sub-department, automatically make them lead of the new department
    if data.parent_id and not is_admin:
        new_membership = DepartmentMember(
            department_id=department.id,
            user_id=current_user.id,
            role=DeptRole.lead
        )
        db.add(new_membership)
        await db.commit()

    # Get parent name if exists
    parent_name = None
    if data.parent_id:
        result = await db.execute(
            select(Department).where(Department.id == data.parent_id)
        )
        parent = result.scalar_one_or_none()
        if parent:
            parent_name = parent.name

    return DepartmentResponse(
        id=department.id,
        name=department.name,
        description=department.description,
        color=department.color,
        is_active=department.is_active,
        parent_id=department.parent_id,
        parent_name=parent_name,
        members_count=1 if data.parent_id and not is_admin else 0,
        entities_count=0,
        children_count=0,
        created_at=department.created_at
    )


@router.get("/{department_id}", response_model=DepartmentResponse)
async def get_department(
    department_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get department details"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    result = await db.execute(
        select(Department).where(Department.id == department_id, Department.org_id == org.id)
    )
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Count members
    members_result = await db.execute(
        select(DepartmentMember).where(DepartmentMember.department_id == dept.id)
    )
    members_count = len(list(members_result.scalars().all()))

    # Count entities
    from ..models.database import Entity
    entities_result = await db.execute(
        select(Entity).where(Entity.department_id == dept.id)
    )
    entities_count = len(list(entities_result.scalars().all()))

    # Count children
    children_result = await db.execute(
        select(Department).where(Department.parent_id == dept.id)
    )
    children_count = len(list(children_result.scalars().all()))

    # Get parent name
    parent_name = None
    if dept.parent_id:
        parent_result = await db.execute(
            select(Department).where(Department.id == dept.parent_id)
        )
        parent = parent_result.scalar_one_or_none()
        if parent:
            parent_name = parent.name

    return DepartmentResponse(
        id=dept.id,
        name=dept.name,
        description=dept.description,
        color=dept.color,
        is_active=dept.is_active,
        parent_id=dept.parent_id,
        parent_name=parent_name,
        members_count=members_count,
        entities_count=entities_count,
        children_count=children_count,
        created_at=dept.created_at
    )


@router.patch("/{department_id}", response_model=DepartmentResponse)
async def update_department(
    department_id: int,
    data: DepartmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update department (org admin or dept lead)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    result = await db.execute(
        select(Department).where(Department.id == department_id, Department.org_id == org.id)
    )
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check permissions (org admin or dept lead)
    is_admin = await is_org_admin_or_owner(current_user, org, db)
    is_lead = await is_dept_lead(current_user, department_id, db)
    if not is_admin and not is_lead:
        raise HTTPException(status_code=403, detail="Permission denied")

    if data.name is not None:
        dept.name = data.name
    if data.description is not None:
        dept.description = data.description
    if data.color is not None:
        dept.color = data.color
    if data.is_active is not None and is_admin:  # Only admin can deactivate
        dept.is_active = data.is_active

    await db.commit()
    await db.refresh(dept)

    return await get_department(department_id, db, current_user)


@router.delete("/{department_id}")
async def delete_department(
    department_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete department (org admin only)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    if not await is_org_admin_or_owner(current_user, org, db):
        raise HTTPException(status_code=403, detail="Only admins can delete departments")

    result = await db.execute(
        select(Department).where(Department.id == department_id, Department.org_id == org.id)
    )
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    await db.delete(dept)
    await db.commit()

    return {"success": True}


# === Department Members ===

@router.get("/{department_id}/members", response_model=List[DepartmentMemberResponse])
async def list_department_members(
    department_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all members of a department"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    # Verify department exists and belongs to org
    result = await db.execute(
        select(Department).where(Department.id == department_id, Department.org_id == org.id)
    )
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Get members
    result = await db.execute(
        select(DepartmentMember)
        .where(DepartmentMember.department_id == department_id)
        .order_by(DepartmentMember.role, DepartmentMember.created_at)
    )
    members = result.scalars().all()

    response = []
    for member in members:
        user_result = await db.execute(select(User).where(User.id == member.user_id))
        user = user_result.scalar_one_or_none()
        if user:
            response.append(DepartmentMemberResponse(
                id=member.id,
                user_id=user.id,
                user_name=user.name,
                user_email=user.email,
                role=member.role,
                created_at=member.created_at
            ))

    return response


@router.post("/{department_id}/members", response_model=DepartmentMemberResponse)
async def add_department_member(
    department_id: int,
    data: DepartmentMemberAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add member to department (org admin or dept lead)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    # Verify department
    result = await db.execute(
        select(Department).where(Department.id == department_id, Department.org_id == org.id)
    )
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check permissions
    is_admin = await is_org_admin_or_owner(current_user, org, db)
    is_lead = await is_dept_lead(current_user, department_id, db)
    if not is_admin and not is_lead:
        raise HTTPException(status_code=403, detail="Permission denied")

    # Only org admin can add leads
    if data.role == DeptRole.lead and not is_admin:
        raise HTTPException(status_code=403, detail="Only org admins can add department leads")

    # Verify user exists and is in org
    result = await db.execute(
        select(User).join(OrgMember, OrgMember.user_id == User.id)
        .where(User.id == data.user_id, OrgMember.org_id == org.id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in organization")

    # Check if already member
    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.department_id == department_id,
            DepartmentMember.user_id == data.user_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        # Update role
        existing.role = data.role
        await db.commit()
        await db.refresh(existing)
        member = existing
    else:
        # Create new
        member = DepartmentMember(
            department_id=department_id,
            user_id=data.user_id,
            role=data.role
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)

    return DepartmentMemberResponse(
        id=member.id,
        user_id=user.id,
        user_name=user.name,
        user_email=user.email,
        role=member.role,
        created_at=member.created_at
    )


@router.patch("/{department_id}/members/{user_id}", response_model=DepartmentMemberResponse)
async def update_department_member(
    department_id: int,
    user_id: int,
    data: DepartmentMemberUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update member role in department (org admin only for lead role)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    is_admin = await is_org_admin_or_owner(current_user, org, db)
    is_lead = await is_dept_lead(current_user, department_id, db)

    if not is_admin and not is_lead:
        raise HTTPException(status_code=403, detail="Permission denied")

    # Only org admin can set lead role
    if data.role == DeptRole.lead and not is_admin:
        raise HTTPException(status_code=403, detail="Only org admins can set lead role")

    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.department_id == department_id,
            DepartmentMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.role = data.role
    await db.commit()
    await db.refresh(member)

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one()

    return DepartmentMemberResponse(
        id=member.id,
        user_id=user.id,
        user_name=user.name,
        user_email=user.email,
        role=member.role,
        created_at=member.created_at
    )


@router.delete("/{department_id}/members/{user_id}")
async def remove_department_member(
    department_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Remove member from department"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    is_admin = await is_org_admin_or_owner(current_user, org, db)
    is_lead = await is_dept_lead(current_user, department_id, db)

    if not is_admin and not is_lead:
        raise HTTPException(status_code=403, detail="Permission denied")

    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.department_id == department_id,
            DepartmentMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Don't allow removing the last lead
    if member.role == DeptRole.lead:
        leads_result = await db.execute(
            select(DepartmentMember).where(
                DepartmentMember.department_id == department_id,
                DepartmentMember.role == DeptRole.lead
            )
        )
        leads_count = len(list(leads_result.scalars().all()))
        if leads_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last department lead")

    await db.delete(member)
    await db.commit()

    return {"success": True}


# === User's Departments ===

@router.get("/my/departments", response_model=List[DepartmentResponse])
async def get_my_departments(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get departments current user belongs to"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return []

    departments = await get_user_departments(current_user, org, db)

    # Pre-fetch parent names
    parent_ids = [d.parent_id for d in departments if d.parent_id]
    parent_names = {}
    if parent_ids:
        parents_result = await db.execute(
            select(Department).where(Department.id.in_(parent_ids))
        )
        for p in parents_result.scalars().all():
            parent_names[p.id] = p.name

    response = []
    for dept in departments:
        members_result = await db.execute(
            select(DepartmentMember).where(DepartmentMember.department_id == dept.id)
        )
        members_count = len(list(members_result.scalars().all()))

        from ..models.database import Entity
        entities_result = await db.execute(
            select(Entity).where(Entity.department_id == dept.id)
        )
        entities_count = len(list(entities_result.scalars().all()))

        # Count children
        children_result = await db.execute(
            select(Department).where(Department.parent_id == dept.id)
        )
        children_count = len(list(children_result.scalars().all()))

        response.append(DepartmentResponse(
            id=dept.id,
            name=dept.name,
            description=dept.description,
            color=dept.color,
            is_active=dept.is_active,
            parent_id=dept.parent_id,
            parent_name=parent_names.get(dept.parent_id) if dept.parent_id else None,
            members_count=members_count,
            entities_count=entities_count,
            children_count=children_count,
            created_at=dept.created_at
        ))

    return response
