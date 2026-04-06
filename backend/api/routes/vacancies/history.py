"""
Stage transition history endpoints for vacancy applications.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from .common import (
    logger, get_db, VacancyApplication, Vacancy, User,
    check_vacancy_access, can_access_vacancy
)
from ...models.database import StageTransition
from ...services.auth import get_user_org

router = APIRouter()


class StageTransitionResponse(BaseModel):
    id: int
    application_id: int
    entity_id: int
    from_stage: Optional[str] = None
    to_stage: str
    changed_by: Optional[int] = None
    changed_by_name: Optional[str] = None
    comment: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


async def get_application_history(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access),
) -> List[StageTransitionResponse]:
    """Get all stage transitions for an application, ordered by created_at desc."""
    org = await get_user_org(current_user, db)

    # Get the application
    app_result = await db.execute(
        select(VacancyApplication).where(VacancyApplication.id == application_id)
    )
    application = app_result.scalar()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Get the vacancy for access check
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == application.vacancy_id)
    )
    vacancy = vacancy_result.scalar()
    if vacancy and not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Fetch transitions
    result = await db.execute(
        select(StageTransition)
        .where(StageTransition.application_id == application_id)
        .order_by(StageTransition.created_at.desc())
    )
    transitions = result.scalars().all()

    # Bulk load user names for changed_by
    user_ids = [t.changed_by for t in transitions if t.changed_by]
    user_names = {}
    if user_ids:
        users_result = await db.execute(
            select(User.id, User.name).where(User.id.in_(user_ids))
        )
        user_names = {row[0]: row[1] for row in users_result.all()}

    return [
        StageTransitionResponse(
            id=t.id,
            application_id=t.application_id,
            entity_id=t.entity_id,
            from_stage=t.from_stage,
            to_stage=t.to_stage,
            changed_by=t.changed_by,
            changed_by_name=user_names.get(t.changed_by),
            comment=t.comment,
            created_at=t.created_at,
        )
        for t in transitions
    ]
