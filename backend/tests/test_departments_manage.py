"""Отделы заводят и сносят HR, а не только владелец (встреча 23.09.2026).

Мария (admin) упиралась в 403 прямо на «Статусах». Плюс удаление больше не
упирается в «в отделе есть люди»: неактуальные отделы сносят и заводят заново,
люди при этом уходят в «Без отдела», а не теряются.
"""
from datetime import datetime

import pytest

from api.models.database import (
    Department, DepartmentMember, DeptRole, Entity, EntityStatus, EntityType,
    OrgMember, OrgRole,
)
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _member(db, org, user, role):
    m = OrgMember(org_id=org.id, user_id=user.id, role=role, created_at=datetime.utcnow())
    db.add(m)
    await db.commit()
    return m


async def _dept(db, org, name):
    d = Department(org_id=org.id, name=name, is_active=True)
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return d


@pytest.mark.asyncio
async def test_hr_can_create_department(client, db_session, organization, regular_user):
    await _member(db_session, organization, regular_user, OrgRole.hr)
    r = await client.post("/api/departments", json={"name": "Фарм отдел"}, headers=_h(regular_user))
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Фарм отдел"


@pytest.mark.asyncio
async def test_plain_member_cannot_create(client, db_session, organization, regular_user):
    await _member(db_session, organization, regular_user, OrgRole.member)
    r = await client.post("/api/departments", json={"name": "Чужой"}, headers=_h(regular_user))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_moves_people_to_no_department(
    client, db_session, organization, admin_user, second_user, org_owner
):
    d = await _dept(db_session, organization, "Неактуальный")
    db_session.add(DepartmentMember(department_id=d.id, user_id=second_user.id, role=DeptRole.member))
    e = Entity(
        org_id=organization.id, name="Отделов Олег", type=EntityType.candidate,
        status=EntityStatus.transferred, department_id=d.id,
        created_by=admin_user.id, created_at=datetime.utcnow(), extra_data={},
    )
    db_session.add(e)
    await db_session.commit()

    r = await client.delete(f"/api/departments/{d.id}", headers=_h(admin_user))
    assert r.status_code == 200, r.text
    assert r.json()["entities_unassigned"] == 1
    assert r.json()["members_removed"] == 1

    row = (await client.get("/api/staff-board/rows", headers=_h(admin_user))).json()
    me = next(x for x in row if x["entity_id"] == e.id)
    assert me["department_id"] is None and not me["department_name"]


@pytest.mark.asyncio
async def test_hr_can_delete(client, db_session, organization, regular_user):
    await _member(db_session, organization, regular_user, OrgRole.hr)
    d = await _dept(db_session, organization, "Временный")
    r = await client.delete(f"/api/departments/{d.id}", headers=_h(regular_user))
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_hr_can_rename(client, db_session, organization, regular_user):
    await _member(db_session, organization, regular_user, OrgRole.hr)
    d = await _dept(db_session, organization, "Старое имя")
    r = await client.patch(f"/api/departments/{d.id}", json={"name": "Фарм отдел"}, headers=_h(regular_user))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Фарм отдел"
