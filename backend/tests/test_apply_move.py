"""apply-to-vacancy = MOVE: один кандидат = одна воронка (без дублей)."""
import pytest
from sqlalchemy import select, func

from api.models.database import (
    Entity, EntityType, EntityStatus, Vacancy, VacancyStatus, VacancyApplication,
)
from api.services.auth import create_access_token


def _h(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.mark.asyncio
async def test_apply_moves_candidate_single_funnel(client, db_session, organization, admin_user, org_owner):
    ent = Entity(org_id=organization.id, type=EntityType.candidate, name="Мув Тест", status=EntityStatus.new)
    va = Vacancy(org_id=organization.id, title="Воронка A", status=VacancyStatus.open, created_by=admin_user.id)
    vb = Vacancy(org_id=organization.id, title="Воронка B", status=VacancyStatus.open, created_by=admin_user.id)
    db_session.add_all([ent, va, vb])
    await db_session.commit()
    H = _h(admin_user)

    async def app_rows(eid):
        return (
            await db_session.execute(
                select(VacancyApplication).where(VacancyApplication.entity_id == eid)
            )
        ).scalars().all()

    # Берём на воронку A.
    r = await client.post(f"/api/entities/{ent.id}/apply-to-vacancy", json={"vacancy_id": va.id}, headers=H)
    assert r.status_code == 200, r.text
    rows = await app_rows(ent.id)
    assert len(rows) == 1 and rows[0].vacancy_id == va.id

    # Переносим на B — A должна сняться (одна заявка, на B).
    r = await client.post(f"/api/entities/{ent.id}/apply-to-vacancy", json={"vacancy_id": vb.id}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["moved"] is True
    rows = await app_rows(ent.id)
    assert len(rows) == 1 and rows[0].vacancy_id == vb.id

    # Повторно на B — переносить некуда (no-op, без дубля).
    r = await client.post(f"/api/entities/{ent.id}/apply-to-vacancy", json={"vacancy_id": vb.id}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["moved"] is False
    rows = await app_rows(ent.id)
    assert len(rows) == 1 and rows[0].vacancy_id == vb.id
