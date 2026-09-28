"""Общий список задач не должен падать из-за пустых полей (28.09.2026).

На проде /api/projects/all-tasks отдавал 500: у задач, заведённых мимо ORM
(импорт, ручные вставки), sort_order = NULL, а схема ответа ждёт число —
и один такой ряд ронял ВЕСЬ список задач по всем проектам.
"""
from datetime import datetime

import pytest

from api.models.database import Project, ProjectTask
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


@pytest.mark.asyncio
async def test_all_tasks_survives_null_sort_order(client, db_session, organization, admin_user, org_owner):
    project = Project(
        org_id=organization.id, name="Проект без сортировки", prefix="NUL",
        status="active", created_by=admin_user.id, created_at=datetime.utcnow(),
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    db_session.add(ProjectTask(
        project_id=project.id, title="Задача из импорта", status="todo",
        sort_order=None, priority=None, created_by=admin_user.id,
        created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    ))
    await db_session.commit()

    r = await client.get("/api/projects/all-tasks", headers=_h(admin_user))
    assert r.status_code == 200, r.text
    groups = r.json()
    task = groups[0]["status_groups"]["todo"][0]
    assert task["title"] == "Задача из импорта"
    assert task["sort_order"] == 0
    assert task["priority"] == 1


@pytest.mark.asyncio
async def test_project_tasks_list_survives_too(client, db_session, organization, admin_user, org_owner):
    """Тот же серилизатор используется и в списке задач проекта."""
    project = Project(
        org_id=organization.id, name="Проект 2", prefix="P2",
        status="active", created_by=admin_user.id, created_at=datetime.utcnow(),
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    db_session.add(ProjectTask(
        project_id=project.id, title="Ещё одна", status="todo", sort_order=None,
        created_by=admin_user.id, created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    ))
    await db_session.commit()

    r = await client.get(f"/api/projects/{project.id}/tasks", headers=_h(admin_user))
    assert r.status_code == 200, r.text
