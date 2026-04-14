"""
Project task management + kanban endpoints.
"""
from fastapi import Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, timezone
from pydantic import BaseModel

from .common import (
    logger, TaskCreate, TaskUpdate, TaskResponse, TaskKanbanColumn, TaskKanbanBoard,
    Project, ProjectTask, TaskStatus, TaskTimeLog, ProjectMember, User,
    has_full_access, can_access_project, can_edit_project, can_manage_tasks, get_user_project_role,
    get_db, get_current_user, get_user_org,
    Organization,
)
from ...models.database import ProjectTaskStatus, Notification


TASK_STATUS_ORDER = ["backlog", "todo", "in_progress", "review", "done"]
TASK_STATUS_LABELS = {
    "backlog": "Бэклог",
    "todo": "К выполнению",
    "in_progress": "В работе",
    "review": "На ревью",
    "done": "Готово",
}


def serialize_task(t: ProjectTask) -> dict:
    total_hours = sum(tl.hours for tl in t.time_logs) if t.time_logs else 0
    subtask_count = len(t.subtasks) if t.subtasks else 0
    subtasks_done = sum(
        1 for s in t.subtasks
        if (s.status if isinstance(s.status, str) else s.status.value) == "done"
    ) if t.subtasks else 0
    comment_count = len(t.comments) if hasattr(t, 'comments') and t.comments else 0
    attachment_count = len(t.attachments) if hasattr(t, 'attachments') and t.attachments else 0
    # Build task_key like "PM-42"
    task_key = None
    if t.task_number:
        prefix = t.project.prefix if hasattr(t, 'project') and t.project and t.project.prefix else None
        if prefix:
            task_key = f"{prefix}-{t.task_number}"

    return TaskResponse(
        id=t.id,
        project_id=t.project_id,
        task_number=t.task_number,
        task_key=task_key,
        milestone_id=t.milestone_id,
        title=t.title,
        description=t.description,
        status=t.status if isinstance(t.status, str) else t.status.value,
        priority=t.priority,
        assignee_id=t.assignee_id,
        assignee_name=t.assignee.name if t.assignee else None,
        estimated_hours=t.estimated_hours,
        due_date=t.due_date,
        completed_at=t.completed_at,
        sort_order=t.sort_order,
        tags=t.tags or [],
        total_hours_logged=total_hours,
        parent_task_id=t.parent_task_id,
        subtask_count=subtask_count,
        subtasks_done=subtasks_done,
        comment_count=comment_count,
        attachment_count=attachment_count,
        created_by=t.created_by,
        creator_name=t.creator.name if hasattr(t, 'creator') and t.creator else None,
        created_at=t.created_at,
        updated_at=t.updated_at,
    ).model_dump()


async def _recalc_progress(project_id: int, db: AsyncSession):
    """Recalculate project progress from tasks if mode is auto.

    Uses estimated_hours as weight: tasks without estimate count as 1 hour.
    progress = sum(hours of done tasks) / sum(hours of all non-cancelled tasks) * 100
    """
    project = await db.get(Project, project_id)
    if not project or project.progress_mode != "auto":
        return

    from sqlalchemy import case as sa_case
    result = await db.execute(
        select(
            func.sum(
                sa_case(
                    (ProjectTask.status == TaskStatus.done, func.coalesce(ProjectTask.estimated_hours, 1)),
                    else_=0,
                )
            ).label("done_hours"),
            func.sum(
                sa_case(
                    (ProjectTask.status != TaskStatus.cancelled, func.coalesce(ProjectTask.estimated_hours, 1)),
                    else_=0,
                )
            ).label("total_hours"),
        ).where(ProjectTask.project_id == project_id)
    )
    row = result.one()
    done_hours = row.done_hours or 0
    total_hours = row.total_hours or 0
    project.progress_percent = round(done_hours / total_hours * 100) if total_hours > 0 else 0
    await db.flush()


