"""API routes for sharing resources between users"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel

from ..database import get_db
from ..models.database import (
    User, UserRole, SharedAccess, ResourceType, AccessLevel,
    Chat, Entity, CallRecording, OrgMember
)
from ..services.auth import get_current_user, get_user_org
from .realtime import broadcast_share_created, broadcast_share_revoked

router = APIRouter()


# === Pydantic Schemas ===

class ShareRequest(BaseModel):
    resource_type: ResourceType
    resource_id: int
    shared_with_id: int
    access_level: AccessLevel = AccessLevel.view
    note: Optional[str] = None
    expires_at: Optional[datetime] = None


class ShareResponse(BaseModel):
    id: int
    resource_type: ResourceType
    resource_id: int
    resource_name: Optional[str] = None
    shared_by_id: int
    shared_by_name: str
    shared_with_id: int
    shared_with_name: str
    access_level: AccessLevel
    note: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UpdateShareRequest(BaseModel):
    access_level: AccessLevel
    note: Optional[str] = None
    expires_at: Optional[datetime] = None


class UserSimple(BaseModel):
    id: int
    name: str
    email: str
    org_role: Optional[str] = None
    department_name: Optional[str] = None
    department_role: Optional[str] = None

    class Config:
        from_attributes = True


# === Helper functions ===

async def resource_exists(resource_type: ResourceType, resource_id: int, db: AsyncSession) -> bool:
    """Check if a resource exists"""
    if resource_type == ResourceType.chat:
        result = await db.execute(select(Chat).where(Chat.id == resource_id))
        return result.scalar_one_or_none() is not None
    elif resource_type == ResourceType.entity:
        result = await db.execute(select(Entity).where(Entity.id == resource_id))
        return result.scalar_one_or_none() is not None
    elif resource_type == ResourceType.call:
        result = await db.execute(select(CallRecording).where(CallRecording.id == resource_id))
        return result.scalar_one_or_none() is not None
    return False


async def can_share_resource(user: User, resource_type: ResourceType, resource_id: int, db: AsyncSession) -> bool:
    """Check if user can share a resource (must own it or have full access)"""
    if user.role == UserRole.SUPERADMIN:
        return True

    # Check ownership
    if resource_type == ResourceType.chat:
        result = await db.execute(select(Chat).where(Chat.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource and resource.owner_id == user.id:
            return True
    elif resource_type == ResourceType.entity:
        result = await db.execute(select(Entity).where(Entity.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource and resource.created_by == user.id:
            return True
    elif resource_type == ResourceType.call:
        result = await db.execute(select(CallRecording).where(CallRecording.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource and resource.owner_id == user.id:
            return True

    # Check if user has full access via sharing
    result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == resource_type,
            SharedAccess.resource_id == resource_id,
            SharedAccess.shared_with_id == user.id,
            SharedAccess.access_level == AccessLevel.full,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )
    )
    return result.scalar_one_or_none() is not None


async def has_access_to_resource(user: User, resource_type: ResourceType, resource_id: int, db: AsyncSession) -> bool:
    """Check if user has any access to a resource"""
    if user.role == UserRole.SUPERADMIN:
        return True

    # Check ownership
    if resource_type == ResourceType.chat:
        result = await db.execute(select(Chat).where(Chat.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource and resource.owner_id == user.id:
            return True
    elif resource_type == ResourceType.entity:
        result = await db.execute(select(Entity).where(Entity.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource and resource.created_by == user.id:
            return True
    elif resource_type == ResourceType.call:
        result = await db.execute(select(CallRecording).where(CallRecording.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource and resource.owner_id == user.id:
            return True

    # Check shared access
    result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == resource_type,
            SharedAccess.resource_id == resource_id,
            SharedAccess.shared_with_id == user.id,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )
    )
    return result.scalar_one_or_none() is not None


async def get_resource_name(resource_type: ResourceType, resource_id: int, db: AsyncSession) -> Optional[str]:
    """Get human-readable name for a resource"""
    if resource_type == ResourceType.chat:
        result = await db.execute(select(Chat).where(Chat.id == resource_id))
        resource = result.scalar_one_or_none()
        return resource.custom_name or resource.title if resource else None
    elif resource_type == ResourceType.entity:
        result = await db.execute(select(Entity).where(Entity.id == resource_id))
        resource = result.scalar_one_or_none()
        return resource.name if resource else None
    elif resource_type == ResourceType.call:
        result = await db.execute(select(CallRecording).where(CallRecording.id == resource_id))
        resource = result.scalar_one_or_none()
        return resource.title or f"Звонок #{resource_id}" if resource else None
    return None


async def batch_get_resource_names(shares: List[SharedAccess], db: AsyncSession) -> dict:
    """Batch load resource names for multiple shares"""
    resource_names = {}

    # Group shares by resource type
    chat_ids = []
    entity_ids = []
    call_ids = []

    for share in shares:
        if share.resource_type == ResourceType.chat:
            chat_ids.append(share.resource_id)
        elif share.resource_type == ResourceType.entity:
            entity_ids.append(share.resource_id)
        elif share.resource_type == ResourceType.call:
            call_ids.append(share.resource_id)

    # Batch load chats
    if chat_ids:
        result = await db.execute(select(Chat).where(Chat.id.in_(chat_ids)))
        for chat in result.scalars().all():
            key = (ResourceType.chat, chat.id)
            resource_names[key] = chat.custom_name or chat.title

    # Batch load entities
    if entity_ids:
        result = await db.execute(select(Entity).where(Entity.id.in_(entity_ids)))
        for entity in result.scalars().all():
            key = (ResourceType.entity, entity.id)
            resource_names[key] = entity.name

    # Batch load calls
    if call_ids:
        result = await db.execute(select(CallRecording).where(CallRecording.id.in_(call_ids)))
        for call in result.scalars().all():
            key = (ResourceType.call, call.id)
            resource_names[key] = call.title or f"Звонок #{call.id}"

    return resource_names


# === Routes ===

@router.post("", response_model=ShareResponse)
async def share_resource(
    data: ShareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Share a resource with another user"""
    current_user = await db.merge(current_user)

    # Check if resource exists first (before permission check)
    if not await resource_exists(data.resource_type, data.resource_id, db):
        raise HTTPException(status_code=404, detail="Resource not found")

    # Check if user can share this resource
    if not await can_share_resource(current_user, data.resource_type, data.resource_id, db):
        raise HTTPException(status_code=403, detail="You don't have permission to share this resource")

    # Check if target user exists
    result = await db.execute(select(User).where(User.id == data.shared_with_id))
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if already shared (before org check to allow updates)
    result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == data.resource_type,
            SharedAccess.resource_id == data.resource_id,
            SharedAccess.shared_with_id == data.shared_with_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        # Update existing share
        existing.access_level = data.access_level
        existing.note = data.note
        existing.expires_at = data.expires_at
        await db.commit()
        await db.refresh(existing)
        share = existing
    else:
        # Verify both users are in the same organization (only for new shares)
        current_user_org = await get_user_org(current_user, db)
        if not current_user_org:
            raise HTTPException(status_code=403, detail="You don't belong to an organization")

        target_user_org_result = await db.execute(
            select(OrgMember).where(
                OrgMember.user_id == data.shared_with_id,
                OrgMember.org_id == current_user_org.id
            )
        )
        if not target_user_org_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Cannot share with users outside your organization")

        # Create new share
        share = SharedAccess(
            resource_type=data.resource_type,
            resource_id=data.resource_id,
            entity_id=data.resource_id if data.resource_type == ResourceType.entity else None,
            chat_id=data.resource_id if data.resource_type == ResourceType.chat else None,
            call_id=data.resource_id if data.resource_type == ResourceType.call else None,
            shared_by_id=current_user.id,
            shared_with_id=data.shared_with_id,
            access_level=data.access_level,
            note=data.note,
            expires_at=data.expires_at
        )
        db.add(share)
        await db.commit()
        await db.refresh(share)

    resource_name = await get_resource_name(data.resource_type, data.resource_id, db)

    response_data = ShareResponse(
        id=share.id,
        resource_type=share.resource_type,
        resource_id=share.resource_id,
        resource_name=resource_name,
        shared_by_id=current_user.id,
        shared_by_name=current_user.name,
        shared_with_id=target_user.id,
        shared_with_name=target_user.name,
        access_level=share.access_level,
        note=share.note,
        expires_at=share.expires_at,
        created_at=share.created_at
    )

    # Broadcast share.created event to the user who received the share
    await broadcast_share_created(
        target_user.id,
        {
            "share_id": share.id,
            "resource_type": share.resource_type.value,
            "resource_id": share.resource_id,
            "resource_name": resource_name,
            "access_level": share.access_level.value,
            "shared_by": current_user.name,
            "created_at": share.created_at.isoformat() if share.created_at else None
        }
    )

    return response_data


