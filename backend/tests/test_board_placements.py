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
    # Дата практики одна на человека и видна в обеих строках (07.10.2026), а
    # вот выход в отдел и отметки вех — у каждого назначения свои.
    assert rows["SEO"]["practice_start_date"] == "2026-09-01"
    assert rows["SEO"]["department_start_date"] == "2026-09-20"
    assert rows["SANDBOX"]["department_start_date"] is None
    assert rows["SEO"]["m1_done"] == "✓"


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


@pytest.mark.asyncio
async def test_default_sandbox_used_when_vacancy_has_none(
    client, db_session, organization, admin_user, org_owner
):
    """Песочницы у воронки нет — берём песочницу организации «по умолчанию».

    Поле у воронки появилось 30.09.2026 и у всех пустое: без запасного варианта
    отдел не проставлялся вообще (владелец, 01.10.2026).
    """
    from api.models.database import Vacancy, VacancyStatus
    from api.services.board_placements import ensure_sandbox_placement

    main = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    await _dept(client, admin_user, "SANDBOX MOBILE", kind="sandbox")  # их несколько
    r = await client.patch(
        f"/api/staff-board/departments/{main['id']}", json={"is_default": True},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_default"] is True

    vac = Vacancy(
        org_id=organization.id, title="Трафик", status=VacancyStatus.open,
        created_by=admin_user.id, created_at=datetime.utcnow(), extra_data={},
    )
    db_session.add(vac)
    e = await _person(db_session, organization, admin_user)
    await db_session.commit()
    await db_session.refresh(vac)

    assert await ensure_sandbox_placement(db_session, e.id, vac, org_id=organization.id) is True
    await db_session.commit()
    assert (await _rows(client, admin_user, e.id))[0]["department_name"] == "SANDBOX"

    # Флаг один на организацию: он виден в списке ровно у одной песочницы.
    listed = (await client.get("/api/staff-board/departments", headers=_h(admin_user))).json()
    assert [d["name"] for d in listed if d["is_default"]] == ["SANDBOX"]


@pytest.mark.asyncio
async def test_single_sandbox_is_used_without_any_setting(
    client, db_session, organization, admin_user, org_owner
):
    """Песочница в организации одна — выбирать не из чего, ставим в неё."""
    from api.services.board_placements import ensure_sandbox_placement

    await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    e = await _person(db_session, organization, admin_user)

    assert await ensure_sandbox_placement(db_session, e.id, None, org_id=organization.id) is True
    await db_session.commit()
    assert (await _rows(client, admin_user, e.id))[0]["department_name"] == "SANDBOX"


@pytest.mark.asyncio
async def test_many_sandboxes_without_default_leave_unassigned(
    client, db_session, organization, admin_user, org_owner
):
    """Песочниц несколько и по умолчанию не выбрана — угадывать не будем."""
    from api.services.board_placements import ensure_sandbox_placement

    await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    await _dept(client, admin_user, "SANDBOX R&D", kind="sandbox")
    e = await _person(db_session, organization, admin_user)

    assert await ensure_sandbox_placement(db_session, e.id, None, org_id=organization.id) is False
    assert (await _rows(client, admin_user, e.id))[0]["department_id"] is None


@pytest.mark.asyncio
async def test_status_change_from_card_places_into_sandbox(
    client, db_session, organization, admin_user, org_owner
):
    """Перевод в «Практику» из карточки тоже ставит в песочницу."""
    await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    e = await _person(db_session, organization, admin_user, status=EntityStatus.hired)

    r = await client.patch(
        f"/api/entities/{e.id}/status",
        json={"status": EntityStatus.probation.value}, headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    row = (await _rows(client, admin_user, e.id))[0]
    assert row["department_name"] == "SANDBOX"


@pytest.mark.asyncio
async def test_marking_default_places_current_practice(
    client, db_session, organization, admin_user, org_owner
):
    """Назвали песочницу «по умолчанию» — те, кто уже на практике, встают в неё.

    До этого отдел проставлялся только новым: вышедшие на практику раньше
    оставались пустыми, и доска показывала «Практика» без отдела (владелец,
    01.10.2026).
    """
    sand = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sand["id"])
    old_hand = await _person(db_session, organization, admin_user, name="Старый Практикант")
    in_team = await _person(db_session, organization, admin_user, name="Уже В Отделе")
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": in_team.id, "department_id": team["id"]}, headers=_h(admin_user),
    )

    r = await client.patch(
        f"/api/staff-board/departments/{sand['id']}", json={"is_default": True},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["placed_now"] == 1   # только тот, кто был без отдела

    assert (await _rows(client, admin_user, old_hand.id))[0]["department_name"] == "SANDBOX"
    # Стоявшего в команде не трогаем: доска — не место для самовольных переездов.
    assert [x["department_name"] for x in await _rows(client, admin_user, in_team.id)] == ["Facebook"]


@pytest.mark.asyncio
async def test_board_shows_only_own_people(
    client, db_session, organization, admin_user, org_owner
):
    """Доска — про своих: практика, штат и уход из него, и ничего больше.

    Владелец (06.10.2026): «нам нужны только те, кто на практике, кто принял
    оффер, кто перешёл в штат и кого уволили или он ушёл после этого». Отказ,
    резерв, ранний этап и высланный оффер — работа воронки, на доске их нет,
    даже если человека когда-то поставили в отдел. Назначение при этом живёт:
    вернулся в практику — появился со своим отделом.
    """
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    e = await _person(db_session, organization, admin_user)
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )

    for status in (EntityStatus.reserve, EntityStatus.screening, EntityStatus.offer):
        e.status = status
        await db_session.commit()
        assert await _rows(client, admin_user, e.id) == [], f"лишняя строка: {status.value}"

    # Отказ и «отозван» у того, кто УЖЕ был в отделе, — это уход: строка
    # остаётся и попадает в «Уволен / Уволился».
    for status in (EntityStatus.rejected, EntityStatus.withdrawn):
        e.status = status
        await db_session.commit()
        rows = await _rows(client, admin_user, e.id)
        assert len(rows) == 1, f"пропал со статусом {status.value}"
        assert rows[0]["department_name"] == "SANDBOX"

    for status in (EntityStatus.hired, EntityStatus.probation,
                   EntityStatus.transferred, EntityStatus.dismissed, EntityStatus.quit):
        e.status = status
        await db_session.commit()
        rows = await _rows(client, admin_user, e.id)
        assert len(rows) == 1, f"пропал со статусом {status.value}"
        # Отдел не теряется, пока человек гулял по этапам воронки.
        assert rows[0]["department_name"] == "SANDBOX"


