"""Гарантии безопасности очистки HR-раздела (POST /api/candidates/wipe-hr-section).

Критично: архив (is_archived=true) и чужие орги НЕ должны пострадать; чистить может
только HR-админ.
"""
import pytest
from sqlalchemy import select

from api.models.database import Entity, EntityType, EntityStatus
from api.services.auth import create_access_token


def _h(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.mark.asyncio
async def test_wipe_preserves_archive_and_other_org(
    client, db_session, organization, admin_user, org_owner, second_organization
):
    active = Entity(org_id=organization.id, type=EntityType.candidate, name="Активный",
                    status=EntityStatus.new, is_archived=False)
    archived = Entity(org_id=organization.id, type=EntityType.candidate, name="Архивный",
                      status=EntityStatus.new, is_archived=True)
    other_org = Entity(org_id=second_organization.id, type=EntityType.candidate, name="Чужой орг",
                       status=EntityStatus.new, is_archived=False)
    db_session.add_all([active, archived, other_org])
    await db_session.commit()
    active_id, archived_id, other_id = active.id, archived.id, other_org.id

    H = _h(admin_user)

    # Превью ничего не удаляет
    r = await client.post("/api/candidates/wipe-hr-section?confirm=false", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert body["will_delete"]["active_candidates"] >= 1
    assert body["preserved"]["archived_candidates"] >= 1
    assert (await db_session.execute(select(Entity).where(Entity.id == active_id))).scalar_one_or_none() is not None

    # Реальная чистка
    r = await client.post("/api/candidates/wipe-hr-section?confirm=true", headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["dry_run"] is False

    # Активный — удалён; архивный и чужой орг — целы
    assert (await db_session.execute(select(Entity).where(Entity.id == active_id))).scalar_one_or_none() is None
    assert (await db_session.execute(select(Entity).where(Entity.id == archived_id))).scalar_one_or_none() is not None
    assert (await db_session.execute(select(Entity).where(Entity.id == other_id))).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_wipe_requires_hr_admin(client, db_session, organization, second_user, org_member):
    """Рекрутёр (member) не может чистить HR-раздел."""
    r = await client.post("/api/candidates/wipe-hr-section?confirm=true", headers=_h(second_user))
    assert r.status_code == 403, r.text
