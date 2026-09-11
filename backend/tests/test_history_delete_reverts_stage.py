"""Удаление ошибочного перехода в истории возвращает заявку на прошлый этап.

Раньше DELETE /vacancies/applications/{id}/history/{hid} удалял только запись,
а кандидат оставался на «удалённом» этапе (2026-09-11, Мария).
"""
from datetime import datetime, timedelta

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import (
    ApplicationStage, Department, Entity, OrgMember, Organization, StageTransition,
    User, Vacancy, VacancyApplication, VacancyStatus,
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


async def test_deleting_latest_transition_reverts_stage(
    client: AsyncClient, db_session: AsyncSession, admin_user: User, moved_application,
):
    app, _initial, moved = moved_application
    r = await client.delete(
        f"/api/vacancies/applications/{app.id}/history/{moved.id}", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reverted_to"] == FIRST.value
    await db_session.refresh(app)
    assert app.stage == FIRST


async def test_deleting_older_transition_keeps_stage(
    client: AsyncClient, db_session: AsyncSession, admin_user: User, moved_application,
):
    app, initial, _moved = moved_application
    r = await client.delete(
        f"/api/vacancies/applications/{app.id}/history/{initial.id}", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reverted_to"] is None
    await db_session.refresh(app)
    assert app.stage == SECOND
