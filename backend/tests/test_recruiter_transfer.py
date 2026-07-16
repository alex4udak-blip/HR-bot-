"""Тесты «Передать всё от X к Y» (POST /api/users/reassign-ownership).

Уходящий рекрутёр X → живой рекрутёр Y: заявки, вакансии, кандидаты и участие в
воронках меняют владельца, HR-метки пересчитываются. Строго в рамках орга.
"""
from datetime import datetime

import pytest
from sqlalchemy import select

from api.models.database import (
    Entity, EntityType, EntityStatus, Vacancy, VacancyStatus,
    VacancyApplication, ApplicationStage, User, OrgMember, OrgRole,
)
from api.services.hr_tags import sync_for_entity, EXTRA_KEY


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _member(db, org_id, name, email, role=OrgRole.member) -> User:
    u = User(email=email, password_hash="x", name=name)
    db.add(u)
    await db.flush()
    db.add(OrgMember(org_id=org_id, user_id=u.id, role=role, created_at=datetime.utcnow()))
    await db.flush()
    return u


async def _vac(db, org_id, creator_id, title, **extra) -> Vacancy:
    v = Vacancy(
        org_id=org_id, created_by=creator_id, title=title,
        status=VacancyStatus.open, salary_currency="RUB", priority=1, tags=[],
        created_at=datetime.utcnow(), updated_at=datetime.utcnow(), **extra,
    )
    db.add(v)
    await db.flush()
    return v


async def _cand(db, org_id, creator_id, name) -> Entity:
    e = Entity(
        org_id=org_id, created_by=creator_id, name=name,
        type=EntityType.candidate, status=EntityStatus.active, created_at=datetime.utcnow(),
    )
    db.add(e)
    await db.flush()
    return e


async def _app(db, vac_id, entity_id, creator_id) -> VacancyApplication:
    a = VacancyApplication(
        vacancy_id=vac_id, entity_id=entity_id, stage=ApplicationStage.interview,
        stage_order=1000, created_by=creator_id, applied_at=datetime.utcnow(),
        last_stage_change_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    )
    db.add(a)
    await db.flush()
    return a


