"""«Статусы»: «Рук-ль» ставится сам — руководители отдела (решение 22.09.2026).

В оргструктуре у отдела есть руководители (роль lead). Поставили человека в
отдел — руководитель известен, вбивать его руками не нужно. Вписанное руками
не трогаем; подставленное автоматически при смене отдела меняется.
"""
from datetime import datetime

import pytest

from api.models.database import (
    Department, DepartmentMember, DeptRole, Entity, EntityStatus, EntityType,
)
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _dept(db, org, name, leads=()):
    d = Department(org_id=org.id, name=name, is_active=True)
    db.add(d)
    await db.commit()
    await db.refresh(d)
    for u in leads:
        db.add(DepartmentMember(department_id=d.id, user_id=u.id, role=DeptRole.lead))
    await db.commit()
    return d


async def _person(db, org, creator, extra=None):
    e = Entity(
        org_id=org.id, name="Отделов Олег", type=EntityType.candidate,
        status=EntityStatus.transferred, created_by=creator.id,
        created_at=datetime.utcnow(), extra_data=extra or {},
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


async def _patch(client, user, eid, body):
    r = await client.patch(f"/api/staff-board/rows/{eid}", json=body, headers=_h(user))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_manager_from_dept_leads(client, db_session, organization, admin_user, second_user, org_owner):
    d = await _dept(db_session, organization, "RND", leads=[second_user])
    e = await _person(db_session, organization, admin_user)
    row = await _patch(client, admin_user, e.id, {"department_id": d.id})
    assert row["manager"] == second_user.name


@pytest.mark.asyncio
async def test_auto_manager_follows_department(client, db_session, organization, admin_user, second_user, org_owner):
    a = await _dept(db_session, organization, "A", leads=[admin_user])
    b = await _dept(db_session, organization, "B", leads=[second_user])
    empty = await _dept(db_session, organization, "Без рук-ля")
    e = await _person(db_session, organization, admin_user)
    await _patch(client, admin_user, e.id, {"department_id": a.id})
    row = await _patch(client, admin_user, e.id, {"department_id": b.id})
    assert row["manager"] == second_user.name
    # в новом отделе руководителя нет — подставленный старый не висит
    row = await _patch(client, admin_user, e.id, {"department_id": empty.id})
    assert not row["manager"]


@pytest.mark.asyncio
async def test_manual_manager_kept(client, db_session, organization, admin_user, second_user, org_owner):
    a = await _dept(db_session, organization, "A", leads=[admin_user])
    b = await _dept(db_session, organization, "B", leads=[second_user])
    e = await _person(db_session, organization, admin_user)
    await _patch(client, admin_user, e.id, {"department_id": a.id})
    await _patch(client, admin_user, e.id, {"manager": "Пётр Петров"})
    row = await _patch(client, admin_user, e.id, {"department_id": b.id})
    assert row["manager"] == "Пётр Петров"


@pytest.mark.asyncio
async def test_clickup_manager_kept(client, db_session, organization, admin_user, org_owner):
    """Рук-ль, перенесённый из ClickUp, — тоже ручной: не перетираем."""
    a = await _dept(db_session, organization, "A", leads=[admin_user])
    e = await _person(db_session, organization, admin_user, {"cf:Рук-ль": "Из КликАпа"})
    row = await _patch(client, admin_user, e.id, {"department_id": a.id})
    assert row["manager"] == "Из КликАпа"


@pytest.mark.asyncio
async def test_owner_lead_skipped(client, db_session, organization, admin_user, second_user, org_owner):
    """HR: Мария (admin) и Анастасия (owner) — руководитель по факту Мария."""
    # admin_user — владелец организации (org_owner), second_user — нет
    d = await _dept(db_session, organization, "HR", leads=[admin_user, second_user])
    e = await _person(db_session, organization, admin_user)
    row = await _patch(client, admin_user, e.id, {"department_id": d.id})
    assert row["manager"] == second_user.name


@pytest.mark.asyncio
async def test_only_owner_lead_used(client, db_session, organization, admin_user, org_owner):
    """Если руководит только владелец — ставим его, а не пусто."""
    d = await _dept(db_session, organization, "Solo", leads=[admin_user])
    e = await _person(db_session, organization, admin_user)
    row = await _patch(client, admin_user, e.id, {"department_id": d.id})
    assert row["manager"] == admin_user.name
