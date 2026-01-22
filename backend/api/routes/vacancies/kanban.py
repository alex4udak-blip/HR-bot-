"""
Kanban board endpoints for vacancy management.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from datetime import datetime

from .common import (
    logger, get_db, Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Entity, User, STAGE_SYNC_MAP,
    ApplicationResponse, KanbanColumn, KanbanBoard, BulkStageUpdate,
    check_vacancy_access, can_access_vacancy
)
from ...services.auth import get_user_org

router = APIRouter()


@router.get("/{vacancy_id}/kanban", response_model=KanbanBoard)
async def get_kanban_board(
    vacancy_id: int,
    limit_per_column: int = Query(50, ge=1, le=200, description="Max candidates per column"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Get Kanban board data for a vacancy with pagination per column (with access control)."""
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

    # Define stage order and titles (using existing DB enum values with HR labels)
    # Mapping: applied=Novyj, screening=Skrining, phone_screen=Praktika,
    #          interview=Tekh-praktika, assessment=IS, offer=Offer, hired=Prinyat, rejected=Otkaz
    stage_config = [
        (ApplicationStage.applied, "Novyj", [ApplicationStage.applied]),
        (ApplicationStage.screening, "Skrining", [ApplicationStage.screening]),
        (ApplicationStage.phone_screen, "Praktika", [ApplicationStage.phone_screen]),
        (ApplicationStage.interview, "Tekh-praktika", [ApplicationStage.interview]),
        (ApplicationStage.assessment, "IS", [ApplicationStage.assessment]),
        (ApplicationStage.offer, "Offer", [ApplicationStage.offer]),
        (ApplicationStage.hired, "Prinyat", [ApplicationStage.hired]),
        (ApplicationStage.rejected, "Otkaz", [ApplicationStage.rejected]),
    ]

    # Get total counts per stage (for UI to show "X more" indicators)
    counts_result = await db.execute(
        select(VacancyApplication.stage, func.count(VacancyApplication.id))
        .where(VacancyApplication.vacancy_id == vacancy_id)
        .group_by(VacancyApplication.stage)
    )
    stage_total_counts = {row[0]: row[1] for row in counts_result.all()}

    # Get applications per stage with limit (optimized queries)
    all_apps = []
    for display_stage, _, query_stages in stage_config:
        stage_result = await db.execute(
            select(VacancyApplication)
            .where(
                VacancyApplication.vacancy_id == vacancy_id,
                VacancyApplication.stage.in_(query_stages)
            )
            .order_by(VacancyApplication.stage_order, VacancyApplication.applied_at)
            .limit(limit_per_column)
        )
        all_apps.extend(stage_result.scalars().all())

    # Get entity info for all loaded applications (bulk load)
    entity_ids = [app.entity_id for app in all_apps]
    entities_map = {}
    if entity_ids:
        entities_result = await db.execute(
            select(Entity).where(Entity.id.in_(entity_ids))
        )
        for entity in entities_result.scalars().all():
            entities_map[entity.id] = entity

    # Build columns with pagination info
    columns = []
    total_count = sum(stage_total_counts.values())

    for display_stage, title, query_stages in stage_config:
        # Filter apps that belong to this column (including legacy stages)
        stage_apps = [app for app in all_apps if app.stage in query_stages]
        # Sum counts for all stages in this column
        stage_total = sum(stage_total_counts.get(s, 0) for s in query_stages)

        app_responses = []
        for app in stage_apps:
            entity = entities_map.get(app.entity_id)
            app_responses.append(ApplicationResponse(
                id=app.id,
                vacancy_id=app.vacancy_id,
                vacancy_title=vacancy.title,
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
                source=app.source,
                next_interview_at=app.next_interview_at,
                applied_at=app.applied_at,
                last_stage_change_at=app.last_stage_change_at,
                updated_at=app.updated_at
            ))

        columns.append(KanbanColumn(
            stage=display_stage,
            title=title,
            applications=app_responses,
            count=len(app_responses),
            total_count=stage_total,
            has_more=len(app_responses) < stage_total
        ))

    return KanbanBoard(
        vacancy_id=vacancy.id,
        vacancy_title=vacancy.title,
        columns=columns,
        total_count=total_count
    )


