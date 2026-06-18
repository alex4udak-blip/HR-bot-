"""
Тесты теневой дедупликации кандидатов:
- detect_archived_duplicate: матчинг по email/телефону, скоуп архива/org, dismissed
- merge_entities: перенос истории на survivor, удаление source, снятие флага, UNIQUE-конфликт заявок
- эндпоинты: archive / unarchive / archive-list (superadmin-гейт), dismiss, merge-shadow
- фильтрация: архивные не попадают в активный список
"""
import pytest
from sqlalchemy import select

from api.models.database import (
    Entity, EntityType, EntityStatus, Organization, User,
    Vacancy, VacancyApplication, StageTransition,
)
from api.services.similarity import detect_archived_duplicate, similarity_service
from api.services.auth import create_access_token


async def _mk(db, org_id, name, **kw):
    e = Entity(org_id=org_id, type=EntityType.candidate, name=name, status=EntityStatus.new, **kw)
    db.add(e)
    await db.flush()
    return e


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ============================================================
# detect_archived_duplicate (unit)
# ============================================================

@pytest.mark.asyncio
async def test_detect_email_match_case_insensitive(db_session, organization):
    archived = await _mk(db_session, organization.id, "Иван архив", email="ivan@x.com", is_archived=True)
    newc = await _mk(db_session, organization.id, "Иван новый", email="IVAN@x.com")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) == archived.id


@pytest.mark.asyncio
async def test_detect_phone_match_ignores_formatting(db_session, organization):
    archived = await _mk(db_session, organization.id, "Пётр архив", phone="8 (912) 345-67-89", is_archived=True)
    newc = await _mk(db_session, organization.id, "Пётр новый", phone="+7 912 3456789")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) == archived.id


@pytest.mark.asyncio
async def test_detect_telegram_match_normalizes_at_and_case(db_session, organization):
    archived = await _mk(db_session, organization.id, "ТГ архив",
                         telegram_usernames=["ivan_hr"], is_archived=True)
    newc = await _mk(db_session, organization.id, "ТГ новый",
                     telegram_usernames=["@Ivan_HR"])  # @ + другой регистр
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) == archived.id


@pytest.mark.asyncio
async def test_detect_matches_by_full_name(db_session, organization):
    # одинаковое полное ФИО (≥2 слов) без общих контактов → дубль
    existing = await _mk(db_session, organization.id, "Хисамов Вадим Ринатович")
    newc = await _mk(db_session, organization.id, "Хисамов Вадим Ринатович")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) == existing.id


@pytest.mark.asyncio
async def test_detect_single_word_name_not_matched(db_session, organization):
    # одно слово («Владимир») — по имени НЕ матчим (слишком общо)
    await _mk(db_session, organization.id, "Владимир")
    newc = await _mk(db_session, organization.id, "Владимир")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) is None


@pytest.mark.asyncio
async def test_detect_no_match_returns_none(db_session, organization):
    await _mk(db_session, organization.id, "Архив", email="someone@x.com", is_archived=True)
    newc = await _mk(db_session, organization.id, "Новый", email="other@x.com", phone="+7 999 0000000")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) is None


@pytest.mark.asyncio
async def test_detect_matches_active_candidates(db_session, organization):
    # детект теперь ловит дубль и среди АКТИВНЫХ (не только архив)
    active = await _mk(db_session, organization.id, "Актив", email="dup@x.com", is_archived=False)
    newc = await _mk(db_session, organization.id, "Новый", email="dup@x.com")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) == active.id


@pytest.mark.asyncio
async def test_detect_respects_dismissed(db_session, organization):
    archived = await _mk(db_session, organization.id, "Архив", email="d@x.com", is_archived=True)
    await db_session.flush()
    newc = await _mk(
        db_session, organization.id, "Новый", email="d@x.com",
        extra_data={"dismissed_duplicate_ids": [archived.id]},
    )
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) is None


