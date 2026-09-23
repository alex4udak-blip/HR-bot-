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
    logger, get_db, VacancyApplication, Vacancy, User,
    check_vacancy_access, can_access_vacancy, recompute_entity_status,
)
from ...models.database import StageTransition, ApplicationStage, Entity
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
    """Удалить запись истории этапов.

    ПОСЛЕДНЯЯ запись = сам перевод, которым кандидат попал на текущий этап:
    удаляя её, рекрутёр отменяет ошибочный перевод, поэтому заявка едет обратно
    на from_stage (запрос рекрутёров 2026-09-23; до этого этап оставался на
    месте, и карточка Махровой висела в «Практике» без единой записи о том, как
    туда попала).

    СТАРЫЕ записи (выше по ленте) — только чистка лога: этап не трогаем, иначе
    удаление записи из середины истории отправляло бы кандидата в прошлое.
    """
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

    # Самая свежая запись заявки. id вторым ключом: у импортов и быстрых
    # переводов created_at совпадает до секунды.
    latest = (await db.execute(
        select(StageTransition)
        .where(StageTransition.application_id == application_id)
        .order_by(StageTransition.created_at.desc(), StageTransition.id.desc())
        .limit(1)
    )).scalar()

    current_stage = application.stage.value if application.stage else None
    rollback_stage: Optional[ApplicationStage] = None
    if (
        latest is not None
        and latest.id == transition.id
        and transition.from_stage
        and transition.to_stage == current_stage
    ):
        # from_stage мог быть кастомным/устаревшим ключом — тогда отката нет,
        # просто удаляем запись (лучше оставить этап, чем уронить 500).
        try:
            rollback_stage = ApplicationStage(transition.from_stage)
        except ValueError:
            rollback_stage = None

    if rollback_stage is not None:
        max_order = (await db.execute(
            select(func.max(VacancyApplication.stage_order)).where(
                VacancyApplication.vacancy_id == application.vacancy_id,
                VacancyApplication.stage == rollback_stage,
            )
        )).scalar() or 0
        application.stage = rollback_stage
        application.stage_order = max_order + 1
        application.last_stage_change_at = datetime.utcnow()
        await db.flush()
        await recompute_entity_status(db, application.entity_id)
        logger.info(
            "HISTORY_UNDO: user=%s app=%s entity=%s запись %s (%s -> %s) удалена, "
            "заявка возвращена на %s",
            current_user.id, application.id, application.entity_id, transition.id,
            transition.from_stage, transition.to_stage, rollback_stage.value,
        )
    else:
        logger.info(
            "HISTORY_DELETE: user=%s app=%s entity=%s запись %s (%s -> %s) удалена, "
            "этап заявки остаётся %s",
            current_user.id, application.id, application.entity_id, transition.id,
            transition.from_stage, transition.to_stage, current_stage,
        )

    await db.delete(transition)
    await db.commit()

    entity_status = (await db.execute(
        select(Entity.status).where(Entity.id == application.entity_id)
    )).scalar()
    return {
        "success": True,
        # Фронт по этим полям переставляет карточку НА МЕСТЕ, без перезагрузки.
        "rolled_back": rollback_stage is not None,
        "stage": application.stage.value if application.stage else None,
        "entity_status": entity_status.value if entity_status else None,
    }