@pytest.mark.asyncio
async def test_departed_without_department_not_on_board(
    client, db_session, organization, admin_user, org_owner
):
    """Отказ у кандидата БЕЗ отдела — работа воронки, доске он не нужен."""
    e = await _person(db_session, organization, admin_user)
    e.status = EntityStatus.withdrawn
    await db_session.commit()
    assert await _rows(client, admin_user, e.id) == []


@pytest.mark.asyncio
async def test_status_change_from_board_writes_timeline_note(
    client, db_session, organization, admin_user, org_owner
):
    """Перевод с доски виден в ленте карточки.

    Владелец (06.10.2026): «нету логов, что он перешёл в отдел — я поменял
    статус через страницу Статусы». Лента кандидата показывает переводы
    записями в extra_data.notes (их же пишет «Все кандидаты»), и доска теперь
    добавляет такую же: статус, откуда перевели и кто.
    """
    e = await _person(db_session, organization, admin_user)

    r = await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"status": EntityStatus.transferred.value}, headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text

    await db_session.refresh(e)
    notes = (e.extra_data or {}).get("notes") or []
    assert len(notes) == 1, notes
    note = notes[0]
    assert note["stage"] == EntityStatus.transferred.value
    assert note["stage_label"] == "Перешёл в отдел"
    assert note["from_status"] == EntityStatus.probation.value
    assert note["author_id"] == admin_user.id
    assert note["text"] == ""

    # Повторный PATCH тем же статусом строк в ленту не плодит.
    await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"status": EntityStatus.transferred.value}, headers=_h(admin_user),
    )
    await db_session.refresh(e)
    assert len((e.extra_data or {}).get("notes") or []) == 1


@pytest.mark.asyncio
async def test_move_between_sandboxes(
    client, db_session, organization, admin_user, org_owner
):
    """Песочница у человека ОДНА: выбрал другую — переехал, а не раздвоился.

    Владелец (06.10.2026): «нельзя выбрать другой сендбокс, если человек уже в
    сендбоксе — это неверно».
    """
    first = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    second = await _dept(client, admin_user, "SANDBOX MOBILE", kind="sandbox")
    e = await _person(db_session, organization, admin_user)
    start = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": first["id"]}, headers=_h(admin_user),
    )).json()

    r = await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": second["id"],
              "replace_placement_id": start["placement_id"]},
        headers=_h(admin_user),
    )
    assert r.status_code == 201, r.text
    assert [x["department_name"] for x in await _rows(client, admin_user, e.id)] == ["SANDBOX MOBILE"]


