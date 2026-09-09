"""Entity tags / labels endpoints."""
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, field_validator

from ..models.database import EntityTag, Entity, User, OrgMember, entity_tag_association
from ..database import get_db
from ..services.auth import get_current_user

router = APIRouter()


_HTML_TAG_RE = re.compile(r"<[^>]*>")

# Тип метки. 'sourcer' — тот, кто привёл кандидата (внешний человек без доступа
# в систему); остальные метки обычные ярлыки. Нужен, чтобы аналитика по сорсерам
# не считала заодно «Срочно» и «Знает английский».
TAG_KINDS = ("general", "sourcer")


class TagCreate(BaseModel):
    name: str
    color: str = "#3b82f6"
    kind: str = "general"

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        if v not in TAG_KINDS:
            raise ValueError(f"kind must be one of {TAG_KINDS}")
        return v

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        if not v:
            raise ValueError("name cannot be empty")
        cleaned = _HTML_TAG_RE.sub("", v).strip()
        if not cleaned:
            raise ValueError("name cannot be empty")
        if len(cleaned) > 80:
            raise ValueError("name must be 80 characters or fewer")
        return cleaned


class TagOut(BaseModel):
    id: int
    org_id: int
    name: str
    color: str
    created_by: int | None = None
    created_at: datetime | None = None
    archived_at: datetime | None = None
    kind: str = "general"

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
    include_archived: bool = False,
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Метки организации для выбора. Скрытые («удалённые за ненадобностью») не
    отдаём: они больше не предлагаются в списке, но продолжают показываться на
    карточках кандидатов, которым уже проставлены (см. get_entity_tags).
    include_archived=true — для экрана управления метками."""
    org_id = await _get_org_id(db, current_user)
    query = select(EntityTag).where(EntityTag.org_id == org_id)
    if kind is not None:
        if kind not in TAG_KINDS:
            raise HTTPException(422, f"kind must be one of {TAG_KINDS}")
        query = query.where(EntityTag.kind == kind)
    if not include_archived:
        query = query.where(EntityTag.archived_at.is_(None))
    result = await db.execute(query.order_by(EntityTag.name))
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
    existing = (await db.execute(
        select(EntityTag).where(
            EntityTag.org_id == org_id,
            EntityTag.name == data.name.strip(),
        )
    )).scalar_one_or_none()
    if existing is not None:
        if existing.archived_at is None:
            raise HTTPException(409, "Tag with this name already exists")
        # Метку с таким именем когда-то скрыли, а теперь заводят снова —
        # возвращаем её из архива вместо второй записи с тем же именем
        # (unique(org_id, name) второй всё равно не даст создать).
        existing.archived_at = None
        existing.color = data.color
        existing.kind = data.kind
        await db.commit()
        await db.refresh(existing)
        return existing

    tag = EntityTag(
        org_id=org_id,
        name=data.name.strip(),
        color=data.color,
        kind=data.kind,
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
    """НАСТОЯЩЕЕ удаление: сносит метку и со ВСЕХ карточек разом (у entity_tags
    стоит ondelete=CASCADE). Интерфейс этим НЕ пользуется — кнопка «удалить за
    ненадобностью» вызывает /archive, чтобы у кандидатов метка осталась.
    Оставлено для чистки мусора вручную; вешать на кнопку без явного
    подтверждения «сорвать у всех» нельзя."""
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


class TagUpdate(BaseModel):
    kind: str | None = None
    color: str | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str | None) -> str | None:
        if v is not None and v not in TAG_KINDS:
            raise ValueError(f"kind must be one of {TAG_KINDS}")
        return v


@router.patch("/{tag_id}", response_model=TagOut)
async def update_tag(
    tag_id: int,
    data: TagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Поменять тип или цвет метки.

    Нужен в первую очередь для меток, заведённых до появления типа: они все
    'general', и без этого пометить старого «Сорсера Ивана» было бы нечем,
    кроме как завести заново. Имя не меняем — по нему метку узнают на карточках.
    """
    org_id = await _get_org_id(db, current_user)
    tag = (await db.execute(
        select(EntityTag).where(EntityTag.id == tag_id, EntityTag.org_id == org_id)
    )).scalar_one_or_none()
    if not tag:
        raise HTTPException(404, "Tag not found")
    if data.kind is not None:
        tag.kind = data.kind
    if data.color is not None:
        tag.color = data.color
    await db.commit()
    await db.refresh(tag)
    return tag


@router.post("/{tag_id}/archive", response_model=TagOut)
async def archive_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Убрать метку из списка выбора, НЕ трогая карточки кандидатов.

    Это и есть «удалить за ненадобностью» с точки зрения рекрутёра: метка
    перестаёт предлагаться при добавлении, но у тех, кому уже проставлена,
    остаётся — снять её оттуда можно крестиком на самой карточке.
    Идемпотентно: повторный вызов ничего не меняет.
    """
    org_id = await _get_org_id(db, current_user)
    tag = (await db.execute(
        select(EntityTag).where(EntityTag.id == tag_id, EntityTag.org_id == org_id)
    )).scalar_one_or_none()
    if not tag:
        raise HTTPException(404, "Tag not found")
    if tag.archived_at is None:
        tag.archived_at = datetime.utcnow()
        await db.commit()
        await db.refresh(tag)
    return tag


@router.post("/{tag_id}/restore", response_model=TagOut)
async def restore_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Вернуть скрытую метку в список выбора."""
    org_id = await _get_org_id(db, current_user)
    tag = (await db.execute(
        select(EntityTag).where(EntityTag.id == tag_id, EntityTag.org_id == org_id)
    )).scalar_one_or_none()
    if not tag:
        raise HTTPException(404, "Tag not found")
    if tag.archived_at is not None:
        tag.archived_at = None
        await db.commit()
        await db.refresh(tag)
    return tag


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
