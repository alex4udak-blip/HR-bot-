from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Literal
from datetime import datetime
from pydantic import BaseModel

from ..database import get_db
from ..models.database import (
    Entity, EntityType, EntityStatus, EntityTransfer,
    Chat, CallRecording, AnalysisHistory, User, Organization,
    SharedAccess, ResourceType, UserRole
)
from ..services.auth import get_current_user, get_user_org

# Ownership filter type
OwnershipFilter = Literal["all", "mine", "shared"]

router = APIRouter()


# === Pydantic Schemas ===

class EntityCreate(BaseModel):
    type: EntityType
    name: str
    status: Optional[EntityStatus] = EntityStatus.new
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    company: Optional[str] = None
    position: Optional[str] = None
    tags: Optional[List[str]] = []
    extra_data: Optional[dict] = {}


class EntityUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[EntityStatus] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    position: Optional[str] = None
    tags: Optional[List[str]] = None
    extra_data: Optional[dict] = None


class TransferCreate(BaseModel):
    to_user_id: int
    to_department: Optional[str] = None
    comment: Optional[str] = None


class EntityResponse(BaseModel):
    id: int
    type: EntityType
    name: str
    status: EntityStatus
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    company: Optional[str] = None
    position: Optional[str] = None
    tags: List[str] = []
    extra_data: dict = {}
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    chats_count: int = 0
    calls_count: int = 0

    class Config:
        from_attributes = True


class TransferResponse(BaseModel):
    id: int
    entity_id: int
    from_user_id: Optional[int] = None
    to_user_id: Optional[int] = None
    from_department: Optional[str] = None
    to_department: Optional[str] = None
    comment: Optional[str] = None
    created_at: datetime
    from_user_name: Optional[str] = None
    to_user_name: Optional[str] = None

    class Config:
        from_attributes = True


# === Routes ===

