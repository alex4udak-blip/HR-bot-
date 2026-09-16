"""Яркие ярлыки у ФИО переехали в общий справочник меток.

Раньше это были две почти одинаковые сущности: метки — org-справочник, теги у
имени — свободный текст в extra_data карточки. Отсюда «перформер» рядом с
«перфомер». Теперь справочник один, а «показывать у имени» — флаг на СВЯЗИ
кандидат↔метка: одна метка у одного человека ярлык у имени, у другого обычная.
"""
from datetime import datetime

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import (
    Department, Entity, EntityStatus, EntityTag, EntityType, OrgMember,
    Organization, User, entity_tag_association,
)
from api.services.auth import create_access_token
from api.services.headline_tags_backfill import backfill_headline_tags
from tests.conftest import auth_headers


def _headers(user: User) -> dict:
    return auth_headers(create_access_token(data={"sub": str(user.id)}))


@pytest_asyncio.fixture
async def tagged_candidate(
    db_session: AsyncSession, organization: Organization, department: Department,
    admin_user: User, org_owner: OrgMember,
):
    """Кандидат со старыми тегами у имени прямо в extra_data."""
    entity = Entity(
        org_id=organization.id, department_id=department.id, created_by=admin_user.id,
        name="Руслан", type=EntityType.candidate, status=EntityStatus.new,
        created_at=datetime.utcnow(),
        extra_data={"headline_tags": [
            {"text": "перфомер", "color": "purple"},
            {"text": "срочно", "color": "red"},
        ]},
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


async def _links(db: AsyncSession, entity_id: int):
    rows = (await db.execute(
        select(EntityTag.name, entity_tag_association.c.show_at_name)
        .join(entity_tag_association, EntityTag.id == entity_tag_association.c.tag_id)
        .where(entity_tag_association.c.entity_id == entity_id)
    )).all()
    return {name: bool(flag) for name, flag in rows}


async def test_backfill_moves_headline_tags_into_catalog(
    db_session: AsyncSession, tagged_candidate: Entity,
):
    created_tags, created_links = await backfill_headline_tags(db_session)
    assert created_tags == 2 and created_links == 2

    assert await _links(db_session, tagged_candidate.id) == {
        "перфомер": True, "срочно": True,
    }
    # Исходные данные не трогаем — откат не должен ничего терять.
    await db_session.refresh(tagged_candidate)
    assert len(tagged_candidate.extra_data["headline_tags"]) == 2


async def test_backfill_is_idempotent(
    db_session: AsyncSession, tagged_candidate: Entity,
):
    """Бэкафилл висит на старте — повторный прогон не должен плодить дубли."""
    await backfill_headline_tags(db_session)
    created_tags, created_links = await backfill_headline_tags(db_session)
    assert (created_tags, created_links) == (0, 0)
    assert len(await _links(db_session, tagged_candidate.id)) == 2


async def test_backfill_reuses_existing_catalog_tag(
    db_session: AsyncSession, organization: Organization, tagged_candidate: Entity,
):
    """Метка с таким же именем уже есть — новую не заводим, поднимаем к ФИО.

    Регистр не важен: «Перфомер» и «перфомер» для человека одно и то же.
    """
    existing = EntityTag(
        org_id=organization.id, name="Перфомер", color="var(--hf-status-blue)",
        kind="general",
    )
    db_session.add(existing)
    await db_session.commit()

    created_tags, _ = await backfill_headline_tags(db_session)
    assert created_tags == 1, "заведена только «срочно», «перфомер» переиспользован"

    names = await _links(db_session, tagged_candidate.id)
    assert names == {"Перфомер": True, "срочно": True}


async def test_attach_with_show_at_name_flag(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    """Одна метка: одному кандидату ярлык у имени, другому — обычная."""
    tag = EntityTag(org_id=organization.id, name="перформер", color="var(--hf-status-purple)")
    other = Entity(
        org_id=organization.id, name="Второй", type=EntityType.candidate,
        status=EntityStatus.new, created_at=datetime.utcnow(),
    )
    db_session.add_all([tag, other])
    await db_session.commit()

    r = await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}",
        json={"show_at_name": True}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/tags/entities/{other.id}/tags/{tag.id}",
        json={"show_at_name": False}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text

    assert await _links(db_session, candidate_entity.id) == {"перформер": True}
    assert await _links(db_session, other.id) == {"перформер": False}


async def test_attach_without_body_keeps_old_behaviour(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    """Старые вызовы без тела — обычная метка, как и было."""
    tag = EntityTag(org_id=organization.id, name="англ", color="var(--hf-green-500)")
    db_session.add(tag)
    await db_session.commit()

    r = await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}",
        headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    assert await _links(db_session, candidate_entity.id) == {"англ": False}


async def test_reattach_raises_existing_tag_to_name(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    """Метка уже висит обычной, жмём «+ тег» у имени — она должна подняться.

    Иначе кнопка молча не срабатывает на уже проставленной метке.
    """
    tag = EntityTag(org_id=organization.id, name="срочно", color="var(--hf-red-500)")
    db_session.add(tag)
    await db_session.commit()

    await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}",
        headers=_headers(admin_user),
    )
    r = await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}",
        json={"show_at_name": True}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    assert await _links(db_session, candidate_entity.id) == {"срочно": True}


async def test_toggle_show_at_name(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    """Снять ярлык с имени, не снимая метку с кандидата."""
    tag = EntityTag(org_id=organization.id, name="перформер", color="var(--hf-status-purple)")
    db_session.add(tag)
    await db_session.commit()
    await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}",
        json={"show_at_name": True}, headers=_headers(admin_user),
    )

    r = await client.patch(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}/show-at-name",
        json={"show_at_name": False}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    assert await _links(db_session, candidate_entity.id) == {"перформер": False}, (
        "метка осталась на кандидате, просто не у имени"
    )


async def test_show_at_name_requires_attached_tag(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    tag = EntityTag(org_id=organization.id, name="ничей", color="var(--hf-red-500)")
    db_session.add(tag)
    await db_session.commit()

    r = await client.patch(
        f"/api/tags/entities/{candidate_entity.id}/tags/{tag.id}/show-at-name",
        json={"show_at_name": True}, headers=_headers(admin_user),
    )
    assert r.status_code == 404, r.text


async def test_entity_tags_response_carries_flag(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    """Фронт рисует чипы по этому флагу — он обязан быть в выдаче."""
    at_name = EntityTag(org_id=organization.id, name="перформер", color="var(--hf-status-purple)")
    plain = EntityTag(org_id=organization.id, name="англ", color="var(--hf-green-500)")
    db_session.add_all([at_name, plain])
    await db_session.commit()
    await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{at_name.id}",
        json={"show_at_name": True}, headers=_headers(admin_user),
    )
    await client.post(
        f"/api/tags/entities/{candidate_entity.id}/tags/{plain.id}",
        headers=_headers(admin_user),
    )

    r = await client.get(
        f"/api/tags/entities/{candidate_entity.id}/tags", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    got = {t["name"]: t["show_at_name"] for t in r.json()}
    assert got == {"перформер": True, "англ": False}
