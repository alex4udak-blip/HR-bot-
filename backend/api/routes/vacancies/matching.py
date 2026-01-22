"""
Candidate matching and notification endpoints for vacancies.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime, timedelta
from pydantic import BaseModel

from .common import (
    logger, get_db, Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Entity, EntityType, User,
    check_vacancy_access, can_access_vacancy
)
from ...services.auth import get_user_org

router = APIRouter()


# === Stats Endpoints ===

@router.get("/stats/overview")
async def get_vacancies_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Get overview statistics for vacancies."""
    org = await get_user_org(current_user, db)
    org_filter = Vacancy.org_id == org.id if org else True

    # Total vacancies by status
    status_counts = await db.execute(
        select(Vacancy.status, func.count(Vacancy.id))
        .where(org_filter)
        .group_by(Vacancy.status)
    )

    # Total applications by stage
    stage_counts = await db.execute(
        select(VacancyApplication.stage, func.count(VacancyApplication.id))
        .join(Vacancy)
        .where(org_filter)
        .group_by(VacancyApplication.stage)
    )

    # Applications this week
    week_ago = datetime.utcnow() - timedelta(days=7)
    apps_this_week = await db.execute(
        select(func.count(VacancyApplication.id))
        .join(Vacancy)
        .where(org_filter, VacancyApplication.applied_at >= week_ago)
    )

    return {
        "vacancies_by_status": {str(row[0].value): row[1] for row in status_counts.all()},
        "applications_by_stage": {str(row[0].value): row[1] for row in stage_counts.all()},
        "applications_this_week": apps_this_week.scalar() or 0
    }


# === Candidate Matching Endpoints ===

class CandidateMatchResponse(BaseModel):
    """Response model for candidate match."""
    entity_id: int
    entity_name: str
    match_score: int
    match_reasons: List[str]
    missing_skills: List[str]
    salary_compatible: bool
    email: Optional[str] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    status: Optional[str] = None
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: str = "RUB"


class NotifyCandidatesResponse(BaseModel):
    """Response model for notify candidates operation."""
    vacancy_id: int
    vacancy_title: str
    candidates_found: int
    candidates_notified: List[CandidateMatchResponse]
    message: str


@router.get("/{vacancy_id}/matching-candidates", response_model=List[CandidateMatchResponse])
async def get_matching_candidates(
    vacancy_id: int,
    limit: int = Query(10, ge=1, le=50),
    min_score: int = Query(0, ge=0, le=100),
    exclude_applied: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """
    Get candidates that match a vacancy (with access control).

    This endpoint analyzes all candidates in the organization and returns
    those that match the vacancy requirements, sorted by match score.

    Args:
        vacancy_id: ID of the vacancy
        limit: Maximum number of candidates (1-50)
        min_score: Minimum match score filter (0-100)
        exclude_applied: Whether to exclude already applied candidates

    Returns:
        List of CandidateMatchResponse objects sorted by match_score descending
    """
    from ...services.vacancy_recommender import vacancy_recommender

    # Get user's organization
    org = await get_user_org(current_user, db)

    # Get the vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id)
    )
    vacancy = result.scalar()

    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Verify org access
    if org and vacancy.org_id != org.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check vacancy-level access rights
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Find matching candidates
    matches = await vacancy_recommender.find_matching_candidates(
        db=db,
        vacancy=vacancy,
        limit=limit,
        exclude_applied=exclude_applied
    )

    # Filter by min_score
    filtered_matches = [m for m in matches if m.match_score >= min_score]

    return [
        CandidateMatchResponse(
            entity_id=m.entity_id,
            entity_name=m.entity_name,
            match_score=m.match_score,
            match_reasons=m.match_reasons,
            missing_skills=m.missing_skills,
            salary_compatible=m.salary_compatible,
            email=m.email,
            phone=m.phone,
            position=m.position,
            status=m.status,
            expected_salary_min=m.expected_salary_min,
            expected_salary_max=m.expected_salary_max,
            expected_salary_currency=m.expected_salary_currency,
        )
        for m in filtered_matches
    ]