@pytest.mark.asyncio
async def test_detect_cross_org_isolated(db_session, organization, second_organization):
    await _mk(db_session, second_organization.id, "Чужой архив", email="x@x.com", is_archived=True)
    newc = await _mk(db_session, organization.id, "Новый", email="x@x.com")
    await db_session.commit()
    assert await detect_archived_duplicate(db_session, newc) is None


# ============================================================
# merge_entities (unit) — единый таймлайн
# ============================================================

@pytest.mark.asyncio
async def test_merge_moves_history_and_deletes_source(db_session, organization):
    vac = Vacancy(org_id=organization.id, title="Dev")
    db_session.add(vac)
    await db_session.flush()

    source = await _mk(db_session, organization.id, "Архив", email="s@x.com", is_archived=True)
    target = await _mk(db_session, organization.id, "Новый", email="t@x.com")
    target.extra_data = {"hidden_duplicate_id": source.id}

    app = VacancyApplication(vacancy_id=vac.id, entity_id=source.id)
    db_session.add(app)
    await db_session.flush()
    db_session.add(StageTransition(application_id=app.id, entity_id=source.id, to_stage="new"))
    await db_session.commit()

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target
    )

    # вся история перецеплена на survivor
    apps = (await db_session.execute(
        select(VacancyApplication).where(VacancyApplication.entity_id == target.id)
    )).scalars().all()
    assert len(apps) == 1
    trs = (await db_session.execute(
        select(StageTransition).where(StageTransition.entity_id == target.id)
    )).scalars().all()
    assert len(trs) == 1
    # source удалён
    assert await db_session.get(Entity, source.id) is None
    # флаг теневого дубля снят
    assert "hidden_duplicate_id" not in (merged.extra_data or {})


@pytest.mark.asyncio
async def test_merge_resolves_duplicate_application_conflict(db_session, organization):
    # обе сущности подавались на ОДНУ вакансию → UNIQUE(vacancy_id, entity_id);
    # merge не должен падать, заявка target остаётся, заявка source удаляется.
    vac = Vacancy(org_id=organization.id, title="Dev")
    db_session.add(vac)
    await db_session.flush()

    source = await _mk(db_session, organization.id, "Архив", email="s2@x.com", is_archived=True)
    target = await _mk(db_session, organization.id, "Новый", email="t2@x.com")
    db_session.add_all([
        VacancyApplication(vacancy_id=vac.id, entity_id=target.id),
        VacancyApplication(vacancy_id=vac.id, entity_id=source.id),
    ])
    await db_session.commit()

    await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target
    )

    apps = (await db_session.execute(
        select(VacancyApplication).where(VacancyApplication.entity_id == target.id)
    )).scalars().all()
    assert len(apps) == 1
    assert await db_session.get(Entity, source.id) is None


# ============================================================
# Эндпоинты
# ============================================================

@pytest.mark.asyncio
async def test_archive_endpoint_hides_from_list(client, db_session, organization, admin_user, org_owner, admin_token):
    active = await _mk(db_session, organization.id, "Актив", email="act@x.com", created_by=admin_user.id)
    target = await _mk(db_session, organization.id, "Уберём", email="arc@x.com", created_by=admin_user.id)
    await db_session.commit()

    # до архивации — оба в списке
    r = await client.get("/api/entities/", headers=_h(admin_token))
    assert r.status_code == 200, r.text
    ids_before = {e["id"] for e in r.json()}
    assert {active.id, target.id} <= ids_before

    # архивируем
    r = await client.post(f"/api/entities/{target.id}/archive", headers=_h(admin_token))
    assert r.status_code == 200, r.text
    fresh = await db_session.get(Entity, target.id)
    await db_session.refresh(fresh)
    assert fresh.is_archived is True

    # после — архивный исчез из активного списка, активный остался
    r = await client.get("/api/entities/", headers=_h(admin_token))
    ids_after = {e["id"] for e in r.json()}
    assert active.id in ids_after
    assert target.id not in ids_after


