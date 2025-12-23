"""
Invitation Management Routes.

Provides:
- POST /invitations - Create invitation link (admin/owner only)
- GET /invitations - List organization invitations
- GET /invitations/validate/{token} - Validate invitation (public)
- POST /invitations/accept/{token} - Accept invitation and register (public)
- DELETE /invitations/{id} - Revoke invitation
"""
import secrets
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, EmailStr

from ..database import get_db
from ..models.database import (
    User, UserRole, Organization, OrgMember, OrgRole,
    Department, DepartmentMember, DeptRole, Invitation
)
from ..services.auth import get_current_user, hash_password, create_access_token
from .organizations import get_current_org, require_org_admin

router = APIRouter()


# Schemas
class InvitationCreate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    org_role: str = "member"  # owner, admin, member
    department_ids: Optional[List[dict]] = None  # [{"id": 1, "role": "member"}]
    expires_in_days: int = 7  # 0 = never expires


class InvitationResponse(BaseModel):
    id: int
    token: str
    email: Optional[str]
    name: Optional[str]
    org_role: str
    department_ids: List[dict]
    invited_by_name: Optional[str] = None
    expires_at: Optional[datetime]
    used_at: Optional[datetime]
    used_by_name: Optional[str] = None
    created_at: datetime
    invitation_url: str

    class Config:
        from_attributes = True


class InvitationValidateResponse(BaseModel):
    valid: bool
    expired: bool = False
    used: bool = False
    email: Optional[str] = None
    name: Optional[str] = None
    org_name: Optional[str] = None
    org_role: str = "member"


class AcceptInvitationRequest(BaseModel):
    email: EmailStr
    name: str
    password: str


class AcceptInvitationResponse(BaseModel):
    success: bool
    access_token: str
    user_id: int
    telegram_bind_url: Optional[str] = None


def generate_token() -> str:
    """Generate a secure random token."""
    return secrets.token_urlsafe(32)


@router.post("", response_model=InvitationResponse)
async def create_invitation(
    data: InvitationCreate,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(require_org_admin)
):
    """Create an invitation link for a new user."""
    user, org, role = auth

    # Validate role
    try:
        org_role = OrgRole(data.org_role)
    except ValueError:
        org_role = OrgRole.member

    # Only owner can create owner/admin invites
    if org_role in (OrgRole.owner, OrgRole.admin) and role != OrgRole.owner:
        raise HTTPException(status_code=403, detail="Only owner can create owner/admin invitations")

    # Check if email is already a member of the organization
    if data.email:
        result = await db.execute(select(User).where(User.email == data.email))
        existing_user = result.scalar_one_or_none()
        if existing_user:
            result = await db.execute(
                select(OrgMember).where(
                    OrgMember.org_id == org.id,
                    OrgMember.user_id == existing_user.id
                )
            )
            if result.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="User is already a member of this organization")

    # Get user's department IDs (for admin restriction)
    user_dept_result = await db.execute(
        select(DepartmentMember.department_id).where(
            DepartmentMember.user_id == user.id
        )
    )
    user_dept_ids = set(r for r in user_dept_result.scalars().all())

    # Admin can only invite to their own departments
    if role != OrgRole.owner and data.department_ids:
        for dept_info in data.department_ids:
            dept_id = dept_info.get("id")
            if dept_id and dept_id not in user_dept_ids:
                raise HTTPException(
                    status_code=403,
                    detail=f"You can only invite to departments you belong to"
                )

    # Generate token
    token = generate_token()

    # Calculate expiration
    expires_at = None
    if data.expires_in_days > 0:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_in_days)

    # Create invitation
    invitation = Invitation(
        token=token,
        org_id=org.id,
        email=data.email,
        name=data.name,
        org_role=org_role,
        department_ids=data.department_ids or [],
        invited_by_id=user.id,
        expires_at=expires_at
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    # Build invitation URL (frontend will handle this)
    invitation_url = f"/invite/{token}"

    return InvitationResponse(
        id=invitation.id,
        token=invitation.token,
        email=invitation.email,
        name=invitation.name,
        org_role=invitation.org_role.value,
        department_ids=invitation.department_ids or [],
        invited_by_name=user.name,
        expires_at=invitation.expires_at,
        used_at=invitation.used_at,
        created_at=invitation.created_at,
        invitation_url=invitation_url
    )


@router.get("", response_model=List[InvitationResponse])
async def list_invitations(
    include_used: bool = False,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(require_org_admin)
):
    """List invitations for current organization.

    Owner sees all, admin sees only their own invitations.
    """
    user, org, role = auth

    query = select(Invitation).where(Invitation.org_id == org.id)

    # Admin can only see invitations they created
    if role != OrgRole.owner:
        query = query.where(Invitation.invited_by_id == user.id)

    if not include_used:
        query = query.where(Invitation.used_at.is_(None))

    query = query.order_by(Invitation.created_at.desc())

    result = await db.execute(query)
    invitations = result.scalars().all()

    # Pre-fetch invited_by and used_by names
    user_ids = set()
    for inv in invitations:
        if inv.invited_by_id:
            user_ids.add(inv.invited_by_id)
        if inv.used_by_id:
            user_ids.add(inv.used_by_id)

    user_names = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in users_result.scalars().all():
            user_names[u.id] = u.name

    return [
        InvitationResponse(
            id=inv.id,
            token=inv.token,
            email=inv.email,
            name=inv.name,
            org_role=inv.org_role.value,
            department_ids=inv.department_ids or [],
            invited_by_name=user_names.get(inv.invited_by_id),
            expires_at=inv.expires_at,
            used_at=inv.used_at,
            used_by_name=user_names.get(inv.used_by_id),
            created_at=inv.created_at,
            invitation_url=f"/invite/{inv.token}"
        )
        for inv in invitations
    ]


@router.get("/validate/{token}", response_model=InvitationValidateResponse)
async def validate_invitation(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """Validate an invitation token (public endpoint)."""
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.organization))
        .where(Invitation.token == token)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        return InvitationValidateResponse(valid=False)

    # Check if already used
    if invitation.used_at:
        return InvitationValidateResponse(
            valid=False,
            used=True,
            org_name=invitation.organization.name if invitation.organization else None
        )

    # Check if expired
    if invitation.expires_at and datetime.utcnow() > invitation.expires_at:
        return InvitationValidateResponse(
            valid=False,
            expired=True,
            org_name=invitation.organization.name if invitation.organization else None
        )

    return InvitationValidateResponse(
        valid=True,
        email=invitation.email,
        name=invitation.name,
        org_name=invitation.organization.name if invitation.organization else None,
        org_role=invitation.org_role.value
    )