@router.post("/{vacancy_id}/notify-candidates", response_model=NotifyCandidatesResponse)
async def notify_matching_candidates(
    vacancy_id: int,
    min_score: int = Query(50, ge=0, le=100),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """
    Find and prepare to notify candidates about a vacancy (with access control).

    This endpoint finds candidates that match the vacancy and returns them
    for notification. The actual notification sending (email, telegram, etc.)
    should be handled by a separate service.

    Args:
        vacancy_id: ID of the vacancy
        min_score: Minimum match score to include (0-100)
        limit: Maximum candidates to notify (1-100)

    Returns:
        NotifyCandidatesResponse with list of candidates to notify
    """
    from ...services.vacancy_recommender import vacancy_recommender

    # Get user's organization
    org = await get_user_org(current_user, db)

    # Get the vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id)
    )
    vacancy = result.scalar()

    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Verify org access
    if org and vacancy.org_id != org.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check vacancy-level access rights
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Check vacancy status
    if vacancy.status != VacancyStatus.open:
        raise HTTPException(
            status_code=400,
            detail="Mozhno uvedomlyat' kandidatov tol'ko po otkrytym vakansiyam"
        )

    # Find matching candidates
    candidates_to_notify = await vacancy_recommender.notify_new_vacancy(
        db=db,
        vacancy=vacancy,
        match_threshold=min_score,
        limit=limit
    )

    logger.info(
        f"Prepared notification for vacancy {vacancy_id}: "
        f"{len(candidates_to_notify)} candidates match (threshold: {min_score})"
    )

    return NotifyCandidatesResponse(
        vacancy_id=vacancy.id,
        vacancy_title=vacancy.title,
        candidates_found=len(candidates_to_notify),
        candidates_notified=[
            CandidateMatchResponse(
                entity_id=c.entity_id,
                entity_name=c.entity_name,
                match_score=c.match_score,
                match_reasons=c.match_reasons,
                missing_skills=c.missing_skills,
                salary_compatible=c.salary_compatible,
                email=c.email,
                phone=c.phone,
                position=c.position,
                status=c.status,
                expected_salary_min=c.expected_salary_min,
                expected_salary_max=c.expected_salary_max,
                expected_salary_currency=c.expected_salary_currency,
            )
            for c in candidates_to_notify
        ],
        message=f"Najdeno {len(candidates_to_notify)} podkhodyashchikh kandidatov dlya uvedomleniya"
    )


@router.post("/{vacancy_id}/invite-candidate/{entity_id}")
async def invite_candidate_to_vacancy(
    vacancy_id: int,
    entity_id: int,
    stage: ApplicationStage = ApplicationStage.screening,
    notes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """
    Invite a specific candidate to a vacancy (skip 'applied' stage) - with access control.

    This is used when HR proactively invites a matching candidate
    to interview or screening for a vacancy.

    Args:
        vacancy_id: ID of the vacancy
        entity_id: ID of the candidate to invite
        stage: Initial stage (default: screening)
        notes: Optional notes about the invitation

    Returns:
        Created application details
    """
    from sqlalchemy import func

    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization access")

    # Get and verify vacancy
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = vacancy_result.scalar()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check vacancy-level access rights
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Get and verify entity
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    if entity.type != EntityType.candidate:
        raise HTTPException(status_code=400, detail="Only candidates can be invited")

    # Check if already applied
    existing_result = await db.execute(
        select(VacancyApplication).where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.entity_id == entity_id
        )
    )
    if existing_result.scalar():
        raise HTTPException(
            status_code=400,
            detail="Kandidat uzhe dobavlen v etu vakansiyu"
        )

    # Get max stage_order
    # SECURITY: Use FOR UPDATE to prevent race condition
    max_order_result = await db.execute(
        select(func.max(VacancyApplication.stage_order))
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == stage
        )
        .with_for_update()
    )
    max_order = max_order_result.scalar() or 0

    # Create application
    application = VacancyApplication(
        vacancy_id=vacancy_id,
        entity_id=entity_id,
        stage=stage,
        stage_order=max_order + 1,
        source="hr_invitation",
        notes=notes or f"Priglashyon HR na etap {stage.value}",
        created_by=current_user.id
    )

    db.add(application)
    await db.commit()
    await db.refresh(application)

    logger.info(
        f"Invited candidate {entity_id} to vacancy {vacancy_id} "
        f"at stage {stage.value} by user {current_user.id}"
    )

    return {
        "id": application.id,
        "vacancy_id": application.vacancy_id,
        "vacancy_title": vacancy.title,
        "entity_id": application.entity_id,
        "entity_name": entity.name,
        "stage": application.stage.value,
        "source": application.source,
        "notes": application.notes,
        "applied_at": application.applied_at.isoformat() if application.applied_at else None,
        "message": f"Kandidat {entity.name} priglashyon na vakansiyu {vacancy.title}"
    }
