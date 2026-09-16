"""Удаление записи истории НЕ трогает этап заявки (2026-09-16).

Кандидата перенесли, запись о переносе удалили — он остаётся там, куда его
перенесли. Короткое время (11.09–16.09) удаление последнего перехода возвращало
заявку на прошлый этап; это оказалось не тем поведением, которое нужно.
"""
from datetime import datetime, timedelta

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import (
    ApplicationStage, Department, Entity, EntityStatus, EntityType, OrgMember,
    Organization, StageTransition, User, Vacancy, VacancyApplication, VacancyStatus,
)
from api.services.auth import create_access_token
from tests.conftest import auth_headers

FIRST = ApplicationStage.applied
SECOND = [s for s in ApplicationStage if s != FIRST][0]


@pytest_asyncio.fixture
async def moved_application(
    db_session: AsyncSession, organization: Organization, department: Department,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    now = datetime.utcnow()
    vacancy = Vacancy(
        org_id=organization.id, department_id=department.id, created_by=admin_user.id,
        title="Трафик", status=VacancyStatus.open, salary_currency="RUB",
        created_at=now, updated_at=now,
    )
    db_session.add(vacancy)
    await db_session.commit()
    app = VacancyApplication(
        vacancy_id=vacancy.id, entity_id=candidate_entity.id, stage=SECOND, stage_order=1,
        created_by=admin_user.id, applied_at=now, last_stage_change_at=now, updated_at=now,
    )
    db_session.add(app)
    await db_session.commit()
    initial = StageTransition(
        application_id=app.id, entity_id=candidate_entity.id, from_stage=None,
        to_stage=FIRST.value, changed_by=admin_user.id, created_at=now - timedelta(minutes=5),
    )
    moved = StageTransition(
        application_id=app.id, entity_id=candidate_entity.id, from_stage=FIRST.value,
        to_stage=SECOND.value, changed_by=admin_user.id, created_at=now,
    )
    db_session.add_all([initial, moved])
    await db_session.commit()
    return app, initial, moved


def _headers(user: User) -> dict:
    return auth_headers(create_access_token(data={"sub": str(user.id)}))


async def test_deleting_latest_transition_keeps_stage(
    client: AsyncClient, db_session: AsyncSession, admin_user: User, moved_application,
):
    app, _initial, moved = moved_application
    r = await client.delete(
        f"/api/vacancies/applications/{app.id}/history/{moved.id}", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(app)
    assert app.stage == SECOND


async def test_deleting_older_transition_keeps_stage(
    client: AsyncClient, db_session: AsyncSession, admin_user: User, moved_application,
):
    app, initial, _moved = moved_application
    r = await client.delete(
        f"/api/vacancies/applications/{app.id}/history/{initial.id}", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(app)
    assert app.stage == SECOND


async def test_stage_change_rejects_wrong_candidate(
    client: AsyncClient, db_session: AsyncSession, admin_user: User, moved_application,
):
    """Страховка: если фронт ждал другого кандидата — этап не меняется (409)."""
    app, _initial, _moved = moved_application
    r = await client.put(
        f"/api/vacancies/applications/{app.id}",
        json={"stage": FIRST.value, "expected_entity_id": app.entity_id + 999},
        headers=_headers(admin_user),
    )
    assert r.status_code == 409, r.text
    await db_session.refresh(app)
    assert app.stage == SECOND


async def test_stage_change_applies_for_matching_candidate(
    client: AsyncClient, db_session: AsyncSession, admin_user: User, moved_application,
):
    app, _initial, _moved = moved_application
    r = await client.put(
        f"/api/vacancies/applications/{app.id}",
        json={"stage": FIRST.value, "expected_entity_id": app.entity_id},
        headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(app)
    assert app.stage == FIRST


@pytest_asyncio.fixture
async def second_application(
    db_session: AsyncSession, organization: Organization, department: Department,
    admin_user: User, moved_application,
):
    """Второй РЕАЛЬНЫЙ кандидат в той же воронке — как у Марии 15.09.

    Проверка с `entity_id + 999` ловит только несуществующего кандидата, а
    промах был именно между двумя живыми людьми одной воронки.
    """
    app, _initial, _moved = moved_application
    now = datetime.utcnow()
    other = Entity(
        org_id=organization.id, department_id=department.id, created_by=admin_user.id,
        name="Никитина", type=EntityType.candidate, status=EntityStatus.interview,
        created_at=now,
    )
    db_session.add(other)
    await db_session.commit()
    other_app = VacancyApplication(
        vacancy_id=app.vacancy_id, entity_id=other.id, stage=FIRST, stage_order=2,
        created_by=admin_user.id, applied_at=now, last_stage_change_at=now, updated_at=now,
    )
    db_session.add(other_app)
    await db_session.commit()
    return other, other_app


async def test_stale_application_id_of_neighbour_is_rejected(
    client: AsyncClient, db_session: AsyncSession, admin_user: User,
    moved_application, second_application,
):
    """Баг Марии 2026-09-15 в том виде, в каком его теперь шлёт фронт.

    Открыта Никитина, а applicationId прилетел из устаревшей ленты и принадлежит
    соседу по воронке. expected_entity_id берётся у ОТКРЫТОГО кандидата, поэтому
    сверка не сходится: 409, и ни одна из двух заявок не двигается.
    """
    stale_app, _initial, _moved = moved_application     # заявка соседа
    open_entity, open_app = second_application          # кого видит пользователь

    r = await client.put(
        f"/api/vacancies/applications/{stale_app.id}",
        json={"stage": FIRST.value, "expected_entity_id": open_entity.id},
        headers=_headers(admin_user),
    )
    assert r.status_code == 409, r.text

    await db_session.refresh(stale_app)
    await db_session.refresh(open_app)
    assert stale_app.stage == SECOND, "заявка соседа не должна была сдвинуться"
    assert open_app.stage == FIRST, "заявка открытого кандидата тоже не тронута"