@pytest.mark.asyncio
async def test_handover_summary_and_split(
    client, db_session, organization, admin_user, org_owner, admin_token,
):
    """Раздельная передача: воронку V1 → Y1, воронку V2 → Y2, пул → Y1."""
    org = organization.id
    x = await _member(db_session, org, "Уходящий", "sx@t.co", OrgRole.hr)
    y1 = await _member(db_session, org, "Приёмник 1", "sy1@t.co", OrgRole.hr)
    y2 = await _member(db_session, org, "Приёмник 2", "sy2@t.co", OrgRole.hr)

    v1 = await _vac(db_session, org, x.id, "Воронка 1", assigned_to=[x.id])
    c1 = await _cand(db_session, org, x.id, "Кандидат В1")
    await _app(db_session, v1.id, c1.id, x.id)
    v2 = await _vac(db_session, org, x.id, "Воронка 2", assigned_to=[x.id])
    c2 = await _cand(db_session, org, x.id, "Кандидат В2")
    await _app(db_session, v2.id, c2.id, x.id)
    # Кандидат вне воронок (без заявки).
    c_pool = await _cand(db_session, org, x.id, "Кандидат Пул")
    v1_id, v2_id, c1_id, c2_id, cpool_id = v1.id, v2.id, c1.id, c2.id, c_pool.id
    xid, y1id, y2id = x.id, y1.id, y2.id
    await db_session.commit()

    # Сводка: 2 воронки (по 1 кандидату) + 1 вне воронок.
    r = await client.get(f"/api/users/{xid}/handover-summary", headers=_h(admin_token))
    assert r.status_code == 200, r.text
    summ = r.json()
    assert summ["pool_candidates"] == 1, summ
    by_vid = {f["vacancy_id"]: f for f in summ["funnels"]}
    assert by_vid[v1_id]["candidates"] == 1 and by_vid[v2_id]["candidates"] == 1, summ

    # Раздельная передача.
    r = await client.post(
        "/api/users/reassign-split",
        json={
            "from_user_id": xid,
            "assignments": [
                {"vacancy_id": v1_id, "to_user_id": y1id},
                {"vacancy_id": v2_id, "to_user_id": y2id},
            ],
            "pool_to_user_id": y1id,
        },
        headers=_h(admin_token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["vacancies"] == 2 and body["applications"] == 2, body

    for cid, expect in ((c1_id, y1id), (c2_id, y2id), (cpool_id, y1id)):
        e = await db_session.get(Entity, cid)
        await db_session.refresh(e)
        assert e.created_by == expect, (cid, e.created_by, expect)
    vv1 = await db_session.get(Vacancy, v1_id)
    vv2 = await db_session.get(Vacancy, v2_id)
    assert vv1.created_by == y1id and vv2.created_by == y2id
    # Получатель стал ведущим (accepted_by) — иначе воронка «повиснет» в сайдбаре.
    assert y1id in ((vv1.extra_data or {}).get("accepted_by") or []) and xid not in (vv1.assigned_to or [])
    assert y2id in ((vv2.extra_data or {}).get("accepted_by") or [])


@pytest.mark.asyncio
async def test_split_rejects_cross_org_recipient(
    client, db_session, organization, second_organization, admin_user, org_owner, admin_token,
):
    x = await _member(db_session, organization.id, "X", "sx2@t.co", OrgRole.hr)
    v = await _vac(db_session, organization.id, x.id, "V", assigned_to=[x.id])
    y_other = await _member(db_session, second_organization.id, "Чужой", "so@t.co", OrgRole.hr)
    vid, xid, yo = v.id, x.id, y_other.id
    await db_session.commit()

    r = await client.post(
        "/api/users/reassign-split",
        json={"from_user_id": xid, "assignments": [{"vacancy_id": vid, "to_user_id": yo}]},
        headers=_h(admin_token),
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_reassign_moves_ownership_and_hr_tags(
    client, db_session, organization, admin_user, org_owner, admin_token,
):
    org = organization.id
    x = await _member(db_session, org, "Уходящий X", "x@t.co")
    y = await _member(db_session, org, "Живой Y", "y@t.co")

    # Воронку вёл только X: своя вакансия + свой кандидат + своя заявка.
    v_solo = await _vac(db_session, org, x.id, "Solo X")
    c1 = await _cand(db_session, org, x.id, "Кандидат Один")
    a1 = await _app(db_session, v_solo.id, c1.id, x.id)

    # Общая воронка Y, куда X добавил кандидата (заявка X, ведущий — Y).
    v_shared = await _vac(db_session, org, y.id, "Shared Y", assigned_to=[x.id, y.id])
    c2 = await _cand(db_session, org, x.id, "Кандидат Два")
    a2 = await _app(db_session, v_shared.id, c2.id, x.id)
    a1_id, a2_id, v_solo_id, v_shared_id, c1_id, c2_id = (
        a1.id, a2.id, v_solo.id, v_shared.id, c1.id, c2.id
    )
    await db_session.commit()

    # HR-метки исходно указывают на X.
    await sync_for_entity(db_session, c1_id)
    await sync_for_entity(db_session, c2_id)
    await db_session.commit()
    yid, xid = y.id, x.id

    r = await client.post(
        "/api/users/reassign-ownership",
        json={"from_user_id": xid, "to_user_id": yid}, headers=_h(admin_token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applications"] == 2, body
    assert body["candidates"] == 2, body
    assert body["vacancies"] == 1, body  # только solo был создан X

    # Заявки → Y
    for aid in (a1_id, a2_id):
        a = await db_session.get(VacancyApplication, aid)
        await db_session.refresh(a)
        assert a.created_by == yid, (aid, a.created_by)
    # Кандидаты → Y + HR-метки перешли на Y
    for cid in (c1_id, c2_id):
        e = await db_session.get(Entity, cid)
        await db_session.refresh(e)
        assert e.created_by == yid
        tags = (e.extra_data or {}).get(EXTRA_KEY) or []
        assert tags and all(t["hr_id"] == yid for t in tags), tags
    # Вакансия solo → Y как создатель
    vsolo = await db_session.get(Vacancy, v_solo_id)
    await db_session.refresh(vsolo)
    assert vsolo.created_by == yid
    # X убран из участников общей воронки, Y остался
    vs = await db_session.get(Vacancy, v_shared_id)
    await db_session.refresh(vs)
    assert xid not in (vs.assigned_to or [])
    assert yid in (vs.assigned_to or [])


@pytest.mark.asyncio
async def test_reassign_rejects_cross_org_receiver(
    client, db_session, organization, second_organization, admin_user, org_owner, admin_token,
):
    x = await _member(db_session, organization.id, "X", "x2@t.co")
    y_other = await _member(db_session, second_organization.id, "Y чужой", "yo@t.co")
    await db_session.commit()

    r = await client.post(
        "/api/users/reassign-ownership",
        json={"from_user_id": x.id, "to_user_id": y_other.id}, headers=_h(admin_token),
    )
    assert r.status_code == 400, r.text  # принимающий не в той же орг


@pytest.mark.asyncio
async def test_reassign_requires_admin(
    client, db_session, organization, admin_user, org_owner,
):
    from api.services.auth import create_access_token
    x = await _member(db_session, organization.id, "X", "x3@t.co")
    plain = await _member(db_session, organization.id, "Обычный", "plain@t.co", role=OrgRole.member)
    y = await _member(db_session, organization.id, "Y", "y3@t.co")
    await db_session.commit()

    token = create_access_token({"sub": str(plain.id), "token_version": 0})
    r = await client.post(
        "/api/users/reassign-ownership",
        json={"from_user_id": x.id, "to_user_id": y.id}, headers=_h(token),
    )
    assert r.status_code == 403, r.text
