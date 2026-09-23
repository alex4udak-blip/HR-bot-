"""Разовый снос неактуальных отделов: люди остаются, отметка не даёт повтора."""
from datetime import datetime

import pytest

from api.models.database import Department, Entity, EntityStatus, EntityType
from api.services.departments_reset import MARK, reset_stale_departments_once
from api.models.database import DataMigrationMark


@pytest.mark.asyncio
async def test_removes_stale_keeps_people(db_session, organization, admin_user):
    stale = Department(org_id=organization.id, name="RND отдел", is_active=True)
    fresh = Department(org_id=organization.id, name="Фарм отдел", is_active=True)
    db_session.add_all([stale, fresh])
    await db_session.commit()
    await db_session.refresh(stale)
    await db_session.refresh(fresh)
    e = Entity(
        org_id=organization.id, name="Отделов Олег", type=EntityType.candidate,
        status=EntityStatus.transferred, department_id=stale.id,
        created_by=admin_user.id, created_at=datetime.utcnow(), extra_data={},
    )
    db_session.add(e)
    await db_session.commit()

    res = await reset_stale_departments_once(db_session)
    assert res == {"departments_deleted": 1, "entities_unassigned": 1}

    await db_session.refresh(e)
    assert e.id is not None and e.department_id is None
    assert await db_session.get(Department, fresh.id) is not None
    assert await db_session.get(Department, stale.id) is None


@pytest.mark.asyncio
async def test_runs_only_once(db_session, organization):
    db_session.add(DataMigrationMark(key=MARK))
    await db_session.commit()
    again = Department(org_id=organization.id, name="ASOGP", is_active=True)
    db_session.add(again)
    await db_session.commit()
    await db_session.refresh(again)

    assert await reset_stale_departments_once(db_session) == {}
    assert await db_session.get(Department, again.id) is not None