@router.patch("/{share_id}", response_model=ShareResponse)
async def update_share(
    share_id: int,
    data: UpdateShareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a share's access level and other properties"""
    current_user = await db.merge(current_user)

    result = await db.execute(select(SharedAccess).where(SharedAccess.id == share_id))
    share = result.scalar_one_or_none()

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Only the person who shared or superadmin can update
    if share.shared_by_id != current_user.id and current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="You can only update shares you created")

    # Update the share
    share.access_level = data.access_level
    if data.note is not None:
        share.note = data.note
    if data.expires_at is not None:
        share.expires_at = data.expires_at

    await db.commit()
    await db.refresh(share)

    # Get user details for response
    by_result = await db.execute(select(User).where(User.id == share.shared_by_id))
    by_user = by_result.scalar_one_or_none()
    with_result = await db.execute(select(User).where(User.id == share.shared_with_id))
    with_user = with_result.scalar_one_or_none()

    resource_name = await get_resource_name(share.resource_type, share.resource_id, db)

    return ShareResponse(
        id=share.id,
        resource_type=share.resource_type,
        resource_id=share.resource_id,
        resource_name=resource_name,
        shared_by_id=share.shared_by_id,
        shared_by_name=by_user.name if by_user else "Unknown",
        shared_with_id=share.shared_with_id,
        shared_with_name=with_user.name if with_user else "Unknown",
        access_level=share.access_level,
        note=share.note,
        expires_at=share.expires_at,
        created_at=share.created_at
    )


