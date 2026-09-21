"""«Статусы»: у кандидата может быть два HR (встреча 21.09.2026).

Кандидата нередко ведут вдвоём, а колонка HR держала одного — второго
приходилось держать в голове. Теперь в строке до двух HR с инициалами.
"""
from datetime import datetime

import pytest

from api.models.database import Entity, EntityStatus, EntityType
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _mk(db, org, creator, extra=None):
    e = Entity(
        org_id=org.id, name="Двоев Дмитрий", type=EntityType.candidate,
        status=EntityStatus.probation, created_by=creator.id,
        created_at=datetime.utcnow(), extra_data=extra or {},
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


async def _row(client, user, eid):
    r = await client.get("/api/staff-board/rows", headers=_h(user))
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["entity_id"] == eid)


@pytest.mark.asyncio
async def test_two_hr_saved_and_shown(client, db_session, organization, admin_user, second_user, org_owner):
    e = await _mk(db_session, organization, admin_user)
    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"assignee_user_ids": [admin_user.id, second_user.id]},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert [a["user_id"] for a in r.json()["assignees"]] == [admin_user.id, second_user.id]
    assert all(a["name"] for a in r.json()["assignees"])

    row = await _row(client, admin_user, e.id)
    assert [a["user_id"] for a in row["assignees"]] == [admin_user.id, second_user.id]
    # первый HR остаётся в старых полях — на них завязаны фильтры
    assert row["assignee_user_id"] == admin_user.id


@pytest.mark.asyncio
async def test_more_than_two_rejected(client, db_session, organization, admin_user, second_user, regular_user, org_owner):
    e = await _mk(db_session, organization, admin_user)
    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"assignee_user_ids": [admin_user.id, second_user.id, regular_user.id]},
        headers=_h(admin_user),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_single_field_replaces_list(client, db_session, organization, admin_user, second_user, org_owner):
    """Старый клиент шлёт одного HR — второй не должен «воскреснуть»."""
    e = await _mk(db_session, organization, admin_user)
    await client.patch(f"/api/staff-board/rows/{e.id}",
                       json={"assignee_user_ids": [admin_user.id, second_user.id]}, headers=_h(admin_user))
    r = await client.patch(f"/api/staff-board/rows/{e.id}",
                           json={"assignee_user_id": second_user.id}, headers=_h(admin_user))
    assert [a["user_id"] for a in r.json()["assignees"]] == [second_user.id]

    r = await client.patch(f"/api/staff-board/rows/{e.id}",
                           json={"assignee_user_ids": []}, headers=_h(admin_user))
    assert r.json()["assignees"] == []


@pytest.mark.asyncio
async def test_two_hr_from_funnel(client, db_session, organization, admin_user, org_owner):
    """Руками не выбрано — берём обоих HR из воронки, помеченных как авто."""
    e = await _mk(db_session, organization, admin_user, {"system_hr_tags": [
        {"hr_id": 101, "name": "Лиза"}, {"hr_id": 102, "name": "Егор"}, {"hr_id": 103, "name": "Третий"},
    ]})
    row = await _row(client, admin_user, e.id)
    assert [(a["user_id"], a["auto"]) for a in row["assignees"]] == [(101, True), (102, True)]
