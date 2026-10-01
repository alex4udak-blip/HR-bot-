"""Назначения на доске «Статусы»: песочница-родитель и отделы-дочки.

Логика владельца (30.09.2026, разбор с Марией): песочница — родительский
отдел, команда (Facebook, Google…) — дочерний, а человек — ОДИН объект. Перевод
с практики в отдел — это не переезд, а ещё одна ссылка: в песочнице человек
остаётся, в отделе появляется вторая строка, но карточка кандидата одна.
Уволили в отделе — уволен и в песочнице, потому что статус живёт у человека.
"""
from datetime import date, datetime

import pytest

from api.models.database import (
    BoardPlacement, Entity, EntityStatus, EntityType, OrgMember, OrgRole,
)
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _person(db, org, creator, name="Песочный Пётр", status=EntityStatus.probation):
    e = Entity(
        org_id=org.id, name=name, type=EntityType.candidate,
        status=status, created_by=creator.id,
        created_at=datetime.utcnow(), extra_data={},
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


async def _dept(client, user, name, **extra):
    r = await client.post(
        "/api/staff-board/departments", json={"name": name, **extra}, headers=_h(user)
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _rows(client, user, eid=None):
    r = await client.get("/api/staff-board/rows", headers=_h(user))
    assert r.status_code == 200, r.text
    rows = r.json()
    return [x for x in rows if eid is None or x["entity_id"] == eid]


@pytest.mark.asyncio
async def test_transfer_to_team_keeps_person_in_sandbox(
    client, db_session, organization, admin_user, org_owner
):
    """Вышел в отдел — в песочнице остался. Две строки, одна карточка."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)

    first = await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )
    assert first.status_code == 201, first.text
    assert first.json()["department_is_sandbox"] is True

    moved = await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )
    assert moved.status_code == 201, moved.text
    assert moved.json()["parent_department_name"] == "SANDBOX"
    # Переезд в отдел = выход в отдел: дата ставится сама, от неё считаются вехи.
    assert moved.json()["department_start_date"] == date.today().isoformat()
    assert moved.json()["w2"] and moved.json()["w2_auto"] is True

    rows = await _rows(client, admin_user, e.id)
    assert [r["department_name"] for r in rows] == ["SANDBOX", "Facebook"]
    # Кандидат в базе один: дублей карточек новая логика не создаёт.
    assert len({r["entity_id"] for r in rows}) == 1
    assert len((await db_session.execute(
        Entity.__table__.select().where(Entity.org_id == organization.id)
    )).all()) == 1


@pytest.mark.asyncio
async def test_dates_belong_to_placement(
    client, db_session, organization, admin_user, org_owner
):
    """Даты и вехи — у назначения: в песочнице практика, в отделе свои вехи."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "SEO", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)
    in_sandbox = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )).json()
    in_team = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )).json()

    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"placement_id": in_sandbox["placement_id"], "practice_start_date": "2026-09-01"},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["practice_start_date"] == "2026-09-01"

    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"placement_id": in_team["placement_id"], "department_start_date": "2026-09-20",
              "m1_done": "✓"},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["department_start_date"] == "2026-09-20"
    assert r.json()["m1_done"] == "✓"

    rows = {x["department_name"]: x for x in await _rows(client, admin_user, e.id)}
    assert rows["SANDBOX"]["practice_start_date"] == "2026-09-01"
    assert rows["SANDBOX"]["m1_done"] is None
    assert rows["SEO"]["practice_start_date"] is None
    assert rows["SEO"]["department_start_date"] == "2026-09-20"


@pytest.mark.asyncio
async def test_dismissal_reaches_both_rows(
    client, db_session, organization, admin_user, org_owner
):
    """Уволили в отделе — уволен и в песочнице: статус один, у человека."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Google", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)
    for d in (sandbox, team):
        await client.post(
            "/api/staff-board/placements",
            json={"entity_id": e.id, "department_id": d["id"]}, headers=_h(admin_user),
        )

    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"status": EntityStatus.dismissed.value}, headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text

    rows = await _rows(client, admin_user, e.id)
    assert len(rows) == 2
    assert {x["status"] for x in rows} == {EntityStatus.dismissed.value}


@pytest.mark.asyncio
async def test_replace_moves_without_second_row(
    client, db_session, organization, admin_user, org_owner
):
    """Перевод между отделами (не с практики) — именно перенос строки."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    a = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    b = await _dept(client, admin_user, "TikTok", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user, status=EntityStatus.transferred)
    first = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": a["id"]}, headers=_h(admin_user),
    )).json()

    r = await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": b["id"],
              "replace_placement_id": first["placement_id"]},
        headers=_h(admin_user),
    )
    assert r.status_code == 201, r.text
    rows = await _rows(client, admin_user, e.id)
    assert [x["department_name"] for x in rows] == ["TikTok"]


