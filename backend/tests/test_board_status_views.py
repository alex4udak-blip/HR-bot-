"""Конструктор секций доски «Статусы»: у каждого свой набор и для каждого отдела.

Мит 07.10.2026: «разные лист-вью под каждого пользователя и под каждый отдел —
например, у Маши в отделе SANDBOX видны „Перевёлся“ и „Практика“, а у Насти
только „Уволился“: они сами выбрали эти статусы».
"""
from datetime import datetime

import pytest

from api.models.database import OrgMember, OrgRole
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _hr(db, org, user):
    db.add(OrgMember(org_id=org.id, user_id=user.id, role=OrgRole.hr,
                     created_at=datetime.utcnow()))
    await db.commit()


async def _views(client, user):
    r = await client.get("/api/staff-board/status-views", headers=_h(user))
    assert r.status_code == 200, r.text
    return {v["scope_key"]: v["statuses"] for v in r.json()}


@pytest.mark.asyncio
async def test_views_are_personal_and_per_tab(
    client, db_session, organization, admin_user, second_user, org_owner
):
    """У каждого свой набор, и на каждой вкладке свой."""
    await _hr(db_session, organization, second_user)
    dept = (await client.post(
        "/api/staff-board/departments", json={"name": "SANDBOX", "kind": "sandbox"},
        headers=_h(admin_user),
    )).json()
    scope = str(dept["id"])

    r = await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": scope, "statuses": ["transferred", "probation"]},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert await _views(client, admin_user) == {scope: ["transferred", "probation"]}

    # У второго человека — свой набор на той же вкладке.
    await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": scope, "statuses": ["dismissed"]}, headers=_h(second_user),
    )
    assert await _views(client, second_user) == {scope: ["dismissed"]}
    assert await _views(client, admin_user) == {scope: ["transferred", "probation"]}

    # Другая вкладка настраивается отдельно и первую не трогает.
    await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": "all", "statuses": ["hired"]}, headers=_h(admin_user),
    )
    assert await _views(client, admin_user) == {
        scope: ["transferred", "probation"], "all": ["hired"],
    }


@pytest.mark.asyncio
async def test_empty_or_full_selection_resets_to_all(
    client, db_session, organization, admin_user, org_owner
):
    """Пусто и «отмечено всё» одинаково значат «показывать все секции».

    Иначе набор молча скрыл бы секцию, которая появится позже.
    """
    await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": "all", "statuses": ["hired"]}, headers=_h(admin_user),
    )
    assert "all" in await _views(client, admin_user)

    await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": "all", "statuses": []}, headers=_h(admin_user),
    )
    assert await _views(client, admin_user) == {}

    await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": "all",
              "statuses": ["transferred", "dismissed", "probation", "hired"]},
        headers=_h(admin_user),
    )
    assert await _views(client, admin_user) == {}


@pytest.mark.asyncio
async def test_unknown_sections_are_dropped(
    client, db_session, organization, admin_user, org_owner
):
    """Чужие ключи в набор не попадают — на доске таких секций нет."""
    r = await client.put(
        "/api/staff-board/status-views",
        json={"scope_key": "all", "statuses": ["probation", "rejected", "мусор"]},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert await _views(client, admin_user) == {"all": ["probation"]}