@router.get("/{vacancy_id}/kanban/column/{stage}", response_model=KanbanColumn)
async def get_kanban_column(
    vacancy_id: int,
    stage: ApplicationStage,
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(50, ge=1, le=200, description="Max candidates to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Get paginated candidates for a specific Kanban column (with access control).

    This endpoint is used for loading more candidates in a column (infinite scroll).
    """
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

    # Define stage titles (HR Pipeline stages - using existing DB enum values)
    stage_titles = {
        ApplicationStage.applied: "Novyj",
        ApplicationStage.screening: "Skrining",
        ApplicationStage.phone_screen: "Praktika",
        ApplicationStage.interview: "Tekh-praktika",
        ApplicationStage.assessment: "IS",
        ApplicationStage.offer: "Offer",
        ApplicationStage.hired: "Prinyat",
        ApplicationStage.rejected: "Otkaz",
        ApplicationStage.withdrawn: "Otozvan",
    }

    # Get total count for this stage
    total_count_result = await db.execute(
        select(func.count(VacancyApplication.id))
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == stage
        )
    )
    total_count = total_count_result.scalar() or 0

    # Get applications with pagination
    apps_result = await db.execute(
        select(VacancyApplication)
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == stage
        )
        .order_by(VacancyApplication.stage_order, VacancyApplication.applied_at)
        .offset(skip)
        .limit(limit)
    )
    applications = apps_result.scalars().all()

    # Bulk load entities
    entity_ids = [app.entity_id for app in applications]
    entities_map = {}
    if entity_ids:
        entities_result = await db.execute(
            select(Entity).where(Entity.id.in_(entity_ids))
        )
        for entity in entities_result.scalars().all():
            entities_map[entity.id] = entity

    # Build response
    app_responses = []
    for app in applications:
        entity = entities_map.get(app.entity_id)
        app_responses.append(ApplicationResponse(
            id=app.id,
            vacancy_id=app.vacancy_id,
            vacancy_title=vacancy.title,
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
            source=app.source,
            next_interview_at=app.next_interview_at,
            applied_at=app.applied_at,
            last_stage_change_at=app.last_stage_change_at,
            updated_at=app.updated_at
        ))

    return KanbanColumn(
        stage=stage,
        title=stage_titles.get(stage, str(stage.value)),
        applications=app_responses,
        count=len(app_responses),
        total_count=total_count,
        has_more=(skip + len(app_responses)) < total_count
    )


async def rebalance_stage_orders(
    db: AsyncSession,
    vacancy_id: int,
    stage: ApplicationStage
) -> None:
    """Rebalance all stage_order values in a column to prevent negative numbers.

    This function reassigns sequential positive order values (starting from 1000)
    to all applications in a given stage, preserving their relative order.
    Uses a starting value of 1000 with gaps to leave room for future insertions.
    """
    # Get all applications in this stage ordered by current stage_order
    result = await db.execute(
        select(VacancyApplication)
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == stage
        )
        .order_by(VacancyApplication.stage_order, VacancyApplication.applied_at)
    )
    applications = result.scalars().all()

    # Reassign sequential orders starting from 1000 with gaps of 1000
    for i, app in enumerate(applications):
        app.stage_order = (i + 1) * 1000

    logger.info(f"Rebalanced {len(applications)} applications in stage {stage} for vacancy {vacancy_id}")


@router.post("/applications/bulk-move", response_model=List[ApplicationResponse])
async def bulk_move_applications(
    data: BulkStageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Move multiple applications to a new stage (with access control)."""
    if not data.application_ids:
        return []

    # Get user's organization
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    result = await db.execute(
        select(VacancyApplication).where(
            VacancyApplication.id.in_(data.application_ids)
        )
    )
    applications = result.scalars().all()

    if not applications:
        raise HTTPException(status_code=404, detail="No applications found")

    # Get the vacancy_id from first application
    vacancy_id = applications[0].vacancy_id

    # Verify vacancy exists and belongs to user's organization
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = vacancy_result.scalar()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found in your organization")

    # Check vacancy-level access rights
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Verify all applications belong to the same vacancy
    for app in applications:
        if app.vacancy_id != vacancy_id:
            raise HTTPException(
                status_code=400,
                detail="All applications must belong to the same vacancy"
            )

    # Verify all entities belong to the same organization
    entity_ids = [app.entity_id for app in applications]
    entities_result = await db.execute(
        select(Entity).where(Entity.id.in_(entity_ids))
    )
    entities_map = {e.id: e for e in entities_result.scalars().all()}

    for app in applications:
        entity = entities_map.get(app.entity_id)
        if not entity:
            raise HTTPException(
                status_code=404,
                detail=f"Entity {app.entity_id} not found"
            )
        if entity.org_id != org.id:
            logger.warning(
                f"Cross-org bulk-move attempt: user {current_user.id} tried to move "
                f"entity {entity.id} (org {entity.org_id}) in vacancy {vacancy_id} (org {org.id})"
            )
            raise HTTPException(
                status_code=403,
                detail=f"Entity {entity.id} does not belong to your organization"
            )

    # Get max stage_order for the new stage
    # SECURITY: Use FOR UPDATE to prevent race condition in bulk move
    max_order_result = await db.execute(
        select(func.max(VacancyApplication.stage_order))
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == data.stage
        )
        .with_for_update()
    )
    max_order = max_order_result.scalar() or 0

    now = datetime.utcnow()

    # Synchronize VacancyApplication.stage -> Entity.status
    new_entity_status = STAGE_SYNC_MAP.get(data.stage)

    for i, app in enumerate(applications):
        app.stage = data.stage
        app.stage_order = max_order + (i + 1) * 1000
        app.last_stage_change_at = now

        # Sync entity status
        if new_entity_status:
            entity = entities_map.get(app.entity_id)
            if entity and entity.status != new_entity_status:
                entity.status = new_entity_status
                entity.updated_at = now
                logger.info(f"bulk-move: Synchronized application {app.id} stage {data.stage} -> entity {entity.id} status {new_entity_status}")

    await db.commit()

    # Build response using already loaded entities
    responses = []
    for app in applications:
        entity = entities_map.get(app.entity_id)
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
            source=app.source,
            next_interview_at=app.next_interview_at,
            applied_at=app.applied_at,
            last_stage_change_at=app.last_stage_change_at,
            updated_at=app.updated_at
        ))

    logger.info(f"Bulk moved {len(applications)} applications to stage {data.stage}")

    return responses