async def list_tasks(
    project_id: int,
    status: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    milestone_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List tasks for a project with optional filters."""
    org = await get_user_org(current_user, db)
    query = (
        select(ProjectTask)
        .where(ProjectTask.project_id == project_id)
        .where(ProjectTask.parent_task_id.is_(None))
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.creator),
        )
    )

    if status:
        query = query.where(ProjectTask.status == status)
    if assignee_id:
        query = query.where(ProjectTask.assignee_id == assignee_id)
    if milestone_id:
        query = query.where(ProjectTask.milestone_id == milestone_id)

    query = query.order_by(ProjectTask.sort_order, ProjectTask.created_at)

    result = await db.execute(query)
    tasks = list(result.scalars().unique().all())
    return [serialize_task(t) for t in tasks]


async def create_task(
    project_id: int,
    data: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a task in a project. Managers/leads can assign to anyone. Workers can only create tasks for themselves."""
    org = await get_user_org(current_user, db)
    project = await db.get(Project, project_id)
    if not project or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="Project not found")
    if not await can_access_project(project, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Workers can only assign tasks to themselves
    is_manager = await can_manage_tasks(project, current_user, org, db)
    if not is_manager and data.assignee_id and data.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only create tasks assigned to yourself")

    # Increment project task counter for sequential task_number
    project.task_counter = (project.task_counter or 0) + 1
    next_number = project.task_counter

    task = ProjectTask(
        project_id=project_id,
        task_number=next_number,
        milestone_id=data.milestone_id,
        title=data.title,
        description=data.description,
        status=data.status or TaskStatus.backlog,
        priority=data.priority or 1,
        assignee_id=data.assignee_id,
        estimated_hours=data.estimated_hours,
        due_date=data.due_date,
        tags=data.tags or [],
        parent_task_id=data.parent_task_id,
        created_by=current_user.id,
    )
    db.add(task)
    await db.flush()
    await _recalc_progress(project_id, db)

    # Notify assignee about new task
    if task.assignee_id and task.assignee_id != current_user.id:
        notif = Notification(
            user_id=task.assignee_id,
            type="task_assigned",
            title=f"Вам назначена задача: {task.title}",
            message=f"Проект: {project.name}",
            link=f"/projects/{project_id}",
        )
        db.add(notif)

    await db.commit()

    # Send Telegram notification to assignee
    if task.assignee_id and task.assignee_id != current_user.id:
        try:
            from ...bot import send_telegram_notification
            import os
            frontend_url = os.getenv("FRONTEND_URL", "https://hr-bot-production-c613.up.railway.app")
            await send_telegram_notification(
                task.assignee_id,
                f"\U0001f4cb <b>\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u0434\u0430\u0447\u0430 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0430 \u043d\u0430 \u0432\u0430\u0441</b>\n\n"
                f"\U0001f4dd {task.title}\n"
                f"\U0001f4c2 \u041f\u0440\u043e\u0435\u043a\u0442: {project.name}\n"
                f'\U0001f517 <a href="{frontend_url}/projects/{project.id}">\u041e\u0442\u043a\u0440\u044b\u0442\u044c</a>',
            )
        except Exception:
            pass

    result = await db.execute(
        select(ProjectTask)
        .where(ProjectTask.id == task.id)
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.creator),
        )
    )
    task = result.scalar_one()
    return serialize_task(task)


