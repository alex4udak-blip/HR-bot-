"""
Kanban board endpoints for vacancy management.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime, date

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
    created_by: Optional[int] = Query(None, description="Filter by recruiter (user who created the application)"),
    applied_after: Optional[date] = Query(None, description="Filter applications created on or after this date"),
    applied_before: Optional[date] = Query(None, description="Filter applications created on or before this date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Get Kanban board data for a vacancy with pagination per column (with access control).

    Supports filtering by recruiter (created_by) and date range (applied_after/applied_before).
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

    # Derive stage_config from vacancy.custom_stages when present,
    # falling back to the default HR pipeline.
    default_stage_config = [
        (ApplicationStage.applied, "Новый", [ApplicationStage.applied]),
        (ApplicationStage.screening, "Отбор", [ApplicationStage.screening]),
        (ApplicationStage.phone_screen, "Собеседование назначено", [ApplicationStage.phone_screen]),
        (ApplicationStage.interview, "Собеседование пройдено", [ApplicationStage.interview]),
        (ApplicationStage.assessment, "Практика", [ApplicationStage.assessment]),
        (ApplicationStage.offer, "Оффер", [ApplicationStage.offer]),
        (ApplicationStage.hired, "Вышел на работу", [ApplicationStage.hired]),
        (ApplicationStage.rejected, "Отказ", [ApplicationStage.rejected]),
    ]

    custom_columns = (vacancy.custom_stages or {}).get("columns") if vacancy.custom_stages else None
    if custom_columns and isinstance(custom_columns, list) and len(custom_columns) > 0:
        stage_config = []
        seen = set()
        for col in custom_columns:
            if not col.get("visible", True):
                continue
            enum_key = col.get("maps_to") or col.get("key")
            if not enum_key or enum_key in seen:
                continue
            # Validate that enum_key is a real ApplicationStage value
            try:
                stage_enum = ApplicationStage(enum_key)
            except ValueError:
                logger.warning(f"Unknown custom stage key '{enum_key}' in vacancy {vacancy_id}, skipping")
                continue
            seen.add(enum_key)
            stage_config.append((stage_enum, col.get("label", enum_key), [stage_enum]))
    else:
        stage_config = default_stage_config

    # Build base filter conditions
    base_filters = [VacancyApplication.vacancy_id == vacancy_id]
    if created_by is not None:
        base_filters.append(VacancyApplication.created_by == created_by)
    if applied_after is not None:
        base_filters.append(VacancyApplication.applied_at >= datetime.combine(applied_after, datetime.min.time()))
    if applied_before is not None:
        base_filters.append(VacancyApplication.applied_at <= datetime.combine(applied_before, datetime.max.time()))

    # Get total counts per stage (for UI to show "X more" indicators)
    counts_result = await db.execute(
        select(VacancyApplication.stage, func.count(VacancyApplication.id))
        .where(*base_filters)
        .group_by(VacancyApplication.stage)
    )
    stage_total_counts = {row[0]: row[1] for row in counts_result.all()}

    # Fetch all applications across all visible stages in one query,
    # then apply per-column limit in Python to avoid N queries (one per stage).
    all_visible_stages = []
    for _, _, query_stages in stage_config:
        all_visible_stages.extend(query_stages)

    all_apps_result = await db.execute(
        select(VacancyApplication)
        .where(
            *base_filters,
            VacancyApplication.stage.in_(all_visible_stages)
        )
        .order_by(VacancyApplication.stage_order, VacancyApplication.applied_at)
    )
    all_apps_unsorted = all_apps_result.scalars().all()

    # Group by stage and apply per-column limit
    from collections import defaultdict
    apps_by_stage = defaultdict(list)
    for app in all_apps_unsorted:
        apps_by_stage[app.stage].append(app)

    all_apps = []
    for _, _, query_stages in stage_config:
        for qs in query_stages:
            all_apps.extend(apps_by_stage[qs][:limit_per_column])

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
        now = datetime.utcnow()
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
                entity_telegram=(entity.telegram_usernames[0] if entity.telegram_usernames else None) if entity else None,
                entity_position=entity.position if entity else None,
                stage=app.stage,
                stage_order=app.stage_order or 0,
                rating=app.rating,
                notes=app.notes,
                rejection_reason=app.rejection_reason,
                interview_summary=app.interview_summary,
                source=app.source,
                next_interview_at=app.next_interview_at,
                applied_at=app.applied_at or now,
                last_stage_change_at=app.last_stage_change_at or app.applied_at or now,
                updated_at=app.updated_at or now
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
            entity_telegram=(entity.telegram_usernames[0] if entity.telegram_usernames else None) if entity else None,
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

    # Validate: interview_summary required before moving to practice stage
    if data.stage == ApplicationStage.phone_screen:
        for app in applications:
            if app.stage != ApplicationStage.phone_screen:
                if not app.interview_summary or not app.interview_summary.strip():
                    entity = entities_map.get(app.entity_id)
                    name = entity.name if entity else f"ID {app.entity_id}"
                    raise HTTPException(
                        status_code=400,
                        detail=f"Необходимо заполнить итог собеседования перед переводом на практику (кандидат: {name})"
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

    # Save old stages for audit log
    old_stages = {app.id: app.stage for app in applications}

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

    # Record stage transitions in audit log
    from ...services.stage_transitions import record_transition
    for app in applications:
        prev_stage = old_stages.get(app.id)
        if prev_stage != data.stage:
            await record_transition(
                db=db,
                application_id=app.id,
                entity_id=app.entity_id,
                from_stage=prev_stage.value if prev_stage else None,
                to_stage=data.stage.value,
                changed_by_id=current_user.id,
            )

    await db.commit()

    # --- Notifications (fire-and-forget) ---
    try:
        from ...services.hr_notifications import notify_stage_change, notify_practice_started

        for app in applications:
            entity = entities_map.get(app.entity_id)
            if not entity:
                continue
            await notify_stage_change(
                db, app, entity, ApplicationStage.applied, data.stage, current_user
            )
            if data.stage == ApplicationStage.phone_screen:
                await notify_practice_started(db, app, entity, current_user)
    except Exception:
        logger.exception("Bulk-move notifications failed (non-critical)")

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
            entity_telegram=(entity.telegram_usernames[0] if entity.telegram_usernames else None) if entity else None,
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

    logger.info(f"Bulk moved {len(applications)} applications to stage {data.stage}")

    return responses