@router.get("")
async def list_entities(
    type: Optional[EntityType] = None,
    status: Optional[EntityStatus] = None,
    search: Optional[str] = None,
    tags: Optional[str] = None,  # comma-separated
    ownership: Optional[OwnershipFilter] = None,  # mine, shared, all
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List contacts with filters (filtered by user's organization)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return []

    # Determine base query based on ownership filter
    if ownership == "mine":
        # Only entities created by current user
        query = select(Entity).where(
            Entity.org_id == org.id,
            Entity.created_by == current_user.id
        )
    elif ownership == "shared":
        # Only entities shared with current user (not owned by them)
        shared_ids_query = select(SharedAccess.resource_id).where(
            SharedAccess.resource_type == ResourceType.entity,
            SharedAccess.shared_with_id == current_user.id,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )
        query = select(Entity).where(
            Entity.org_id == org.id,
            Entity.id.in_(shared_ids_query),
            Entity.created_by != current_user.id  # Exclude own entities
        )
    else:
        # All entities in organization (for superadmin) or own + shared (for others)
        if current_user.role == UserRole.SUPERADMIN:
            query = select(Entity).where(Entity.org_id == org.id)
        else:
            # Own entities + shared with me
            shared_ids_query = select(SharedAccess.resource_id).where(
                SharedAccess.resource_type == ResourceType.entity,
                SharedAccess.shared_with_id == current_user.id,
                or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
            )
            query = select(Entity).where(
                Entity.org_id == org.id,
                or_(
                    Entity.created_by == current_user.id,
                    Entity.id.in_(shared_ids_query)
                )
            )

    if type:
        query = query.where(Entity.type == type)
    if status:
        query = query.where(Entity.status == status)
    if search:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Entity.name.ilike(search_term),
                Entity.email.ilike(search_term),
                Entity.phone.ilike(search_term),
                Entity.company.ilike(search_term)
            )
        )
    if tags:
        tag_list = [t.strip() for t in tags.split(",")]
        for tag in tag_list:
            query = query.where(Entity.tags.contains([tag]))

    query = query.order_by(Entity.updated_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    entities = result.scalars().all()

    # Pre-fetch shared entity IDs for current user
    shared_with_me_result = await db.execute(
        select(SharedAccess.resource_id).where(
            SharedAccess.resource_type == ResourceType.entity,
            SharedAccess.shared_with_id == current_user.id,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )
    )
    shared_with_me_ids = set(shared_with_me_result.scalars().all())

    # Pre-fetch owner names
    creator_ids = list(set(e.created_by for e in entities if e.created_by))
    owner_names = {}
    if creator_ids:
        owners_result = await db.execute(select(User).where(User.id.in_(creator_ids)))
        for owner in owners_result.scalars().all():
            owner_names[owner.id] = owner.name

    # Count related data
    response = []
    for entity in entities:
        chats_count = await db.execute(
            select(func.count(Chat.id)).where(Chat.entity_id == entity.id)
        )
        calls_count = await db.execute(
            select(func.count(CallRecording.id)).where(CallRecording.entity_id == entity.id)
        )

        is_mine = entity.created_by == current_user.id
        is_shared = entity.id in shared_with_me_ids and not is_mine

        response.append({
            "id": entity.id,
            "type": entity.type,
            "name": entity.name,
            "status": entity.status,
            "phone": entity.phone,
            "email": entity.email,
            "telegram_user_id": entity.telegram_user_id,
            "company": entity.company,
            "position": entity.position,
            "tags": entity.tags or [],
            "extra_data": entity.extra_data or {},
            "created_by": entity.created_by,
            "owner_name": owner_names.get(entity.created_by, "Unknown"),
            "is_mine": is_mine,
            "is_shared": is_shared,
            "created_at": entity.created_at,
            "updated_at": entity.updated_at,
            "chats_count": chats_count.scalar() or 0,
            "calls_count": calls_count.scalar() or 0
        })

    return response


@router.post("")
async def create_entity(
    data: EntityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a contact (in user's organization)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    entity = Entity(
        org_id=org.id,
        type=data.type,
        name=data.name,
        status=data.status,
        phone=data.phone,
        email=data.email,
        telegram_user_id=data.telegram_user_id,
        company=data.company,
        position=data.position,
        tags=data.tags or [],
        extra_data=data.extra_data or {},
        created_by=current_user.id
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)

    return {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status,
        "phone": entity.phone,
        "email": entity.email,
        "telegram_user_id": entity.telegram_user_id,
        "company": entity.company,
        "position": entity.position,
        "tags": entity.tags or [],
        "extra_data": entity.extra_data or {},
        "created_by": entity.created_by,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
        "chats_count": 0,
        "calls_count": 0
    }


@router.get("/{entity_id}")
async def get_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get contact with all relations"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Load related data
    chats_result = await db.execute(
        select(Chat).where(Chat.entity_id == entity_id)
    )
    calls_result = await db.execute(
        select(CallRecording).where(CallRecording.entity_id == entity_id).order_by(CallRecording.created_at.desc())
    )
    transfers_result = await db.execute(
        select(EntityTransfer).where(EntityTransfer.entity_id == entity_id).order_by(EntityTransfer.created_at.desc())
    )
    analyses_result = await db.execute(
        select(AnalysisHistory).where(AnalysisHistory.entity_id == entity_id).order_by(AnalysisHistory.created_at.desc())
    )

    chats = chats_result.scalars().all()
    calls = calls_result.scalars().all()
    transfers = transfers_result.scalars().all()
    analyses = analyses_result.scalars().all()

    # Get user names for transfers
    transfer_data = []
    for t in transfers:
        from_user_name = None
        to_user_name = None
        if t.from_user_id:
            from_user = await db.execute(select(User.name).where(User.id == t.from_user_id))
            from_user_name = from_user.scalar()
        if t.to_user_id:
            to_user = await db.execute(select(User.name).where(User.id == t.to_user_id))
            to_user_name = to_user.scalar()

        transfer_data.append({
            "id": t.id,
            "entity_id": t.entity_id,
            "from_user_id": t.from_user_id,
            "to_user_id": t.to_user_id,
            "from_department": t.from_department,
            "to_department": t.to_department,
            "comment": t.comment,
            "created_at": t.created_at,
            "from_user_name": from_user_name,
            "to_user_name": to_user_name
        })

    return {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status,
        "phone": entity.phone,
        "email": entity.email,
        "telegram_user_id": entity.telegram_user_id,
        "company": entity.company,
        "position": entity.position,
        "tags": entity.tags or [],
        "extra_data": entity.extra_data or {},
        "created_by": entity.created_by,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
        "chats": [
            {
                "id": c.id,
                "title": c.custom_name or c.title,
                "chat_type": c.chat_type,
                "created_at": c.created_at
            }
            for c in chats
        ],
        "calls": [
            {
                "id": c.id,
                "source_type": c.source_type,
                "status": c.status,
                "duration_seconds": c.duration_seconds,
                "summary": c.summary,
                "created_at": c.created_at
            }
            for c in calls
        ],
        "transfers": transfer_data,
        "analyses": [
            {
                "id": a.id,
                "report_type": a.report_type,
                "result": a.result[:500] if a.result else None,
                "created_at": a.created_at
            }
            for a in analyses
        ]
    }


@router.put("/{entity_id}")
async def update_entity(
    entity_id: int,
    data: EntityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(entity, key, value)

    entity.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(entity)

    return {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status,
        "phone": entity.phone,
        "email": entity.email,
        "telegram_user_id": entity.telegram_user_id,
        "company": entity.company,
        "position": entity.position,
        "tags": entity.tags or [],
        "extra_data": entity.extra_data or {},
        "created_by": entity.created_by,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at
    }


@router.delete("/{entity_id}")
async def delete_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    await db.delete(entity)
    await db.commit()
    return {"success": True}


@router.post("/{entity_id}/transfer")
async def transfer_entity(
    entity_id: int,
    data: TransferCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Transfer contact to another HR"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Create transfer record
    transfer = EntityTransfer(
        entity_id=entity_id,
        from_user_id=current_user.id,
        to_user_id=data.to_user_id,
        from_department=current_user.name,
        to_department=data.to_department,
        comment=data.comment
    )
    db.add(transfer)
    await db.commit()

    # TODO: Send notification to recipient via Telegram

    return {"success": True, "transfer_id": transfer.id}


@router.post("/{entity_id}/link-chat/{chat_id}")
async def link_chat_to_entity(
    entity_id: int,
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Link a chat to a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Verify entity exists and belongs to same org
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    # Get and update chat (must belong to same org)
    chat_result = await db.execute(
        select(Chat).where(Chat.id == chat_id, Chat.org_id == org.id)
    )
    chat = chat_result.scalar_one_or_none()

    if not chat:
        raise HTTPException(404, "Chat not found")

    chat.entity_id = entity_id
    await db.commit()
    return {"success": True}


@router.delete("/{entity_id}/unlink-chat/{chat_id}")
async def unlink_chat_from_entity(
    entity_id: int,
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Unlink a chat from a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    chat_result = await db.execute(
        select(Chat).where(
            Chat.id == chat_id,
            Chat.entity_id == entity_id,
            Chat.org_id == org.id
        )
    )
    chat = chat_result.scalar_one_or_none()

    if not chat:
        raise HTTPException(404, "Chat not found or not linked to this entity")

    chat.entity_id = None
    await db.commit()
    return {"success": True}


@router.get("/stats/by-type")
async def get_entities_stats_by_type(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get entity counts by type (filtered by org)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return {}

    result = await db.execute(
        select(Entity.type, func.count(Entity.id))
        .where(Entity.org_id == org.id)
        .group_by(Entity.type)
    )
    stats = {row[0].value: row[1] for row in result.all()}
    return stats


@router.get("/stats/by-status")
async def get_entities_stats_by_status(
    type: Optional[EntityType] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get entity counts by status (filtered by org)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return {}

    query = select(Entity.status, func.count(Entity.id)).where(Entity.org_id == org.id)
    if type:
        query = query.where(Entity.type == type)
    query = query.group_by(Entity.status)

    result = await db.execute(query)
    stats = {row[0].value: row[1] for row in result.all()}
    return stats