async def get_task(
    project_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single task."""
    result = await db.execute(
        select(ProjectTask)
        .where(ProjectTask.id == task_id, ProjectTask.project_id == project_id)
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.creator),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return serialize_task(task)


async def update_task(
    project_id: int,
    task_id: int,
    data: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a task. Workers can only update status on their own tasks. Managers can edit anything."""
    org = await get_user_org(current_user, db)
    project = await db.get(Project, project_id)
    if not project or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ProjectTask)
        .where(ProjectTask.id == task_id, ProjectTask.project_id == project_id)
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.creator),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Any project member can edit/move tasks; only managers can reassign
    is_manager = await can_manage_tasks(project, current_user, org, db)
    if not is_manager:
        # Non-managers cannot reassign tasks to other people
        if data.assignee_id is not None and data.assignee_id != task.assignee_id:
            raise HTTPException(status_code=403, detail="You cannot reassign tasks")

    update_data = data.model_dump(exclude_unset=True)
    old_status = task.status
    old_assignee_id = task.assignee_id

    for key, value in update_data.items():
        setattr(task, key, value)

    # Notify new assignee if changed
    if data.assignee_id is not None and data.assignee_id != old_assignee_id and data.assignee_id != current_user.id:
        notif = Notification(
            user_id=data.assignee_id,
            type="task_assigned",
            title=f"Вам назначена задача: {task.title}",
            message=f"Проект: {project.name}",
            link=f"/projects/{project_id}",
        )
        db.add(notif)

        # Send Telegram notification to new assignee
        try:
            from ...bot import send_telegram_notification
            import os
            frontend_url = os.getenv("FRONTEND_URL", "https://hr-bot-production-c613.up.railway.app")
            await send_telegram_notification(
                data.assignee_id,
                f"\U0001f4cb <b>\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u0434\u0430\u0447\u0430 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0430 \u043d\u0430 \u0432\u0430\u0441</b>\n\n"
                f"\U0001f4dd {task.title}\n"
                f"\U0001f4c2 \u041f\u0440\u043e\u0435\u043a\u0442: {project.name}\n"
                f'\U0001f517 <a href="{frontend_url}/projects/{project.id}">\u041e\u0442\u043a\u0440\u044b\u0442\u044c</a>',
            )
        except Exception:
            pass

    # If moved to done, set completed_at
    new_status = data.status
    if new_status == "done" and old_status != "done":
        task.completed_at = datetime.utcnow()
    elif new_status and new_status != "done" and old_status == "done":
        task.completed_at = None

    await db.flush()

    # Recalculate progress if status changed
    if new_status and new_status != (old_status if isinstance(old_status, str) else old_status.value):
        await _recalc_progress(project_id, db)

    await db.commit()
    await db.refresh(task)
    return serialize_task(task)


async def delete_task(
    project_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a task."""
    org = await get_user_org(current_user, db)
    project = await db.get(Project, project_id)
    if not project or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="Project not found")
    if not await can_edit_project(project, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(ProjectTask).where(ProjectTask.id == task_id, ProjectTask.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(task)
    await db.flush()
    await _recalc_progress(project_id, db)
    await db.commit()


async def get_task_kanban(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get kanban board for project tasks."""
    result = await db.execute(
        select(ProjectTask)
        .where(
            ProjectTask.project_id == project_id,
            ProjectTask.status != TaskStatus.cancelled,
            ProjectTask.parent_task_id.is_(None),
        )
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.creator),
        )
        .order_by(ProjectTask.sort_order, ProjectTask.created_at)
    )
    tasks = list(result.scalars().unique().all())

    # Fetch custom statuses for this project
    status_result = await db.execute(
        select(ProjectTaskStatus)
        .where(ProjectTaskStatus.project_id == project_id)
        .order_by(ProjectTaskStatus.sort_order, ProjectTaskStatus.id)
    )
    custom_statuses = list(status_result.scalars().all())

    columns = []
    if custom_statuses:
        # Use custom statuses as columns
        for cs in custom_statuses:
            status_tasks = [t for t in tasks if (t.status if isinstance(t.status, str) else t.status.value) == cs.slug]
            columns.append(TaskKanbanColumn(
                status=cs.slug,
                title=cs.name,
                tasks=[serialize_task(t) for t in status_tasks],
                count=len(status_tasks),
            ))
    else:
        # Fallback to hardcoded statuses
        for status_key in TASK_STATUS_ORDER:
            status_tasks = [t for t in tasks if (t.status if isinstance(t.status, str) else t.status.value) == status_key]
            columns.append(TaskKanbanColumn(
                status=status_key,
                title=TASK_STATUS_LABELS.get(status_key, status_key),
                tasks=[serialize_task(t) for t in status_tasks],
                count=len(status_tasks),
            ))

    return TaskKanbanBoard(
        project_id=project_id,
        columns=columns,
        total_count=len(tasks),
    ).model_dump()


