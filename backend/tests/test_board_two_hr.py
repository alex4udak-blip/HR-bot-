"""«Статусы»: несколько HR на человека (встреча 21.09.2026).

HR подтягиваются из меток «HR: …» кандидата; в колонке их можно снять («×»
на кружке) и добавить («+»). Правка руками перебивает метки целиком.
"""
from datetime import datetime

import pytest

from api.models.database import Entity, EntityStatus, EntityTag, EntityType, entity_tag_association
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
async def test_too_many_rejected(client, db_session, organization, admin_user, org_owner):
    e = await _mk(db_session, organization, admin_user)
    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"assignee_user_ids": list(range(1, 8))},
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

    # старый способ «очистить» (null в одиночном поле) возвращает HR из меток
    r = await client.patch(f"/api/staff-board/rows/{e.id}",
                           json={"assignee_user_id": None}, headers=_h(admin_user))
    assert r.status_code == 200

@pytest.mark.asyncio
async def test_two_hr_from_funnel(client, db_session, organization, admin_user, org_owner):
    """Руками не выбрано — берём обоих HR из воронки, помеченных как авто."""
    e = await _mk(db_session, organization, admin_user, {"system_hr_tags": [
        {"hr_id": 101, "name": "Лиза"}, {"hr_id": 102, "name": "Егор"}, {"hr_id": 103, "name": "Третий"},
    ]})
    row = await _row(client, admin_user, e.id)
    assert [(a["user_id"], a["auto"]) for a in row["assignees"]] == [(101, True), (102, True), (103, True)]


@pytest.mark.asyncio
async def test_removed_funnel_hr_stays_removed(client, db_session, organization, admin_user, org_owner):
    """«×» по HR из меток: остальные остаются, снятый не возвращается; сняли
    последнего — строка без HR, метки его не подставляют обратно."""
    e = await _mk(db_session, organization, admin_user, {"system_hr_tags": [
        {"hr_id": 101, "name": "Лиза"}, {"hr_id": 102, "name": "Егор"},
    ]})
    await client.patch(f"/api/staff-board/rows/{e.id}", json={"assignee_user_ids": [102]}, headers=_h(admin_user))
    row = await _row(client, admin_user, e.id)
    assert [a["user_id"] for a in row["assignees"]] == [102]

    await client.patch(f"/api/staff-board/rows/{e.id}", json={"assignee_user_ids": []}, headers=_h(admin_user))
    row = await _row(client, admin_user, e.id)
    assert row["assignees"] == []


@pytest.mark.asyncio
async def test_patch_keeps_sourcers_in_response(client, db_session, organization, admin_user, org_owner):
    """После «×» по HR ответ строки должен нести и сорсеров, иначе их кружки
    пропадали из ячейки до перезагрузки."""
    e = await _mk(db_session, organization, admin_user, {"system_hr_tags": [{"hr_id": 101, "name": "Лиза"}]})
    tag = EntityTag(org_id=organization.id, name="Олег", color="#0ea5e9", kind="sourcer")
    db_session.add(tag)
    await db_session.commit()
    await db_session.execute(entity_tag_association.insert().values(entity_id=e.id, tag_id=tag.id))
    await db_session.commit()

    r = await client.patch(f"/api/staff-board/rows/{e.id}", json={"assignee_user_ids": []}, headers=_h(admin_user))
    assert r.status_code == 200, r.text
    assert [s["name"] for s in r.json()["sourcers"]] == ["Олег"]