@pytest.mark.asyncio
async def test_move_onto_existing_placement_just_drops_the_old_row(
    client, db_session, organization, admin_user, org_owner
):
    """Переносим туда, где человек уже стоит, — остаётся одна строка, не ошибка."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)
    in_sandbox = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )).json()
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )

    # «Перевести из песочницы в Facebook», где он уже есть: песочница снимается.
    r = await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"],
              "replace_placement_id": in_sandbox["placement_id"]},
        headers=_h(admin_user),
    )
    assert r.status_code == 201, r.text
    assert [x["department_name"] for x in await _rows(client, admin_user, e.id)] == ["Facebook"]


@pytest.mark.asyncio
async def test_team_choice_moves_instead_of_piling_up(
    client, db_session, organization, admin_user, org_owner
):
    """Рабочий отдел у человека ОДИН: выбрал другой — переехал, а не добавился.

    На проде у тестовой карточки накопилось четыре строки разом (SANDBOX, ASA,
    Facebook, iOS Product) — каждый выбор отдела из строки песочницы добавлял
    ещё одну (Мария, 07.10.2026: «он не должен быть в сэндбоксе, он должен быть
    в отделе»). Песочница при этом остаётся: это и есть «ещё из SANDBOX».
    """
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    fb = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    seo = await _dept(client, admin_user, "SEO", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )

    # Первый выход в отдел — добавление: практика остаётся.
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": fb["id"]}, headers=_h(admin_user),
    )
    assert [r["department_name"] for r in await _rows(client, admin_user, e.id)] == ["SANDBOX", "Facebook"]

    # Второй — переезд между отделами, а не третья строка.
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": seo["id"]}, headers=_h(admin_user),
    )
    rows = await _rows(client, admin_user, e.id)
    assert [r["department_name"] for r in rows] == ["SANDBOX", "SEO"]


@pytest.mark.asyncio
async def test_practice_date_visible_in_department_row(
    client, db_session, organization, admin_user, org_owner
):
    """Жизненный цикл не обрывается: дата практики видна и в строке отдела.

    Даты принадлежат назначению, практика лежит у песочницы — поэтому в строке
    отдела колонка «Выход на практику» была пустой: «был весь жизненный цикл
    практика, а теперь нет» (Мария, 07.10.2026).
    """
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    team = await _dept(client, admin_user, "Facebook", kind="team", parent_id=sandbox["id"])
    e = await _person(db_session, organization, admin_user)
    in_sandbox = (await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )).json()
    await client.patch(
        f"/api/staff-board/rows/{e.id}",
        json={"placement_id": in_sandbox["placement_id"], "practice_start_date": "2026-09-01"},
        headers=_h(admin_user),
    )
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": team["id"]}, headers=_h(admin_user),
    )

    rows = {r["department_name"]: r for r in await _rows(client, admin_user, e.id)}
    assert rows["SANDBOX"]["practice_start_date"] == "2026-09-01"
    assert rows["Facebook"]["practice_start_date"] == "2026-09-01"   # подтянулась
    # В строке отдела видно, из какой он песочницы…
    assert rows["Facebook"]["sandbox_name"] == "SANDBOX"
    assert rows["Facebook"]["team_name"] is None
    # …а в строке песочницы главным показывается РАБОЧИЙ отдел: «нужно видеть
    # отделы везде, даже на сендбоксе» (Мария, 07.10.2026).
    assert rows["SANDBOX"]["team_name"] == "Facebook"
    assert rows["SANDBOX"]["sandbox_name"] is None
    # Своя дата отдела в песочницу не протекает.
    assert rows["Facebook"]["department_start_date"] == date.today().isoformat()
    assert rows["SANDBOX"]["department_start_date"] is None


@pytest.mark.asyncio
async def test_admins_only_department(
    client, db_session, organization, admin_user, second_user, org_owner
):
    """«Только администраторам»: рекрутёр отдела не видит, админ видит.

    Мария (07.10.2026): «не будет всего этого списка, а будет либо всем, либо
    только вам» — выбирать конкретных людей больше не нужно.
    """
    db_session.add(OrgMember(
        org_id=organization.id, user_id=second_user.id, role=OrgRole.hr,
        created_at=datetime.utcnow(),
    ))
    await db_session.commit()
    open_dept = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    secret = await _dept(client, admin_user, "Юнит Насти", visibility="admins")
    assert secret["visibility"] == "admins"
    assert secret["visible_to"] == []

    mine = (await client.get("/api/staff-board/departments", headers=_h(admin_user))).json()
    assert {d["name"] for d in mine} == {"SANDBOX", "Юнит Насти"}
    theirs = (await client.get("/api/staff-board/departments", headers=_h(second_user))).json()
    assert [d["name"] for d in theirs] == ["SANDBOX"]

    # Человек из закрытого отдела у рекрутёра показывается без отдела, а не пропадает.
    e = await _person(db_session, organization, admin_user)
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": secret["id"]}, headers=_h(admin_user),
    )
    rows = await _rows(client, second_user, e.id)
    assert len(rows) == 1 and rows[0]["department_id"] is None
    assert (await _rows(client, admin_user, e.id))[0]["department_name"] == "Юнит Насти"


@pytest.mark.asyncio
async def test_sandbox_row_without_department_keeps_itself(
    client, db_session, organization, admin_user, org_owner
):
    """Отдела ещё нет — в строке песочницы остаётся сама песочница."""
    sandbox = await _dept(client, admin_user, "SANDBOX", kind="sandbox")
    e = await _person(db_session, organization, admin_user)
    await client.post(
        "/api/staff-board/placements",
        json={"entity_id": e.id, "department_id": sandbox["id"]}, headers=_h(admin_user),
    )
    row = (await _rows(client, admin_user, e.id))[0]
    assert row["department_name"] == "SANDBOX"
    assert row["team_name"] is None