@router.delete("/{share_id}")
async def revoke_share(
    share_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Revoke a share"""
    current_user = await db.merge(current_user)

    result = await db.execute(select(SharedAccess).where(SharedAccess.id == share_id))
    share = result.scalar_one_or_none()

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Only the person who shared or superadmin can revoke
    if share.shared_by_id != current_user.id and current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="You can only revoke shares you created")

    # Store share info before deletion
    shared_with_id = share.shared_with_id
    revoke_data = {
        "share_id": share.id,
        "resource_type": share.resource_type.value,
        "resource_id": share.resource_id
    }

    await db.delete(share)
    await db.commit()

    # Broadcast share.revoked event to the user who had access
    await broadcast_share_revoked(shared_with_id, revoke_data)

    return {"success": True}


@router.get("/my-shares", response_model=List[ShareResponse])
async def get_my_shares(
    resource_type: Optional[ResourceType] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get resources I've shared with others"""
    current_user = await db.merge(current_user)

    query = select(SharedAccess).options(
        selectinload(SharedAccess.shared_by),
        selectinload(SharedAccess.shared_with)
    ).where(SharedAccess.shared_by_id == current_user.id)
    if resource_type:
        query = query.where(SharedAccess.resource_type == resource_type)
    query = query.order_by(SharedAccess.created_at.desc())

    result = await db.execute(query)
    shares = result.scalars().all()

    # Batch load resource names
    resource_names = await batch_get_resource_names(shares, db)

    # Build response using pre-fetched data
    response = []
    for share in shares:
        resource_name = resource_names.get((share.resource_type, share.resource_id))

        response.append(ShareResponse(
            id=share.id,
            resource_type=share.resource_type,
            resource_id=share.resource_id,
            resource_name=resource_name,
            shared_by_id=share.shared_by_id,
            shared_by_name=share.shared_by.name if share.shared_by else "Unknown",
            shared_with_id=share.shared_with_id,
            shared_with_name=share.shared_with.name if share.shared_with else "Unknown",
            access_level=share.access_level,
            note=share.note,
            expires_at=share.expires_at,
            created_at=share.created_at
        ))

    return response


@router.get("/shared-with-me", response_model=List[ShareResponse])
async def get_shared_with_me(
    resource_type: Optional[ResourceType] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get resources shared with me"""
    current_user = await db.merge(current_user)

    query = select(SharedAccess).options(
        selectinload(SharedAccess.shared_by),
        selectinload(SharedAccess.shared_with)
    ).where(
        SharedAccess.shared_with_id == current_user.id,
        or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
    )
    if resource_type:
        query = query.where(SharedAccess.resource_type == resource_type)
    query = query.order_by(SharedAccess.created_at.desc())

    result = await db.execute(query)
    shares = result.scalars().all()

    # Batch load resource names
    resource_names = await batch_get_resource_names(shares, db)

    # Build response using pre-fetched data
    response = []
    for share in shares:
        resource_name = resource_names.get((share.resource_type, share.resource_id))

        response.append(ShareResponse(
            id=share.id,
            resource_type=share.resource_type,
            resource_id=share.resource_id,
            resource_name=resource_name,
            shared_by_id=share.shared_by_id,
            shared_by_name=share.shared_by.name if share.shared_by else "Unknown",
            shared_with_id=share.shared_with_id,
            shared_with_name=share.shared_with.name if share.shared_with else "Unknown",
            access_level=share.access_level,
            note=share.note,
            expires_at=share.expires_at,
            created_at=share.created_at
        ))

    return response


@router.get("/resource/{resource_type}/{resource_id}", response_model=List[ShareResponse])
async def get_resource_shares(
    resource_type: ResourceType,
    resource_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all shares for a specific resource"""
    current_user = await db.merge(current_user)

    # Check if user has access to this resource
    if not await has_access_to_resource(current_user, resource_type, resource_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    query = select(SharedAccess).where(
        SharedAccess.resource_type == resource_type,
        SharedAccess.resource_id == resource_id
    ).order_by(SharedAccess.created_at.desc())

    result = await db.execute(query)
    shares = result.scalars().all()

    response = []
    for share in shares:
        by_result = await db.execute(select(User).where(User.id == share.shared_by_id))
        by_user = by_result.scalar_one_or_none()
        with_result = await db.execute(select(User).where(User.id == share.shared_with_id))
        with_user = with_result.scalar_one_or_none()

        resource_name = await get_resource_name(share.resource_type, share.resource_id, db)

        response.append(ShareResponse(
            id=share.id,
            resource_type=share.resource_type,
            resource_id=share.resource_id,
            resource_name=resource_name,
            shared_by_id=share.shared_by_id,
            shared_by_name=by_user.name if by_user else "Unknown",
            shared_with_id=share.shared_with_id,
            shared_with_name=with_user.name if with_user else "Unknown",
            access_level=share.access_level,
            note=share.note,
            expires_at=share.expires_at,
            created_at=share.created_at
        ))

    return response


@router.get("/users", response_model=List[UserSimple])
async def get_sharable_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of users that can be shared with (same organization)"""
    current_user = await db.merge(current_user)

    org = await get_user_org(current_user, db)
    if not org:
        return []

    # Import models here to avoid circular imports
    from ..models.database import Department, DepartmentMember

    # Get all users in the same organization with their roles and departments
    result = await db.execute(
        select(User, OrgMember)
        .join(OrgMember, OrgMember.user_id == User.id)
        .where(
            OrgMember.org_id == org.id,
            User.id != current_user.id,
            User.is_active == True
        )
        .order_by(User.name)
    )
    rows = result.all()

    # Build response with role information
    response = []
    for user, org_member in rows:
        # Get user's first department (if any)
        dept_result = await db.execute(
            select(Department, DepartmentMember)
            .join(DepartmentMember, DepartmentMember.department_id == Department.id)
            .where(DepartmentMember.user_id == user.id)
            .limit(1)
        )
        dept_row = dept_result.first()

        dept_name = None
        dept_role = None
        if dept_row:
            dept, dept_member = dept_row
            dept_name = dept.name
            dept_role = dept_member.role.value if dept_member.role else None

        response.append(UserSimple(
            id=user.id,
            name=user.name,
            email=user.email,
            org_role=org_member.role.value if org_member.role else None,
            department_name=dept_name,
            department_role=dept_role
        ))

    return response
