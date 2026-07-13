"""Приватность воронки: «общая воронка, но каждый видит только своих» (2026-07-13).

Модель: обычный рекрутёр (member без полного доступа) видит на kanban-доске
конкретной вакансии ТОЛЬКО кандидатов, которых сам добавил
(VacancyApplication.created_by == self). Админ/владелец/суперадмин видят всех.
Ограничение действует только в воронке; глобальная база остаётся общей.
"""
from datetime import datetime

import pytest
import pytest_asyncio

from api.models.database import (
    Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Entity, EntityType, EntityStatus, DepartmentFeature,
)
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


@pytest_asyncio.fixture(autouse=True)
async def candidate_database_feature(db_session, organization):
    """check_vacancy_access требует фичу candidate_database для member."""
    db_session.add(DepartmentFeature(
        org_id=organization.id, department_id=None,
        feature_name="candidate_database", enabled=True,
    ))
    await db_session.commit()


async def _mk_entity(db, org, creator, name) -> Entity:
    e = Entity(
        org_id=org.id, created_by=creator.id, name=name,
        type=EntityType.candidate, status=EntityStatus.new,
        created_at=datetime.utcnow(),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


async def _mk_app(db, vacancy, entity, creator) -> VacancyApplication:
    app = VacancyApplication(
        vacancy_id=vacancy.id, entity_id=entity.id,
        stage=ApplicationStage.applied, stage_order=1,
        created_by=creator.id, applied_at=datetime.utcnow(),
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return app


@pytest_asyncio.fixture
async def shared_vacancy_with_two_apps(
    db_session, organization, admin_user, second_user
):
    """Общая воронка (visible_to_all) с двумя откликами: один добавил admin,
    другой — second_user (обычный рекрутёр)."""
    v = Vacancy(
        org_id=organization.id, title="Общая воронка", status=VacancyStatus.open,
        created_by=admin_user.id, visible_to_all=True,
        assigned_to=[second_user.id],  # рекрутёр — участник воронки (даёт доступ)
        created_at=datetime.utcnow(),
    )
    db_session.add(v)
    await db_session.commit()
    await db_session.refresh(v)

    e_admin = await _mk_entity(db_session, organization, admin_user, "Кандидат Админа")
    e_member = await _mk_entity(db_session, organization, second_user, "Кандидат Рекрутёра")
    await _mk_app(db_session, v, e_admin, admin_user)
    await _mk_app(db_session, v, e_member, second_user)
    return v, e_admin.id, e_member.id


def _all_entity_ids(board_json) -> set:
    ids = set()
    for col in board_json["columns"]:
        for app in col["applications"]:
            ids.add(app["entity_id"])
    return ids


@pytest.mark.asyncio
async def test_recruiter_sees_only_own_on_board(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    # Обычный рекрутёр (member) видит ТОЛЬКО своего кандидата
    r = await client.get(f"/api/vacancies/{v.id}/kanban", headers=_h(second_user))
    assert r.status_code == 200, r.text
    ids = _all_entity_ids(r.json())
    assert ids == {e_member_id}
    assert r.json()["total_count"] == 1


@pytest.mark.asyncio
async def test_admin_sees_all_on_board(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    # Админ видит обоих
    r = await client.get(f"/api/vacancies/{v.id}/kanban", headers=_h(admin_user))
    assert r.status_code == 200, r.text
    ids = _all_entity_ids(r.json())
    assert ids == {e_admin_id, e_member_id}
    assert r.json()["total_count"] == 2


@pytest.mark.asyncio
async def test_admin_can_filter_by_recruiter(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    # Админ фильтрует по рекрутёру second_user → только его кандидат
    r = await client.get(
        f"/api/vacancies/{v.id}/kanban?created_by={second_user.id}",
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text
    assert _all_entity_ids(r.json()) == {e_member_id}


@pytest.mark.asyncio
async def test_recruiter_column_load_more_scoped(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    # Догрузка колонки (infinite scroll) тоже отдаёт только своих
    r = await client.get(
        f"/api/vacancies/{v.id}/kanban/column/applied", headers=_h(second_user)
    )
    assert r.status_code == 200, r.text
    ids = {a["entity_id"] for a in r.json()["applications"]}
    assert ids == {e_member_id}
    assert r.json()["total_count"] == 1


@pytest.mark.asyncio
async def test_recruiter_sees_legacy_null_author(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    """Legacy-отклик без автора (created_by=NULL) виден рекрутёру (fallback)."""
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    # Добавляем «ничей» отклик (старый импорт) — created_by=NULL
    e_legacy = await _mk_entity(db_session, organization, admin_user, "Старый импорт")
    legacy = VacancyApplication(
        vacancy_id=v.id, entity_id=e_legacy.id,
        stage=ApplicationStage.applied, stage_order=1,
        created_by=None, applied_at=datetime.utcnow(),
    )
    db_session.add(legacy)
    await db_session.commit()

    r = await client.get(f"/api/vacancies/{v.id}/kanban", headers=_h(second_user))
    assert r.status_code == 200, r.text
    ids = _all_entity_ids(r.json())
    # свой + legacy без автора; чужой (админский) — скрыт
    assert ids == {e_member_id, e_legacy.id}


@pytest.mark.asyncio
async def test_recruiter_applications_only_own(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    """GET /applications (страница /my-funnels) тоже скоупится: рекрутёр видит
    только своих кандидатов."""
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    r = await client.get(f"/api/vacancies/{v.id}/applications", headers=_h(second_user))
    assert r.status_code == 200, r.text
    ids = {a["entity_id"] for a in r.json()}
    assert ids == {e_member_id}


@pytest.mark.asyncio
async def test_admin_applications_filter_by_recruiter(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    """Админ видит всех, а с ?created_by=<id> скоупит воронку по рекрутёру
    (селектор «Вакансии: <имя>» в сайдбаре)."""
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    r_all = await client.get(f"/api/vacancies/{v.id}/applications", headers=_h(admin_user))
    assert r_all.status_code == 200, r_all.text
    assert {a["entity_id"] for a in r_all.json()} == {e_admin_id, e_member_id}

    r_scoped = await client.get(
        f"/api/vacancies/{v.id}/applications?created_by={second_user.id}",
        headers=_h(admin_user),
    )
    assert r_scoped.status_code == 200, r_scoped.text
    assert {a["entity_id"] for a in r_scoped.json()} == {e_member_id}


@pytest.mark.asyncio
async def test_recruiter_cannot_move_foreign_candidate(
    client, db_session, organization, admin_user, org_owner,
    second_user, org_member, shared_vacancy_with_two_apps,
):
    v, e_admin_id, e_member_id = shared_vacancy_with_two_apps

    # Находим отклик чужого кандидата (админского) и пробуем подвинуть его
    from sqlalchemy import select
    app_id = (await db_session.execute(
        select(VacancyApplication.id).where(
            VacancyApplication.vacancy_id == v.id,
            VacancyApplication.entity_id == e_admin_id,
        )
    )).scalar()

    r = await client.put(
        f"/api/vacancies/applications/{app_id}",
        headers=_h(second_user), json={"stage": "screening"},
    )
    assert r.status_code == 403, r.text