@router.post("/accept/{token}", response_model=AcceptInvitationResponse)
async def accept_invitation(
    token: str,
    data: AcceptInvitationRequest,
    db: AsyncSession = Depends(get_db)
):
    """Accept an invitation and create user account (public endpoint)."""
    # Get invitation
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.organization))
        .where(Invitation.token == token)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    # Check if already used
    if invitation.used_at:
        raise HTTPException(status_code=400, detail="Invitation already used")

    # Check if expired
    if invitation.expires_at and datetime.utcnow() > invitation.expires_at:
        raise HTTPException(status_code=400, detail="Invitation expired")

    # Check if email already exists
    result = await db.execute(select(User).where(User.email == data.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        # Check if already a member of this org
        result = await db.execute(
            select(OrgMember).where(
                OrgMember.org_id == invitation.org_id,
                OrgMember.user_id == existing_user.id
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="You are already a member of this organization")

        # Add existing user to org
        new_user = existing_user
    else:
        # Create new user
        new_user = User(
            email=data.email,
            password_hash=hash_password(data.password),
            name=data.name,
            role=UserRole.ADMIN
        )
        db.add(new_user)
        await db.flush()

    # Create organization membership
    membership = OrgMember(
        org_id=invitation.org_id,
        user_id=new_user.id,
        role=invitation.org_role,
        invited_by=invitation.invited_by_id
    )
    db.add(membership)

    # Add to departments if specified
    if invitation.department_ids:
        for dept_info in invitation.department_ids:
            dept_id = dept_info.get("id")
            dept_role_str = dept_info.get("role", "member")

            try:
                dept_role = DeptRole(dept_role_str)
            except ValueError:
                dept_role = DeptRole.member

            # Verify department belongs to org
            result = await db.execute(
                select(Department).where(
                    Department.id == dept_id,
                    Department.org_id == invitation.org_id
                )
            )
            dept = result.scalar_one_or_none()
            if dept:
                dept_membership = DepartmentMember(
                    department_id=dept_id,
                    user_id=new_user.id,
                    role=dept_role
                )
                db.add(dept_membership)

    # Mark invitation as used
    invitation.used_at = datetime.utcnow()
    invitation.used_by_id = new_user.id

    await db.commit()

    # Generate JWT token
    access_token = create_access_token({"sub": str(new_user.id)})

    # Generate Telegram bind URL (deep link)
    # Format: t.me/bot_username?start=bind_USERID
    telegram_bind_url = f"https://t.me/enceladus_mst_bot?start=bind_{new_user.id}"

    return AcceptInvitationResponse(
        success=True,
        access_token=access_token,
        user_id=new_user.id,
        telegram_bind_url=telegram_bind_url
    )


@router.delete("/{invitation_id}")
async def revoke_invitation(
    invitation_id: int,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(require_org_admin)
):
    """Revoke/delete an invitation.

    Owner can revoke any, admin can only revoke their own invitations.
    """
    user, org, role = auth

    result = await db.execute(
        select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.org_id == org.id
        )
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    # Admin can only revoke their own invitations
    if role != OrgRole.owner and invitation.invited_by_id != user.id:
        raise HTTPException(status_code=403, detail="You can only revoke your own invitations")

    await db.delete(invitation)
    await db.commit()

    return {"success": True}
