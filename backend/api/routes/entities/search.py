"""
Search and filter operations for entities - smart search, red flags,
risk scores, recommendations, similarity, duplicates.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel

from .common import (
    logger, get_db, Entity, EntityType, EntityStatus, Chat, CallRecording,
    User, UserRole, Department, Vacancy, VacancyApplication, VacancyStatus,
    ApplicationStage, STAGE_SYNC_MAP, OrgRole, AccessLevel, Message,
    get_current_user, get_user_org, get_user_org_role, check_entity_access,
    red_flags_service
)

router = APIRouter()


# === Smart Search Schemas ===

class SmartSearchResult(BaseModel):
    """Single search result with relevance score."""
    id: int
    type: EntityType
    name: str
    status: EntityStatus
    phone: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    position: Optional[str] = None
    tags: List[str] = []
    extra_data: dict = {}
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    relevance_score: float = 0.0
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: Optional[str] = 'RUB'
    ai_summary: Optional[str] = None

    class Config:
        from_attributes = True


class SmartSearchResponse(BaseModel):
    """Smart search response with results and metadata."""
    results: List[SmartSearchResult]
    total: int
    parsed_query: dict
    offset: int
    limit: int


@router.get("/search")
async def smart_search(
    query: str = Query(..., min_length=1, max_length=500, description="Natural language search query"),
    type: Optional[EntityType] = Query(None, description="Filter by entity type"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=10000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Smart search with AI-powered natural language understanding.

    Examples:
    - "Python developers with 3+ years experience"
    - "Frontend React salary up to 200000"
    - "Moscow Java senior"
    - "candidates with DevOps skills"

    Returns ranked results based on relevance to the query.
    """
    from ...services.smart_search import smart_search_service

    current_user = await db.merge(current_user)

    # SUPERADMIN sees everything
    org_id = None
    if current_user.role != UserRole.superadmin:
        org = await get_user_org(current_user, db)
        if not org:
            return SmartSearchResponse(
                results=[],
                total=0,
                parsed_query={},
                offset=offset,
                limit=limit
            )
        org_id = org.id

    try:
        # Perform smart search
        search_result = await smart_search_service.search(
            db=db,
            query=query,
            org_id=org_id,
            user_id=current_user.id,
            entity_type=type,
            limit=limit,
            offset=offset,
        )

        entities = search_result["results"]
        scores = search_result.get("scores", {})

        if not entities:
            return SmartSearchResponse(
                results=[],
                total=0,
                parsed_query=search_result.get("parsed_query", {}),
                offset=offset,
                limit=limit
            )

        # Get department names for results
        dept_ids = list(set(e.department_id for e in entities if e.department_id))
        dept_names = {}
        if dept_ids:
            depts_result = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
            for dept in depts_result.scalars().all():
                dept_names[dept.id] = dept.name

        # Build response
        results = []
        for entity in entities:
            results.append(SmartSearchResult(
                id=entity.id,
                type=entity.type,
                name=entity.name,
                status=entity.status,
                phone=entity.phone,
                email=entity.email,
                company=entity.company,
                position=entity.position,
                tags=entity.tags or [],
                extra_data=entity.extra_data or {},
                department_id=entity.department_id,
                department_name=dept_names.get(entity.department_id) if entity.department_id else None,
                created_at=entity.created_at,
                updated_at=entity.updated_at,
                relevance_score=scores.get(entity.id, 0.0),
                expected_salary_min=entity.expected_salary_min,
                expected_salary_max=entity.expected_salary_max,
                expected_salary_currency=entity.expected_salary_currency or 'RUB',
                ai_summary=entity.ai_summary[:200] + "..." if entity.ai_summary and len(entity.ai_summary) > 200 else entity.ai_summary,
            ))

        return SmartSearchResponse(
            results=results,
            total=search_result["total"],
            parsed_query=search_result.get("parsed_query", {}),
            offset=offset,
            limit=limit
        )

    except Exception as e:
        logger.error(f"Smart search error: {e}")
        raise HTTPException(500, f"Search error: {str(e)}")


