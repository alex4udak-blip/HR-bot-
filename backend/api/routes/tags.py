"""Entity tags / labels endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from ..models.database import EntityTag, Entity, User, OrgMember, entity_tag_association
from ..database import get_db
from ..services.auth import get_current_user

router = APIRouter()


class TagCreate(BaseModel):
    name: str
    color: str = "#3b82f6"


class TagOut(BaseModel):
    id: int
    org_id: int
    name: str
    color: str
    created_by: int | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


async def _get_org_id(db: AsyncSession, user: User) -> int:
    result = await db.execute(
        select(OrgMember.org_id).where(OrgMember.user_id == user.id).limit(1)
    )
    org_id = result.scalar_one_or_none()
    if not org_id:
        raise HTTPException(404, "No organization")
    return org_id


@router.get("", response_model=list[TagOut])
async def list_tags(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all tags for the current organization."""
    org_id = await _get_org_id(db, current_user)
    result = await db.execute(
        select(EntityTag)
        .where(EntityTag.org_id == org_id)
        .order_by(EntityTag.name)
    )
    return list(result.scalars().all())


@router.post("", response_model=TagOut)
async def create_tag(
    data: TagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new tag for the organization."""
    org_id = await _get_org_id(db, current_user)

    # Check for duplicate name
    existing = await db.execute(
        select(EntityTag).where(
            EntityTag.org_id == org_id,
            EntityTag.name == data.name.strip(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Tag with this name already exists")

    tag = EntityTag(
        org_id=org_id,
        name=data.name.strip(),
        color=data.color,
        created_by=current_user.id,
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/{tag_id}")
async def delete_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a tag (removes it from all entities too via CASCADE)."""
    org_id = await _get_org_id(db, current_user)
    result = await db.execute(
        select(EntityTag).where(EntityTag.id == tag_id, EntityTag.org_id == org_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(404, "Tag not found")

    await db.delete(tag)
    await db.commit()
    return {"ok": True}


# ==================== Entity <-> Tag ====================

@router.get("/entities/{entity_id}/tags", response_model=list[TagOut])
async def get_entity_tags(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all tags for an entity."""
    org_id = await _get_org_id(db, current_user)

    # Verify entity belongs to org
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org_id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    result = await db.execute(
        select(EntityTag)
        .join(entity_tag_association, EntityTag.id == entity_tag_association.c.tag_id)
        .where(entity_tag_association.c.entity_id == entity_id)
        .order_by(EntityTag.name)
    )
    return list(result.scalars().all())


@router.post("/entities/{entity_id}/tags/{tag_id}")
async def add_tag_to_entity(
    entity_id: int,
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a tag to an entity."""
    org_id = await _get_org_id(db, current_user)

    # Verify entity
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org_id)
    )
    if not entity_result.scalar_one_or_none():
        raise HTTPException(404, "Entity not found")

    # Verify tag
    tag_result = await db.execute(
        select(EntityTag).where(EntityTag.id == tag_id, EntityTag.org_id == org_id)
    )
    if not tag_result.scalar_one_or_none():
        raise HTTPException(404, "Tag not found")

    # Check if already linked
    existing = await db.execute(
        select(entity_tag_association).where(
            entity_tag_association.c.entity_id == entity_id,
            entity_tag_association.c.tag_id == tag_id,
        )
    )
    if existing.first():
        return {"ok": True, "message": "Already tagged"}

    await db.execute(
        entity_tag_association.insert().values(entity_id=entity_id, tag_id=tag_id)
    )
    await db.commit()
    return {"ok": True}


@router.delete("/entities/{entity_id}/tags/{tag_id}")
async def remove_tag_from_entity(
    entity_id: int,
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a tag from an entity."""
    org_id = await _get_org_id(db, current_user)

    # Verify entity belongs to org
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org_id)
    )
    if not entity_result.scalar_one_or_none():
        raise HTTPException(404, "Entity not found")

    await db.execute(
        delete(entity_tag_association).where(
            entity_tag_association.c.entity_id == entity_id,
            entity_tag_association.c.tag_id == tag_id,
        )
    )
    await db.commit()
    return {"ok": True}
