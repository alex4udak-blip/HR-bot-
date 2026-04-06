"""
Application management endpoints for vacancies.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime

from .common import (
    logger, get_db, Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Entity, EntityType, User, STAGE_SYNC_MAP, STATUS_SYNC_MAP,
    ApplicationCreate, ApplicationUpdate, ApplicationResponse,
    check_vacancy_access, can_access_vacancy
)
from ...services.auth import get_user_org

router = APIRouter()


@router.get("/{vacancy_id}/applications", response_model=List[ApplicationResponse])
async def list_applications(
    vacancy_id: int,
    stage: Optional[ApplicationStage] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """List all applications for a vacancy (with access control)."""
    org = await get_user_org(current_user, db)

    # Verify vacancy exists
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id)
    )
    vacancy = vacancy_result.scalar()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check access rights
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    query = (
        select(VacancyApplication)
        .where(VacancyApplication.vacancy_id == vacancy_id)
        .order_by(VacancyApplication.stage_order, VacancyApplication.applied_at)
    )

    if stage:
        query = query.where(VacancyApplication.stage == stage)

    result = await db.execute(query)
    applications = result.scalars().all()

    responses = []
    for app in applications:
        # Get entity info
        entity_result = await db.execute(
            select(Entity).where(Entity.id == app.entity_id)
        )
        entity = entity_result.scalar()

        responses.append(ApplicationResponse(
            id=app.id,
            vacancy_id=app.vacancy_id,
            entity_id=app.entity_id,
            entity_name=entity.name if entity else None,
            entity_type=entity.type if entity else None,
            entity_email=entity.email if entity else None,
            entity_phone=entity.phone if entity else None,
            entity_position=entity.position if entity else None,
            stage=app.stage,
            stage_order=app.stage_order or 0,
            rating=app.rating,
            notes=app.notes,
            rejection_reason=app.rejection_reason,
            interview_summary=app.interview_summary,
            source=app.source,
            next_interview_at=app.next_interview_at,
            applied_at=app.applied_at,
            last_stage_change_at=app.last_stage_change_at,
            updated_at=app.updated_at
        ))

    return responses


@router.post("/{vacancy_id}/applications", response_model=ApplicationResponse, status_code=201)
async def create_application(
    vacancy_id: int,
    data: ApplicationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Add a candidate to a vacancy pipeline (with access control)."""
    # Get user's organization
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    # Verify vacancy exists and belongs to user's organization
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = vacancy_result.scalar()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check access rights to this vacancy
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Verify entity exists and belongs to same organization
    entity_result = await db.execute(
        select(Entity).where(Entity.id == data.entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found in your organization")

    # Security: Explicit cross-organization check
    if vacancy.org_id != entity.org_id:
        logger.warning(
            f"Cross-org application attempt: user {current_user.id} tried to add "
            f"entity {entity.id} (org {entity.org_id}) to vacancy {vacancy.id} (org {vacancy.org_id})"
        )
        raise HTTPException(
            status_code=403,
            detail="Cannot add candidate from different organization"
        )

    # Check if candidate is already in ANY active vacancy (one candidate = max one vacancy)
    existing_any_vacancy = await db.execute(
        select(VacancyApplication)
        .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
        .where(
            VacancyApplication.entity_id == data.entity_id,
            Vacancy.status != VacancyStatus.closed  # Only active vacancies
        )
    )
    existing_app = existing_any_vacancy.scalar()
    if existing_app:
        # Get vacancy title for better error message
        existing_vacancy_result = await db.execute(
            select(Vacancy.title).where(Vacancy.id == existing_app.vacancy_id)
        )
        existing_vacancy_title = existing_vacancy_result.scalar() or "другую вакансию"
        raise HTTPException(
            status_code=400,
            detail=f"Кандидат уже добавлен в вакансию \"{existing_vacancy_title}\". Сначала удалите его оттуда."
        )

    # Use candidate's current Entity.status as initial stage (converted via STATUS_SYNC_MAP)
    initial_stage = data.stage
    if entity.status in STATUS_SYNC_MAP:
        initial_stage = STATUS_SYNC_MAP[entity.status]
        logger.info(f"Using entity status {entity.status} -> stage {initial_stage} for new application")

    # Get max stage_order for this stage
    # Note: FOR UPDATE cannot be used with aggregate functions in PostgreSQL
    # Race condition is acceptable here as stage_order is just for display ordering
    max_order_result = await db.execute(
        select(func.max(VacancyApplication.stage_order))
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == initial_stage
        )
    )
    max_order = max_order_result.scalar() or 0

    application = VacancyApplication(
        vacancy_id=vacancy_id,
        entity_id=data.entity_id,
        stage=initial_stage,
        stage_order=max_order + 1,
        rating=data.rating,
        notes=data.notes,
        source=data.source,
        created_by=current_user.id
    )

    db.add(application)

    # Sync Entity.status if the application stage differs from current entity status
    # This ensures Entity.status matches VacancyApplication.stage
    if initial_stage in STAGE_SYNC_MAP:
        expected_entity_status = STAGE_SYNC_MAP[initial_stage]
        if entity.status != expected_entity_status:
            entity.status = expected_entity_status
            entity.updated_at = datetime.utcnow()
            logger.info(f"POST /applications: Synchronized entity {entity.id} status to {expected_entity_status} (from stage {initial_stage})")

    await db.commit()
    await db.refresh(application)

    # Record initial stage transition
    from ...services.stage_transitions import record_transition
    await record_transition(
        db=db,
        application_id=application.id,
        entity_id=data.entity_id,
        from_stage=None,
        to_stage=initial_stage.value,
        changed_by_id=current_user.id,
        comment="Initial application",
    )
    await db.commit()

    # --- Notification: new candidate added ---
    try:
        from ...services.hr_notifications import notify_new_candidate
        await notify_new_candidate(db, entity, vacancy, current_user)
    except Exception:
        logger.exception("notify_new_candidate failed (non-critical)")

    logger.info(f"Created application {application.id} for vacancy {vacancy_id}")

    return ApplicationResponse(
        id=application.id,
        vacancy_id=application.vacancy_id,
        entity_id=application.entity_id,
        entity_name=entity.name,
        entity_type=entity.type,
        entity_email=entity.email,
        entity_phone=entity.phone,
        entity_position=entity.position,
        stage=application.stage,
        stage_order=application.stage_order or 0,
        rating=application.rating,
        notes=application.notes,
        rejection_reason=application.rejection_reason,
        interview_summary=application.interview_summary,
        source=application.source,
        next_interview_at=application.next_interview_at,
        applied_at=application.applied_at,
        last_stage_change_at=application.last_stage_change_at,
        updated_at=application.updated_at
    )


@router.put("/applications/{application_id}", response_model=ApplicationResponse)
async def update_application(
    application_id: int,
    data: ApplicationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Update an application (move stage, add notes, etc.) - with access control."""
    from .kanban import rebalance_stage_orders
    from ...services.stage_transitions import record_transition

    org = await get_user_org(current_user, db)

    result = await db.execute(
        select(VacancyApplication).where(VacancyApplication.id == application_id)
    )
    application = result.scalar()

    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Get the vacancy to check access
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == application.vacancy_id)
    )
    vacancy = vacancy_result.scalar()
    if vacancy and not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Save old values for notifications
    old_stage = application.stage
    old_interview_at = application.next_interview_at

    # Validate: interview_summary required before moving to practice stage
    if data.stage == ApplicationStage.phone_screen and data.stage != application.stage:
        summary = data.interview_summary if hasattr(data, 'interview_summary') and data.interview_summary else application.interview_summary
        if not summary or not summary.strip():
            raise HTTPException(
                status_code=400,
                detail="Необходимо заполнить итог собеседования перед переводом на практику"
            )

    # Track stage change
    if data.stage and data.stage != application.stage:
        application.last_stage_change_at = datetime.utcnow()

        # Update stage_order for the new stage
        # Note: FOR UPDATE cannot be used with aggregate functions in PostgreSQL
        # Race condition is acceptable here as stage_order is just for display ordering
        max_order_result = await db.execute(
            select(func.max(VacancyApplication.stage_order))
            .where(
                VacancyApplication.vacancy_id == application.vacancy_id,
                VacancyApplication.stage == data.stage
            )
        )
        max_order = max_order_result.scalar() or 0
        application.stage_order = max_order + 1

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field != 'stage_order' or data.stage_order is not None:  # Don't override auto-calculated order
            setattr(application, field, value)

    # Check if stage_order went negative and rebalance if needed
    if application.stage_order is not None and application.stage_order < 0:
        await rebalance_stage_orders(db, application.vacancy_id, application.stage)

    # Synchronize with entity status
    if data.stage and data.stage in STAGE_SYNC_MAP:
        new_status = STAGE_SYNC_MAP[data.stage]
        # Get entity and update its status
        entity_result = await db.execute(
            select(Entity).where(Entity.id == application.entity_id)
        )
        entity_to_sync = entity_result.scalar()
        if entity_to_sync and entity_to_sync.status != new_status:
            entity_to_sync.status = new_status
            entity_to_sync.updated_at = datetime.utcnow()
            logger.info(f"Synchronized application {application_id} stage {data.stage} to entity {application.entity_id} status {new_status}")

    # Record stage transition in audit log
    if data.stage and data.stage != old_stage:
        await record_transition(
            db=db,
            application_id=application.id,
            entity_id=application.entity_id,
            from_stage=old_stage.value if old_stage else None,
            to_stage=data.stage.value,
            changed_by_id=current_user.id,
        )

    await db.commit()
    await db.refresh(application)

    # Get entity info
    entity_result = await db.execute(
        select(Entity).where(Entity.id == application.entity_id)
    )
    entity = entity_result.scalar()

    # Get vacancy title
    vacancy_result = await db.execute(
        select(Vacancy.title).where(Vacancy.id == application.vacancy_id)
    )
    vacancy_title = vacancy_result.scalar()

    # --- Notifications (fire-and-forget) ---
    try:
        from ...services.hr_notifications import (
            notify_stage_change, notify_interview_scheduled, notify_practice_started,
        )

        # Stage change notification
        if data.stage and data.stage != old_stage and entity:
            await notify_stage_change(
                db, application, entity, old_stage, data.stage, current_user
            )
            # Practice started
            if data.stage == ApplicationStage.phone_screen:
                await notify_practice_started(db, application, entity, current_user)

        # Interview scheduled notification
        if (
            data.next_interview_at
            and data.next_interview_at != old_interview_at
            and entity
        ):
            await notify_interview_scheduled(
                db, application, entity, data.next_interview_at, current_user
            )
    except Exception:
        logger.exception("Update-application notifications failed (non-critical)")

    logger.info(f"Updated application {application.id}, stage: {application.stage}")

    return ApplicationResponse(
        id=application.id,
        vacancy_id=application.vacancy_id,
        vacancy_title=vacancy_title,
        entity_id=application.entity_id,
        entity_name=entity.name if entity else None,
        entity_type=entity.type if entity else None,
        entity_email=entity.email if entity else None,
        entity_phone=entity.phone if entity else None,
        entity_position=entity.position if entity else None,
        stage=application.stage,
        stage_order=application.stage_order or 0,
        rating=application.rating,
        notes=application.notes,
        rejection_reason=application.rejection_reason,
        interview_summary=application.interview_summary,
        source=application.source,
        next_interview_at=application.next_interview_at,
        applied_at=application.applied_at,
        last_stage_change_at=application.last_stage_change_at,
        updated_at=application.updated_at
    )


@router.delete("/applications/{application_id}", status_code=204)
async def delete_application(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Remove a candidate from a vacancy pipeline (with access control)."""
    from ...models.database import EntityStatus

    org = await get_user_org(current_user, db)

    result = await db.execute(
        select(VacancyApplication).where(VacancyApplication.id == application_id)
    )
    application = result.scalar()

    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Get the vacancy to check access
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == application.vacancy_id)
    )
    vacancy = vacancy_result.scalar()
    if vacancy and not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Get the entity to reset its status
    entity_id = application.entity_id
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = entity_result.scalar()

    await db.delete(application)

    # Reset Entity.status to 'new' since candidate is no longer in any vacancy
    if entity:
        entity.status = EntityStatus.new
        entity.updated_at = datetime.utcnow()
        logger.info(f"DELETE /applications/{application_id}: Reset entity {entity_id} status to 'new'")

    await db.commit()

    logger.info(f"Deleted application {application_id}")
