import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.models.database import (
    Entity, EntityType, EntityStatus, Employee, User, OrgMember,
)
from api.services.auth import create_access_token


def _headers(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


async def _make_candidate(db, org, status=EntityStatus.hired, **kw) -> Entity:
    ent = Entity(
        org_id=org.id, type=EntityType.candidate, name="Пётр Кандидатов",
        status=status, email=None, phone="+375291112233",
        telegram_usernames=["petr_cand"], **kw,
    )
    db.add(ent)
    await db.commit()
    await db.refresh(ent)
    return ent


@pytest.mark.asyncio
async def test_hire_creates_user_employee_and_moves_to_transferred(
    client: AsyncClient, db_session, organization, admin_user, org_owner
):
    ent = await _make_candidate(db_session, organization, status=EntityStatus.hired)

    resp = await client.post(
        f"/api/entities/{ent.id}/hire",
        json={"department_id": None, "email": "petr@staff.com", "position": "Маркетолог"},
        headers=_headers(admin_user),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_existed"] is False
    assert body["temporary_password"]
    assert body["employee_id"]

    emp = (await db_session.execute(
        select(Employee).where(Employee.id == body["employee_id"])
    )).scalar_one()
    assert emp.entity_id == ent.id
    assert emp.position == "Маркетолог"

    new_user = (await db_session.execute(
        select(User).where(User.email == "petr@staff.com")
    )).scalar_one()
    assert emp.user_id == new_user.id
    assert (await db_session.execute(
        select(OrgMember).where(OrgMember.user_id == new_user.id, OrgMember.org_id == organization.id)
    )).scalar_one_or_none() is not None

    await db_session.refresh(ent)
    assert ent.status == EntityStatus.transferred


@pytest.mark.asyncio
async def test_hire_rejects_wrong_stage(
    client: AsyncClient, db_session, organization, admin_user, org_owner
):
    ent = await _make_candidate(db_session, organization, status=EntityStatus.screening)
    resp = await client.post(
        f"/api/entities/{ent.id}/hire",
        json={"department_id": None, "email": "x@staff.com"},
        headers=_headers(admin_user),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_hire_duplicate_returns_409(
    client: AsyncClient, db_session, organization, admin_user, org_owner
):
    ent = await _make_candidate(db_session, organization, status=EntityStatus.probation)
    payload = {"department_id": None, "email": "dup@staff.com"}
    r1 = await client.post(f"/api/entities/{ent.id}/hire", json=payload, headers=_headers(admin_user))
    assert r1.status_code == 200
    ent2 = await _make_candidate(db_session, organization, status=EntityStatus.hired)
    r2 = await client.post(f"/api/entities/{ent2.id}/hire", json=payload, headers=_headers(admin_user))
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_rehire_after_dismiss_reactivates(
    client: AsyncClient, db_session, organization, admin_user, org_owner
):
    from datetime import datetime

    ent = await _make_candidate(db_session, organization, status=EntityStatus.hired)
    payload = {"department_id": None, "email": "rehire@staff.com", "position": "Разработчик"}
    r1 = await client.post(f"/api/entities/{ent.id}/hire", json=payload, headers=_headers(admin_user))
    assert r1.status_code == 200, r1.text
    emp_id = r1.json()["employee_id"]

    # Увольнение = soft-delete (как dismiss_employee)
    emp = (await db_session.execute(select(Employee).where(Employee.id == emp_id))).scalar_one()
    emp.is_active = False
    emp.dismissed_at = datetime.utcnow()
    await db_session.commit()

    # Повторный приём того же человека (тот же email) — реактивация, НЕ 409 и не дубль
    ent2 = await _make_candidate(db_session, organization, status=EntityStatus.hired)
    r2 = await client.post(f"/api/entities/{ent2.id}/hire", json=payload, headers=_headers(admin_user))
    assert r2.status_code == 200, r2.text
    assert r2.json()["employee_id"] == emp_id  # та же запись Employee

    await db_session.refresh(emp)
    assert emp.is_active is True
    assert emp.dismissed_at is None
