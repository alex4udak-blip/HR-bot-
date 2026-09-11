"""
Stage transition history endpoints for vacancy applications.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from .common import (
    logger, get_db, VacancyApplication, Vacancy, User, ApplicationStage,
    Entity, STAGE_SYNC_MAP, check_vacancy_access, can_access_vacancy
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


async def delete_application_history(
    application_id: int,
    history_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access),
):
    """Delete a single stage-transition history entry (ошибочная запись)."""
    org = await get_user_org(current_user, db)

    app_result = await db.execute(
        select(VacancyApplication).where(VacancyApplication.id == application_id)
    )
    application = app_result.scalar()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == application.vacancy_id)
    )
    vacancy = vacancy_result.scalar()
    if vacancy and not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    tr_result = await db.execute(
        select(StageTransition).where(
            StageTransition.id == history_id,
            StageTransition.application_id == application_id,
        )
    )
    transition = tr_result.scalar()
    if not transition:
        raise HTTPException(status_code=404, detail="History entry not found")

    # Удаляют ПОСЛЕДНИЙ переход, который и привёл заявку в текущий этап, —
    # значит, этот этап ошибочный: возвращаем заявку туда, откуда она пришла.
    # Раньше удалялась только запись, а кандидат оставался на «удалённом» этапе
    # (2026-09-11, Мария: Каспер и Глушко висели в «Интервью с HR»). Более
    # старые записи и начальная «Этап: Новый» этап не трогают.
    reverted_to = None
    latest_id = (await db.execute(
        select(StageTransition.id)
        .where(StageTransition.application_id == application_id)
        .order_by(StageTransition.created_at.desc(), StageTransition.id.desc())
        .limit(1)
    )).scalar()
    current_stage = application.stage.value if application.stage else None
    if (
        latest_id == transition.id
        and transition.from_stage
        and transition.from_stage != transition.to_stage
        and transition.to_stage == current_stage
    ):
        try:
            prev_stage = ApplicationStage(transition.from_stage)
        except ValueError:
            prev_stage = None
        if prev_stage is not None:
            max_order = (await db.execute(
                select(func.max(VacancyApplication.stage_order)).where(
                    VacancyApplication.vacancy_id == application.vacancy_id,
                    VacancyApplication.stage == prev_stage,
                )
            )).scalar() or 0
            application.stage = prev_stage
            application.stage_order = max_order + 1
            application.last_stage_change_at = datetime.utcnow()
            if prev_stage in STAGE_SYNC_MAP:
                entity = (await db.execute(
                    select(Entity).where(Entity.id == application.entity_id)
                )).scalar()
                new_status = STAGE_SYNC_MAP[prev_stage]
                if entity and entity.status != new_status:
                    entity.status = new_status
                    entity.updated_at = datetime.utcnow()
            reverted_to = prev_stage.value
            logger.info(
                f"Application {application_id}: history {history_id} deleted, "
                f"stage reverted {transition.to_stage} -> {reverted_to}"
            )

    await db.delete(transition)
    await db.commit()
    return {"success": True, "reverted_to": reverted_to}
