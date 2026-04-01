"""
Task comments — CRUD for comment threads on project tasks.
"""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel

from .common import (
    logger,
    Project, ProjectTask, User,
    has_full_access, can_access_project,
    get_db, get_current_user, get_user_org,
    Organization,
)
from ...models.database import TaskComment


# === Schemas ===

class CommentCreate(BaseModel):
    content: str


class CommentUpdate(BaseModel):
    content: str


class CommentResponse(BaseModel):
    id: int
    task_id: int
    user_id: int
    user_name: Optional[str] = None
    content: str
    edited_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# === Helpers ===

def serialize_comment(c: TaskComment) -> dict:
    return CommentResponse(
        id=c.id,
        task_id=c.task_id,
        user_id=c.user_id,
        user_name=c.user.name if c.user else None,
        content=c.content,
        edited_at=c.edited_at,
        created_at=c.created_at,
    ).model_dump()


async def _get_project_and_task(
    project_id: int,
    task_id: int,
    org: Organization,
    db: AsyncSession,
) -> tuple:
    """Fetch and validate project + task, raise 404 if not found."""
    project = await db.get(Project, project_id)
    if not project or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ProjectTask).where(
            ProjectTask.id == task_id,
            ProjectTask.project_id == project_id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return project, task


# === Endpoints ===

async def list_comments(
    project_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[dict]:
    """List all comments for a task, ordered by created_at."""
    org = await get_user_org(current_user, db)
    project, task = await _get_project_and_task(project_id, task_id, org, db)

    result = await db.execute(
        select(TaskComment)
        .where(TaskComment.task_id == task_id)
        .options(selectinload(TaskComment.user))
        .order_by(TaskComment.created_at)
    )
    comments = list(result.scalars().all())
    return [serialize_comment(c) for c in comments]


async def create_comment(
    project_id: int,
    task_id: int,
    data: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Create a comment on a task. Any project member can comment."""
    org = await get_user_org(current_user, db)
    project, task = await _get_project_and_task(project_id, task_id, org, db)

    if not data.content or not data.content.strip():
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")

    comment = TaskComment(
        task_id=task_id,
        user_id=current_user.id,
        content=data.content.strip(),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    # Reload with user relationship
    result = await db.execute(
        select(TaskComment)
        .where(TaskComment.id == comment.id)
        .options(selectinload(TaskComment.user))
    )
    comment = result.scalar_one()
    return serialize_comment(comment)


async def update_comment(
    project_id: int,
    task_id: int,
    comment_id: int,
    data: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Edit a comment. Only the author or admin can edit."""
    org = await get_user_org(current_user, db)
    project, task = await _get_project_and_task(project_id, task_id, org, db)

    result = await db.execute(
        select(TaskComment)
        .where(TaskComment.id == comment_id, TaskComment.task_id == task_id)
        .options(selectinload(TaskComment.user))
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Only author or admin can edit
    is_admin = await has_full_access(current_user, org, db)
    if comment.user_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Can only edit your own comments")

    if not data.content or not data.content.strip():
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")

    comment.content = data.content.strip()
    comment.edited_at = datetime.utcnow()
    await db.commit()
    await db.refresh(comment)

    return serialize_comment(comment)


async def delete_comment(
    project_id: int,
    task_id: int,
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a comment. Only the author or admin can delete."""
    org = await get_user_org(current_user, db)
    project, task = await _get_project_and_task(project_id, task_id, org, db)

    result = await db.execute(
        select(TaskComment).where(TaskComment.id == comment_id, TaskComment.task_id == task_id)
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Only author or admin can delete
    is_admin = await has_full_access(current_user, org, db)
    if comment.user_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Can only delete your own comments")

    await db.delete(comment)
    await db.commit()