@pytest.mark.asyncio
async def test_archive_list_superadmin_only(
    client, db_session, organization, admin_user, org_owner,
    superadmin_user, admin_token, superadmin_token,
):
    await _mk(db_session, organization.id, "Арх1", email="a1@x.com", is_archived=True)
    await db_session.commit()

    # обычный админ → 403
    r = await client.get("/api/entities/archive/list", headers=_h(admin_token))
    assert r.status_code == 403

    # суперадмин → 200 + видит архив
    r = await client.get("/api/entities/archive/list", headers=_h(superadmin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1
    assert any(it["name"] == "Арх1" for it in body["items"])


@pytest.mark.asyncio
async def test_unarchive_superadmin_only(
    client, db_session, organization, admin_user, org_owner,
    superadmin_user, admin_token, superadmin_token,
):
    e = await _mk(db_session, organization.id, "ВАрхиве", email="u@x.com",
                  created_by=admin_user.id, is_archived=True)
    await db_session.commit()

    # обычный админ не может вернуть из архива
    r = await client.post(f"/api/entities/{e.id}/unarchive", headers=_h(admin_token))
    assert r.status_code == 403

    # суперадмин может
    r = await client.post(f"/api/entities/{e.id}/unarchive", headers=_h(superadmin_token))
    assert r.status_code == 200, r.text
    fresh = await db_session.get(Entity, e.id)
    await db_session.refresh(fresh)
    assert fresh.is_archived is False


@pytest.mark.asyncio
async def test_dismiss_clears_flag_and_records_id(
    client, db_session, organization, admin_user, org_owner, admin_token,
):
    archived = await _mk(db_session, organization.id, "Арх", email="dd@x.com", is_archived=True)
    await db_session.flush()
    newc = await _mk(
        db_session, organization.id, "Новый", email="dd2@x.com", created_by=admin_user.id,
        extra_data={"hidden_duplicate_id": archived.id},
    )
    await db_session.commit()

    r = await client.post(
        f"/api/entities/{newc.id}/dismiss-duplicate",
        json={"duplicate_id": archived.id}, headers=_h(admin_token),
    )
    assert r.status_code == 200, r.text

    fresh = await db_session.get(Entity, newc.id)
    await db_session.refresh(fresh)
    extra = fresh.extra_data or {}
    assert "hidden_duplicate_id" not in extra
    assert archived.id in (extra.get("dismissed_duplicate_ids") or [])
    # повторный детект уже не поднимает этот дубль
    assert await detect_archived_duplicate(db_session, fresh) is None


@pytest.mark.asyncio
async def test_merge_shadow_endpoint(
    client, db_session, organization, admin_user, org_owner, admin_token,
):
    source = await _mk(db_session, organization.id, "Арх", email="ms@x.com", is_archived=True)
    await db_session.flush()
    target = await _mk(
        db_session, organization.id, "Новый", email="ms2@x.com", created_by=admin_user.id,
        extra_data={"hidden_duplicate_id": source.id},
    )
    await db_session.commit()

    r = await client.post(
        f"/api/entities/{target.id}/merge-shadow",
        json={"duplicate_id": source.id}, headers=_h(admin_token),
    )
    assert r.status_code == 200, r.text
    # архивный удалён, флаг снят
    assert await db_session.get(Entity, source.id) is None
    fresh = await db_session.get(Entity, target.id)
    await db_session.refresh(fresh)
    assert "hidden_duplicate_id" not in (fresh.extra_data or {})


@pytest.mark.asyncio
async def test_merge_shadow_merges_active_duplicate(
    client, db_session, organization, admin_user, org_owner, admin_token,
):
    # merge-shadow теперь объединяет и АКТИВНЫЙ дубль (не только архивный)
    source = await _mk(db_session, organization.id, "Активный дубль", email="na@x.com", is_archived=False)
    await db_session.flush()
    target = await _mk(db_session, organization.id, "Новый", email="na2@x.com", created_by=admin_user.id)
    await db_session.commit()

    r = await client.post(
        f"/api/entities/{target.id}/merge-shadow",
        json={"duplicate_id": source.id}, headers=_h(admin_token),
    )
    assert r.status_code == 200, r.text
    # источник-дубль удалён, survivor остался
    assert await db_session.get(Entity, source.id) is None
    assert await db_session.get(Entity, target.id) is not None