class BulkMoveRequest(BaseModel):
    task_ids: List[int]
    target_status: str


async def bulk_move_tasks(
    project_id: int,
    data: BulkMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk move tasks to a new status."""
    org = await get_user_org(current_user, db)
    project = await db.get(Project, project_id)
    if not project or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="Project not found")

    now = datetime.utcnow()
    result = await db.execute(
        select(ProjectTask).where(
            ProjectTask.id.in_(data.task_ids),
            ProjectTask.project_id == project_id,
        )
    )
    tasks = list(result.scalars().all())

    for task in tasks:
        task.status = data.target_status
        if data.target_status == "done":
            task.completed_at = now
        else:
            task.completed_at = None

    await db.flush()
    await _recalc_progress(project_id, db)
    await db.commit()

    return {"moved": len(tasks)}


async def get_all_tasks(
    status: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get tasks across ALL projects, grouped by project then status.
    Like ClickUp 'All Tasks' view.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=400, detail="User not in an organization")

    query = (
        select(ProjectTask)
        .join(Project, Project.id == ProjectTask.project_id)
        .where(Project.org_id == org.id)
        .where(ProjectTask.parent_task_id.is_(None))
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
        )
    )

    if status:
        query = query.where(ProjectTask.status == status)
    if assignee_id:
        query = query.where(ProjectTask.assignee_id == assignee_id)
    if search:
        query = query.where(ProjectTask.title.ilike(f"%{search}%"))

    # Only non-cancelled tasks by default
    query = query.where(ProjectTask.status != TaskStatus.cancelled)
    query = query.order_by(Project.name, ProjectTask.sort_order, ProjectTask.created_at)

    result = await db.execute(query)
    tasks = list(result.scalars().unique().all())

    # Filter by access if not admin
    full_access = await has_full_access(current_user, org, db)
    if not full_access:
        # Get project IDs user is a member of
        member_result = await db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == current_user.id)
        )
        member_project_ids = set(row[0] for row in member_result.all())
        tasks = [t for t in tasks if t.project_id in member_project_ids or t.project.created_by == current_user.id]

    # Group by project
    projects_map: dict = {}
    for task in tasks:
        pid = task.project_id
        if pid not in projects_map:
            projects_map[pid] = {
                "project_id": pid,
                "project_name": task.project.name if task.project else f"Project {pid}",
                "project_color": task.project.color if task.project else None,
                "project_status": task.project.status if isinstance(task.project.status, str) else task.project.status.value if task.project else None,
                "status_groups": {},
            }

        task_status = task.status if isinstance(task.status, str) else task.status.value
        if task_status not in projects_map[pid]["status_groups"]:
            projects_map[pid]["status_groups"][task_status] = []

        projects_map[pid]["status_groups"][task_status].append(serialize_task(task))

    return list(projects_map.values())


async def get_subtasks(
    project_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get subtasks of a specific task."""
    org = await get_user_org(current_user, db)
    project = await db.get(Project, project_id)
    if not project or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify parent task exists
    parent = await db.execute(
        select(ProjectTask).where(
            ProjectTask.id == task_id,
            ProjectTask.project_id == project_id,
        )
    )
    if not parent.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(ProjectTask)
        .where(
            ProjectTask.parent_task_id == task_id,
            ProjectTask.project_id == project_id,
        )
        .options(
            selectinload(ProjectTask.assignee),
            selectinload(ProjectTask.time_logs),
            selectinload(ProjectTask.subtasks),
            selectinload(ProjectTask.comments),
            selectinload(ProjectTask.attachments),
            selectinload(ProjectTask.project),
            selectinload(ProjectTask.creator),
        )
        .order_by(ProjectTask.sort_order, ProjectTask.created_at)
    )
    subtasks = list(result.scalars().unique().all())
    return [serialize_task(t) for t in subtasks]