@pytest.mark.asyncio
async def test_same_department_twice_is_one_placement(
    client, db_session, organization, admin_user, org_owner
):
    """Повторное «поставить в тот же отдел» не плодит строки."""
    team = await _dept(client, admin_user, "Facebook")
    e = await _person(db_session, organization, admin_user)
    one = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )).json()
    two = await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )
    assert two.status_code == 201, two.text
    assert two.json()["placement_id"] == one["placement_id"]
    assert len(await _rows(client, admin_user, e.id)) == 1


@pytest.mark.asyncio
async def test_remove_from_department(
    client, db_session, organization, admin_user, second_user, org_owner
):
    """× у отдела снимает назначение; песочницу снимает только админ."""
    db_session.add(OrgMember(
        org_id=organization.id, user_id=second_user.id, role=OrgRole.hr,
        created_at=datetime.utcnow(),
    ))
    await db_session.commit()
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)
    in_sandbox = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )).json()
    in_team = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )).json()

    r = await client.delete(
        f"/api/staff-board/placements/{in_team['placement_id']}", headers=_h(second_user)
    )
    assert r.status_code == 200, r.text
    assert [x["department_name"] for x in await _rows(client, admin_user, e.id)] == ["SANDBOX"]

    nope = await client.delete(
        f"/api/staff-board/placements/{in_sandbox['placement_id']}", headers=_h(second_user)
    )
    assert nope.status_code == 403

    ok = await client.delete(
        f"/api/staff-board/placements/{in_sandbox['placement_id']}", headers=_h(admin_user)
    )
    assert ok.status_code == 200, ok.text
    # Без отделов человек не исчезает: строка остаётся, отдел пустой.
    rows = await _rows(client, admin_user, e.id)
    assert len(rows) == 1 and rows[0]["department_id"] is None