# === Red Flags & Risk ===

@router.get("/{entity_id}/red-flags")
async def get_entity_red_flags(
    entity_id: int,
    vacancy_id: Optional[int] = Query(None, description="Optional vacancy ID to compare against"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get red flags analysis for a candidate.

    Analyzes the candidate's profile and communications for potential red flags.
    Returns a list of detected red flags with severity levels and recommendations.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Fetch entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check access
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(404, "Entity not found")

    # Fetch vacancy if provided
    vacancy = None
    if vacancy_id:
        vacancy_result = await db.execute(
            select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
        )
        vacancy = vacancy_result.scalar_one_or_none()

    # Fetch linked chats with messages for AI analysis
    chats_result = await db.execute(
        select(Chat).where(Chat.entity_id == entity_id)
    )
    chats = list(chats_result.scalars().all())

    # Load messages for each chat (limit to avoid memory issues)
    for chat in chats:
        messages_result = await db.execute(
            select(Message)
            .where(Message.chat_id == chat.id)
            .order_by(Message.timestamp.desc())
            .limit(100)
        )
        chat.messages = list(messages_result.scalars().all())

    # Fetch linked calls with transcripts
    calls_result = await db.execute(
        select(CallRecording)
        .where(CallRecording.entity_id == entity_id)
        .order_by(CallRecording.created_at.desc())
        .limit(5)
    )
    calls = list(calls_result.scalars().all())

    # Run red flags analysis
    try:
        analysis = await red_flags_service.detect_red_flags(
            entity=entity,
            vacancy=vacancy,
            chats=chats,
            calls=calls
        )
        return analysis.to_dict()
    except Exception as e:
        logger.error(f"Red flags analysis failed for entity {entity_id}: {e}")
        raise HTTPException(500, f"Failed to analyze red flags: {str(e)}")


@router.get("/{entity_id}/risk-score")
async def get_entity_risk_score(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get quick risk score for a candidate (0-100).

    This is a fast synchronous calculation based on available profile data.
    For full analysis with AI, use the /red-flags endpoint.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(404, "Entity not found")

    risk_score = red_flags_service.get_risk_score(entity)

    return {
        "entity_id": entity_id,
        "risk_score": risk_score,
        "risk_level": "high" if risk_score >= 60 else "medium" if risk_score >= 30 else "low"
    }


# === Vacancy Integration ===

class EntityVacancyApplicationResponse(BaseModel):
    """Response schema for vacancy application from entity perspective."""
    id: int
    vacancy_id: int
    vacancy_title: str
    vacancy_status: str
    stage: str
    rating: Optional[int] = None
    notes: Optional[str] = None
    source: Optional[str] = None
    applied_at: datetime
    last_stage_change_at: datetime
    department_name: Optional[str] = None

    class Config:
        from_attributes = True


class ApplyToVacancyRequest(BaseModel):
    """Request schema for applying entity to vacancy."""
    vacancy_id: int
    source: Optional[str] = None
    notes: Optional[str] = None


@router.get("/{entity_id}/vacancies")
async def get_entity_vacancies(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all vacancies a candidate/entity has applied to.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has access to view this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(404, "Entity not found")

    # Get all vacancy applications for this entity
    apps_result = await db.execute(
        select(VacancyApplication)
        .where(VacancyApplication.entity_id == entity_id)
        .order_by(VacancyApplication.applied_at.desc())
    )
    applications = apps_result.scalars().all()

    if not applications:
        return []

    # Get vacancy IDs for batch query
    vacancy_ids = [app.vacancy_id for app in applications]

    # Batch fetch vacancies
    vacancies_result = await db.execute(
        select(Vacancy).where(Vacancy.id.in_(vacancy_ids))
    )
    vacancies_map = {v.id: v for v in vacancies_result.scalars().all()}

    # Get department names
    dept_ids = [v.department_id for v in vacancies_map.values() if v.department_id]
    dept_names = {}
    if dept_ids:
        depts_result = await db.execute(
            select(Department).where(Department.id.in_(dept_ids))
        )
        dept_names = {d.id: d.name for d in depts_result.scalars().all()}

    # Build response
    response = []
    for app in applications:
        vacancy = vacancies_map.get(app.vacancy_id)
        if vacancy:
            response.append(EntityVacancyApplicationResponse(
                id=app.id,
                vacancy_id=app.vacancy_id,
                vacancy_title=vacancy.title,
                vacancy_status=vacancy.status.value if vacancy.status else "unknown",
                stage=app.stage.value if app.stage else "applied",
                rating=app.rating,
                notes=app.notes,
                source=app.source,
                applied_at=app.applied_at,
                last_stage_change_at=app.last_stage_change_at,
                department_name=dept_names.get(vacancy.department_id) if vacancy.department_id else None
            ))

    return response


@router.post("/{entity_id}/apply-to-vacancy")
async def apply_entity_to_vacancy(
    entity_id: int,
    data: ApplyToVacancyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Quick add entity to a vacancy pipeline.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check if user has edit access to this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        raise HTTPException(403, "No edit permission for this entity")

    # Get vacancy
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == data.vacancy_id)
    )
    vacancy = vacancy_result.scalar_one_or_none()

    if not vacancy:
        raise HTTPException(404, "Vacancy not found")

    # Check if entity is already in ANY active vacancy
    existing_any_vacancy = await db.execute(
        select(VacancyApplication)
        .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
        .where(
            VacancyApplication.entity_id == entity_id,
            Vacancy.status != VacancyStatus.closed
        )
    )
    existing_app = existing_any_vacancy.scalar()
    if existing_app:
        # Get vacancy title for better error message
        existing_vacancy_result = await db.execute(
            select(Vacancy.title).where(Vacancy.id == existing_app.vacancy_id)
        )
        existing_vacancy_title = existing_vacancy_result.scalar() or "another vacancy"
        raise HTTPException(
            status_code=400,
            detail=f"Candidate is already in vacancy \"{existing_vacancy_title}\". Remove them first."
        )

    # Get max stage_order for the 'applied' stage
    max_order_result = await db.execute(
        select(func.max(VacancyApplication.stage_order))
        .where(
            VacancyApplication.vacancy_id == data.vacancy_id,
            VacancyApplication.stage == ApplicationStage.applied
        )
    )
    max_order = max_order_result.scalar() or 0

    # Create application
    application = VacancyApplication(
        vacancy_id=data.vacancy_id,
        entity_id=entity_id,
        stage=ApplicationStage.applied,
        stage_order=max_order + 1,
        source=data.source,
        notes=data.notes,
        created_by=current_user.id
    )

    db.add(application)

    # Synchronize Entity.status to match VacancyApplication.stage
    expected_entity_status = STAGE_SYNC_MAP.get(ApplicationStage.applied)
    if expected_entity_status and entity.status != expected_entity_status:
        entity.status = expected_entity_status
        entity.updated_at = datetime.utcnow()
        logger.info(f"apply-to-vacancy: Synchronized entity {entity_id} status to {expected_entity_status}")

    await db.commit()
    await db.refresh(application)

    logger.info(f"Entity {entity_id} applied to vacancy {data.vacancy_id} by user {current_user.id}")

    return {
        "success": True,
        "application_id": application.id,
        "entity_id": entity_id,
        "vacancy_id": data.vacancy_id,
        "vacancy_title": vacancy.title,
        "stage": application.stage.value
    }


# === Vacancy Recommendations ===

class VacancyRecommendationResponse(BaseModel):
    """Response model for vacancy recommendation."""
    vacancy_id: int
    vacancy_title: str
    match_score: int
    match_reasons: List[str]
    missing_requirements: List[str]
    salary_compatible: bool
    location_match: bool = True
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    employment_type: Optional[str] = None
    experience_level: Optional[str] = None
    department_name: Optional[str] = None
    applications_count: int = 0


@router.get("/{entity_id}/recommended-vacancies", response_model=List[VacancyRecommendationResponse])
async def get_recommended_vacancies(
    entity_id: int,
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get vacancy recommendations for a candidate.
    """
    from ...services.vacancy_recommender import vacancy_recommender

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get the entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    if entity.type != EntityType.candidate:
        raise HTTPException(400, "Recommendations are only available for candidates")

    # Get recommendations
    recommendations = await vacancy_recommender.get_recommendations(
        db=db,
        entity=entity,
        limit=limit,
        org_id=org.id
    )

    return [
        VacancyRecommendationResponse(
            vacancy_id=rec.vacancy_id,
            vacancy_title=rec.vacancy_title,
            match_score=rec.match_score,
            match_reasons=rec.match_reasons,
            missing_requirements=rec.missing_requirements,
            salary_compatible=rec.salary_compatible,
            location_match=rec.location_match,
            salary_min=rec.salary_min,
            salary_max=rec.salary_max,
            salary_currency=rec.salary_currency,
            location=rec.location,
            employment_type=rec.employment_type,
            experience_level=rec.experience_level,
            department_name=rec.department_name,
            applications_count=rec.applications_count,
        )
        for rec in recommendations
    ]


@router.post("/{entity_id}/auto-apply/{vacancy_id}")
async def auto_apply_to_vacancy(
    entity_id: int,
    vacancy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Automatically apply a candidate to a vacancy.
    """
    from ...services.vacancy_recommender import vacancy_recommender

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get the entity
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    if entity.type != EntityType.candidate:
        raise HTTPException(400, "Only candidates can apply")

    # Get the vacancy
    vacancy_result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = vacancy_result.scalar_one_or_none()

    if not vacancy:
        raise HTTPException(404, "Vacancy not found")

    # Apply
    application = await vacancy_recommender.auto_apply(
        db=db,
        entity=entity,
        vacancy=vacancy,
        source="recommendation",
        created_by=current_user.id
    )

    if not application:
        raise HTTPException(400, "Candidate has already applied to this vacancy")

    return {
        "id": application.id,
        "vacancy_id": application.vacancy_id,
        "entity_id": application.entity_id,
        "stage": application.stage.value,
        "source": application.source,
        "applied_at": application.applied_at.isoformat() if application.applied_at else None,
        "message": "Application created successfully"
    }


# === Similar Candidates & Duplicates ===

class SimilarCandidateResponse(BaseModel):
    """Response with similar candidate info."""
    entity_id: int
    entity_name: str
    similarity_score: int  # 0-100
    common_skills: List[str] = []
    similar_experience: bool = False
    similar_salary: bool = False
    similar_location: bool = False
    match_reasons: List[str] = []
    # Detailed comparison data for both candidates
    entity1_skills: List[str] = []
    entity2_skills: List[str] = []
    entity1_experience: Optional[int] = None
    entity2_experience: Optional[int] = None
    entity1_salary_min: Optional[int] = None
    entity1_salary_max: Optional[int] = None
    entity2_salary_min: Optional[int] = None
    entity2_salary_max: Optional[int] = None
    entity1_location: Optional[str] = None
    entity2_location: Optional[str] = None
    entity1_position: Optional[str] = None
    entity2_position: Optional[str] = None

    class Config:
        from_attributes = True


class DuplicateCandidateResponse(BaseModel):
    """Response with potential duplicate info."""
    entity_id: int
    entity_name: str
    confidence: int  # 0-100
    match_reasons: List[str] = []
    matched_fields: dict = {}  # {field: [value1, value2]}

    class Config:
        from_attributes = True


class MergeEntitiesRequest(BaseModel):
    """Request for merging entities."""
    source_entity_id: int  # Will be deleted
    keep_source_data: bool = False  # Priority for source data


class MergeEntitiesResponse(BaseModel):
    """Response after merging entities."""
    success: bool
    message: str
    merged_entity_id: int
    deleted_entity_id: int


@router.get("/{entity_id}/similar", response_model=List[SimilarCandidateResponse])
async def get_similar_candidates(
    entity_id: int,
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get list of similar candidates.
    """
    from ...services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check user has access to this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(403, "No access to this entity")

    if entity.type != EntityType.candidate:
        raise HTTPException(400, "Similar search is only available for candidates")

    # Find similar (filtered by user's access rights for security)
    similar = await similarity_service.find_similar(
        db=db,
        entity=entity,
        limit=limit,
        org_id=org.id,
        user=current_user
    )

    return [
        SimilarCandidateResponse(
            entity_id=s.entity_id,
            entity_name=s.entity_name,
            similarity_score=s.similarity_score,
            common_skills=s.common_skills,
            similar_experience=s.similar_experience,
            similar_salary=s.similar_salary,
            similar_location=s.similar_location,
            match_reasons=s.match_reasons
        )
        for s in similar
    ]


@router.get("/{entity_id}/duplicates", response_model=List[DuplicateCandidateResponse])
async def get_duplicate_candidates(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get list of potential duplicates.
    """
    from ...services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Get entity
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check user has access to this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(403, "No access to this entity")

    # Find duplicates (filtered by user's access rights for security)
    duplicates = await similarity_service.detect_duplicates(
        db=db,
        entity=entity,
        org_id=org.id,
        user=current_user
    )

    return [
        DuplicateCandidateResponse(
            entity_id=d.entity_id,
            entity_name=d.entity_name,
            confidence=d.confidence,
            match_reasons=d.match_reasons,
            matched_fields={k: list(v) for k, v in d.matched_fields.items()}
        )
        for d in duplicates
    ]


@router.post("/{entity_id}/merge", response_model=MergeEntitiesResponse)
async def merge_entities(
    entity_id: int,
    request: MergeEntitiesRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Merge two duplicates.
    """
    from ...services.similarity import similarity_service
    from .common import broadcast_entity_updated, broadcast_entity_deleted

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Check permissions (only admin/owner can merge)
    org_role = await get_user_org_role(current_user, org.id, db)
    if org_role not in [OrgRole.admin, OrgRole.owner]:
        raise HTTPException(403, "Only administrators can merge duplicates")

    if entity_id == request.source_entity_id:
        raise HTTPException(400, "Cannot merge entity with itself")

    # Get target entity
    target_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    target_entity = target_result.scalar_one_or_none()

    if not target_entity:
        raise HTTPException(404, "Target entity not found")

    # Get source entity
    source_result = await db.execute(
        select(Entity).where(Entity.id == request.source_entity_id, Entity.org_id == org.id)
    )
    source_entity = source_result.scalar_one_or_none()

    if not source_entity:
        raise HTTPException(404, "Source entity not found")

    # Merge
    try:
        merged = await similarity_service.merge_entities(
            db=db,
            source_entity=source_entity,
            target_entity=target_entity,
            keep_source_data=request.keep_source_data
        )

        # Broadcast updates
        await broadcast_entity_updated(org.id, merged.id)
        await broadcast_entity_deleted(org.id, request.source_entity_id)

        return MergeEntitiesResponse(
            success=True,
            message=f"Entities merged successfully. {source_entity.name} was deleted.",
            merged_entity_id=merged.id,
            deleted_entity_id=request.source_entity_id
        )
    except Exception as e:
        logger.error(f"Error merging entities: {e}")
        raise HTTPException(500, f"Error merging: {str(e)}")


@router.get("/{entity_id}/compare/{other_entity_id}", response_model=SimilarCandidateResponse)
async def compare_candidates(
    entity_id: int,
    other_entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Compare two candidates.
    """
    from ...services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    if entity_id == other_entity_id:
        raise HTTPException(400, "Cannot compare entity with itself")

    # Get first entity
    result1 = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity1 = result1.scalar_one_or_none()

    if not entity1:
        raise HTTPException(404, "First entity not found")

    # Check access to first entity
    has_access1 = await check_entity_access(entity1, current_user, org.id, db, required_level=None)
    if not has_access1:
        raise HTTPException(403, "No access to first entity")

    # Get second entity
    result2 = await db.execute(
        select(Entity).where(Entity.id == other_entity_id, Entity.org_id == org.id)
    )
    entity2 = result2.scalar_one_or_none()

    if not entity2:
        raise HTTPException(404, "Second entity not found")

    # Check access to second entity
    has_access2 = await check_entity_access(entity2, current_user, org.id, db, required_level=None)
    if not has_access2:
        raise HTTPException(403, "No access to second entity")

    # Compare
    comparison = similarity_service.calculate_similarity(entity1, entity2)

    return SimilarCandidateResponse(
        entity_id=comparison.entity_id,
        entity_name=comparison.entity_name,
        similarity_score=comparison.similarity_score,
        common_skills=comparison.common_skills,
        similar_experience=comparison.similar_experience,
        similar_salary=comparison.similar_salary,
        similar_location=comparison.similar_location,
        match_reasons=comparison.match_reasons,
        # Detailed comparison data
        entity1_skills=comparison.entity1_skills,
        entity2_skills=comparison.entity2_skills,
        entity1_experience=comparison.entity1_experience,
        entity2_experience=comparison.entity2_experience,
        entity1_salary_min=comparison.entity1_salary_min,
        entity1_salary_max=comparison.entity1_salary_max,
        entity2_salary_min=comparison.entity2_salary_min,
        entity2_salary_max=comparison.entity2_salary_max,
        entity1_location=comparison.entity1_location,
        entity2_location=comparison.entity2_location,
        entity1_position=comparison.entity1_position,
        entity2_position=comparison.entity2_position
    )


@router.get("/{entity_id}/compare/{other_entity_id}/ai")
async def compare_candidates_ai(
    entity_id: int,
    other_entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AI-powered comparison of two candidates using full context.

    Returns a streaming response with markdown-formatted comparison.
    """
    from ...services.comparison_ai import comparison_ai_service
    from ...models.database import EntityFile

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    if entity_id == other_entity_id:
        raise HTTPException(400, "Cannot compare candidate with themselves")

    # Load both entities with related data
    async def load_entity_with_context(eid: int):
        # Entity
        result = await db.execute(
            select(Entity).where(Entity.id == eid, Entity.org_id == org.id)
        )
        entity = result.scalar_one_or_none()
        if not entity:
            return None, [], [], []

        # Chats with messages
        chats_result = await db.execute(
            select(Chat)
            .options(selectinload(Chat.messages))
            .where(Chat.entity_id == eid)
        )
        chats = list(chats_result.scalars().all())

        # Calls
        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.entity_id == eid)
        )
        calls = list(calls_result.scalars().all())

        # Files
        files_result = await db.execute(
            select(EntityFile).where(EntityFile.entity_id == eid)
        )
        files = list(files_result.scalars().all())

        return entity, chats, calls, files

    entity1, chats1, calls1, files1 = await load_entity_with_context(entity_id)
    if not entity1:
        raise HTTPException(404, "First candidate not found")

    # Check access to first entity
    has_access1 = await check_entity_access(entity1, current_user, org.id, db, required_level=None)
    if not has_access1:
        raise HTTPException(403, "No access to first entity")

    entity2, chats2, calls2, files2 = await load_entity_with_context(other_entity_id)
    if not entity2:
        raise HTTPException(404, "Second candidate not found")

    # Check access to second entity
    has_access2 = await check_entity_access(entity2, current_user, org.id, db, required_level=None)
    if not has_access2:
        raise HTTPException(403, "No access to second entity")

    async def generate():
        try:
            async for chunk in comparison_ai_service.compare_stream(
                entity1, chats1, calls1, files1,
                entity2, chats2, calls2, files2
            ):
                yield chunk
        except Exception as e:
            logger.error(f"AI comparison error: {e}")
            yield f"\n\nError during comparison: {str(e)}"

    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8"
    )


@router.post("/{entity_id}/compare/{other_entity_id}/report")
async def compare_candidates_report(
    entity_id: int,
    other_entity_id: int,
    format: str = Query("pdf", description="Report format: pdf, docx, markdown"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Generate downloadable comparison report for two candidates.

    Returns PDF, DOCX, or Markdown file with detailed comparison.
    """
    from ...services.comparison_ai import comparison_ai_service
    from ...services.reports import generate_pdf_report, generate_docx_report
    from ...models.database import EntityFile
    from fastapi.responses import Response

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    if entity_id == other_entity_id:
        raise HTTPException(400, "Cannot compare candidate with themselves")

    if format not in ("pdf", "docx", "markdown"):
        raise HTTPException(400, "Format must be pdf, docx, or markdown")

    # Load both entities with related data
    async def load_entity_with_context(eid: int):
        result = await db.execute(
            select(Entity).where(Entity.id == eid, Entity.org_id == org.id)
        )
        entity = result.scalar_one_or_none()
        if not entity:
            return None, [], [], []

        chats_result = await db.execute(
            select(Chat)
            .options(selectinload(Chat.messages))
            .where(Chat.entity_id == eid)
        )
        chats = list(chats_result.scalars().all())

        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.entity_id == eid)
        )
        calls = list(calls_result.scalars().all())

        files_result = await db.execute(
            select(EntityFile).where(EntityFile.entity_id == eid)
        )
        files = list(files_result.scalars().all())

        return entity, chats, calls, files

    entity1, chats1, calls1, files1 = await load_entity_with_context(entity_id)
    if not entity1:
        raise HTTPException(404, "First candidate not found")

    # Check access to first entity
    has_access1 = await check_entity_access(entity1, current_user, org.id, db, required_level=None)
    if not has_access1:
        raise HTTPException(403, "No access to first entity")

    entity2, chats2, calls2, files2 = await load_entity_with_context(other_entity_id)
    if not entity2:
        raise HTTPException(404, "Second candidate not found")

    # Check access to second entity
    has_access2 = await check_entity_access(entity2, current_user, org.id, db, required_level=None)
    if not has_access2:
        raise HTTPException(403, "No access to second entity")

    # Generate comparison content (non-streaming)
    comparison_text = ""
    try:
        async for chunk in comparison_ai_service.compare_stream(
            entity1, chats1, calls1, files1,
            entity2, chats2, calls2, files2
        ):
            comparison_text += chunk
    except Exception as e:
        logger.error(f"AI comparison error: {e}")
        raise HTTPException(500, f"Failed to generate comparison: {str(e)}")

    # Generate report file
    title = f"Сравнение: {entity1.name} vs {entity2.name}"

    if format == "pdf":
        file_bytes = generate_pdf_report(title, comparison_text, title)
        return Response(
            content=file_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="comparison_{entity_id}_vs_{other_entity_id}.pdf"'
            }
        )
    elif format == "docx":
        file_bytes = generate_docx_report(title, comparison_text, title)
        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="comparison_{entity_id}_vs_{other_entity_id}.docx"'
            }
        )
    else:
        return Response(
            content=comparison_text,
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="comparison_{entity_id}_vs_{other_entity_id}.md"'
            }
        )