@pytest.mark.asyncio
async def test_child_parent_must_be_sandbox(client, db_session, organization, admin_user, org_owner):
    """Родителем бывает только песочница, а песочница сама ни в кого не вложена."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    assert team["parent_id"] == sandbox["id"]

    bad = await client.post(
        "/api/staff-board/departments",
        json={"name": "Вложенный", "kind": "team", "parent_id": team["id"]},
        headers=_h(admin_user),
    )
    assert bad.status_code == 400

    nested = await _dept(
        client, admin_user, "SANDBOX MOBILE", kind="sandbox", parent_id=sandbox["id"]
    )
    assert nested["parent_id"] is None


@pytest.mark.asyncio
async def test_custom_visibility_hides_department_from_hr(
    client, db_session, organization, admin_user, second_user, org_owner
):
    """Юнит «не для всех»: рекрутёр его не видит ни в списке, ни в строке."""
    db_session.add(OrgMember(
        org_id=organization.id, user_id=second_user.id, role=OrgRole.hr,
        created_at=datetime.utcnow(),
    ))
    await db_session.commit()
    open_dept = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    secret = await _dept(
        client, admin_user, "Юнит Марии", visibility="custom", visible_to=[admin_user.id]
    )
    e = await _person(db_session, organization, admin_user)
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": secret["id"]}, headers=_h(admin_user),
    )

    mine = (await client.get("/api/staff-board/departments", headers=_h(admin_user))).json()
    assert {d["name"] for d in mine} == {"SANDBOX", "Юнит Марии"}
    theirs = (await client.get("/api/staff-board/departments", headers=_h(second_user))).json()
    assert [d["name"] for d in theirs] == ["SANDBOX"]

    # Человек с доски не исчезает — просто без отдела.
    rows = await _rows(client, second_user, e.id)
    assert len(rows) == 1 and rows[0]["department_id"] is None
    assert (await _rows(client, admin_user, e.id))[0]["department_name"] == "Юнит Марии"


@pytest.mark.asyncio
async def test_legacy_department_migrates_to_placement(
    client, db_session, organization, admin_user, org_owner
):
    """Отдел из карточки переезжает в назначение вместе с датами — один раз."""
    from api.services.board_placements import migrate_board_departments_once

    dept = await _dept(client, admin_user, "Старый отдел")
    e = await _person(db_session, organization, admin_user, status=EntityStatus.transferred)
    e.extra_data = {
        "board_department_id": dept["id"],
        "department_transfer_date": "2026-05-01",
        "m1_done": "✓",
        "manager_name": "Влад",
    }
    await db_session.commit()

    assert await migrate_board_departments_once(db_session) == 1
    # второй старт ничего не делает
    assert await migrate_board_departments_once(db_session) == 0

    pl = (await db_session.execute(
        BoardPlacement.__table__.select().where(BoardPlacement.entity_id == e.id)
    )).all()
    assert len(pl) == 1

    row = (await _rows(client, admin_user, e.id))[0]
    assert row["department_name"] == "Старый отдел"
    assert row["department_start_date"] == "2026-05-01"
    assert row["m1_done"] == "✓"
    # Поле человека осталось у человека, а не уехало в назначение.
    assert row["manager"] == "Влад"


@pytest.mark.asyncio
async def test_sandbox_role_set_by_name(client, db_session, organization, admin_user, org_owner):
    """Песочницы на проде уже заведены обычными отделами — роль им ставим по
    названию, чтобы HR не выбирал её руками у трёх отделов."""
    from api.models.database import BoardDepartment
    from api.services.board_placements import migrate_board_departments_once

    sand = await _dept(client, admin_user, "SANDBOX MOBILE")
    team = await _dept(client, admin_user, "Facebook")
    assert sand["kind"] == "team"  # заведён как обычный отдел

    await migrate_board_departments_once(db_session)

    assert (await db_session.get(BoardDepartment, sand["id"])).kind == "sandbox"
    assert (await db_session.get(BoardDepartment, team["id"])).kind == "team"


@pytest.mark.asyncio
async def test_practice_places_into_vacancy_sandbox(
    client, db_session, organization, admin_user, org_owner
):
    """Вышел на практику — попал в песочницу, выбранную у вакансии."""
    from api.models.database import Vacancy, VacancyStatus
    from api.services.board_placements import SANDBOX_KEY, ensure_sandbox_placement

    sandbox = await _dept(client, admin_user, "SANDBOX R&D", kind="sandbox")
    vac = Vacancy(
        org_id=organization.id, title="Трафик", status=VacancyStatus.open,
        created_by=admin_user.id, created_at=datetime.utcnow(),
        extra_data={SANDBOX_KEY: sandbox["id"]},
    )
    db_session.add(vac)
    e = await _person(db_session, organization, admin_user)
    await db_session.commit()
    await db_session.refresh(vac)

    assert await ensure_sandbox_placement(db_session, e.id, vac) is True
    await db_session.commit()
    assert (await _rows(client, admin_user, e.id))[0]["department_name"] == "SANDBOX R&D"

    # Повторно не переставляем: отдел у человека уже есть, доска — не место
    # для самовольных переездов.
    assert await ensure_sandbox_placement(db_session, e.id, vac) is False


@pytest.mark.asyncio
async def test_practice_without_sandbox_stays_unassigned(
    client, db_session, organization, admin_user, org_owner
):
    """Песочница у вакансии не выбрана — человек ждёт в «Без отдела»."""
    from api.models.database import Vacancy, VacancyStatus
    from api.services.board_placements import ensure_sandbox_placement

    vac = Vacancy(
        org_id=organization.id, title="Без песочницы", status=VacancyStatus.open,
        created_by=admin_user.id, created_at=datetime.utcnow(), extra_data={},
    )
    db_session.add(vac)
    e = await _person(db_session, organization, admin_user)
    await db_session.commit()
    await db_session.refresh(vac)

    assert await ensure_sandbox_placement(db_session, e.id, vac) is False
    row = (await _rows(client, admin_user, e.id))[0]
    assert row["department_id"] is None and row["placement_id"] is None
