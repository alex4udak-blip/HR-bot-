"""
Basic CRUD operations for vacancies.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime

from .common import (
    logger, get_db, Vacancy, VacancyStatus, VacancyApplication,
    User, Department, DepartmentMember, DeptRole,
    VacancyCreate, VacancyUpdate, VacancyResponse,
    check_vacancy_access, has_full_database_access, can_access_vacancy,
    can_edit_vacancy, get_shared_vacancy_ids
)
from ...services.auth import get_user_org
from ...services.cache import scoring_cache

router = APIRouter()


@router.get("", response_model=List[VacancyResponse])
async def list_vacancies(
    status: Optional[VacancyStatus] = None,
    department_id: Optional[int] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """List vacancies filtered by user access rights.

    Access rules:
    - Superadmin/Owner: sees all vacancies in org
    - Lead/Sub_admin: sees vacancies in their department + own vacancies
    - Member: sees only own vacancies (created_by or hiring_manager)
    """
    org = await get_user_org(current_user, db)

    # Base query - filter by organization
    query = select(Vacancy).where(Vacancy.org_id == org.id if org else True)

    # Apply access control based on user role
    # Full access: superadmin, owner, or member with has_full_access flag
    has_full_access = await has_full_database_access(current_user, org, db)

    if not has_full_access:
        # Get departments where user is lead/sub_admin (not just member)
        lead_dept_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == current_user.id,
                DepartmentMember.role.in_([DeptRole.lead, DeptRole.sub_admin])
            )
        )
        lead_dept_ids = [row[0] for row in lead_dept_result.all()]

        # Get vacancy IDs shared with user
        shared_vacancy_ids = await get_shared_vacancy_ids(current_user.id, db)

        # User can see:
        # 1. Vacancies they created
        # 2. Vacancies where they are hiring manager
        # 3. Vacancies in departments where they are lead/sub_admin
        # 4. Vacancies shared with them via SharedAccess
        access_conditions = []

        # Always add created_by and hiring_manager conditions
        access_conditions.append(Vacancy.created_by == current_user.id)
        access_conditions.append(Vacancy.hiring_manager_id == current_user.id)

        if lead_dept_ids:
            access_conditions.append(Vacancy.department_id.in_(lead_dept_ids))
        if shared_vacancy_ids:
            access_conditions.append(Vacancy.id.in_(shared_vacancy_ids))

        # Apply OR filter - user must match at least one condition
        query = query.where(or_(*access_conditions))

    if status:
        query = query.where(Vacancy.status == status)
    if department_id:
        query = query.where(Vacancy.department_id == department_id)
    if search:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Vacancy.title.ilike(search_term),
                Vacancy.description.ilike(search_term),
                Vacancy.location.ilike(search_term)
            )
        )

    query = query.order_by(Vacancy.priority.desc(), Vacancy.created_at.desc())
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    vacancies = result.scalars().all()

    if not vacancies:
        return []

    # BULK LOAD: Get all related data in single queries to avoid N+1
    vacancy_ids = [v.id for v in vacancies]
    dept_ids = [v.department_id for v in vacancies if v.department_id]
    manager_ids = [v.hiring_manager_id for v in vacancies if v.hiring_manager_id]
    creator_ids = [v.created_by for v in vacancies if v.created_by]

    # Bulk load departments
    dept_names = {}
    if dept_ids:
        dept_result = await db.execute(
            select(Department.id, Department.name).where(Department.id.in_(dept_ids))
        )
        dept_names = {row[0]: row[1] for row in dept_result.all()}

    # Bulk load hiring managers and creators (combine user IDs for single query)
    all_user_ids = list(set(manager_ids + creator_ids))
    user_names = {}
    if all_user_ids:
        user_result = await db.execute(
            select(User.id, User.name).where(User.id.in_(all_user_ids))
        )
        user_names = {row[0]: row[1] for row in user_result.all()}

    # Split for convenience
    manager_names = {uid: user_names.get(uid) for uid in manager_ids}
    creator_names = {uid: user_names.get(uid) for uid in creator_ids}

    # Bulk load application counts by stage for all vacancies
    stage_counts_result = await db.execute(
        select(
            VacancyApplication.vacancy_id,
            VacancyApplication.stage,
            func.count(VacancyApplication.id)
        )
        .where(VacancyApplication.vacancy_id.in_(vacancy_ids))
        .group_by(VacancyApplication.vacancy_id, VacancyApplication.stage)
    )
    # Build nested dict: {vacancy_id: {stage: count}}
    all_stage_counts = {}
    for row in stage_counts_result.all():
        vac_id, stage, count = row
        if vac_id not in all_stage_counts:
            all_stage_counts[vac_id] = {}
        all_stage_counts[vac_id][str(stage.value)] = count

    # Build response using pre-loaded data
    responses = []
    for vacancy in vacancies:
        dept_name = dept_names.get(vacancy.department_id)
        manager_name = manager_names.get(vacancy.hiring_manager_id)
        creator_name = creator_names.get(vacancy.created_by) if vacancy.created_by else None
        stage_counts = all_stage_counts.get(vacancy.id, {})
        total_apps = sum(stage_counts.values())

        responses.append(VacancyResponse(
            id=vacancy.id,
            title=vacancy.title,
            description=vacancy.description,
            requirements=vacancy.requirements,
            responsibilities=vacancy.responsibilities,
            salary_min=vacancy.salary_min,
            salary_max=vacancy.salary_max,
            salary_currency=vacancy.salary_currency or "RUB",
            location=vacancy.location,
            employment_type=vacancy.employment_type,
            experience_level=vacancy.experience_level,
            status=vacancy.status,
            priority=vacancy.priority or 0,
            tags=vacancy.tags or [],
            extra_data=vacancy.extra_data or {},
            department_id=vacancy.department_id,
            department_name=dept_name,
            hiring_manager_id=vacancy.hiring_manager_id,
            hiring_manager_name=manager_name,
            created_by=vacancy.created_by,
            created_by_name=creator_name,
            published_at=vacancy.published_at,
            closes_at=vacancy.closes_at,
            created_at=vacancy.created_at,
            updated_at=vacancy.updated_at,
            applications_count=total_apps,
            stage_counts=stage_counts
        ))

    return responses


@router.post("", response_model=VacancyResponse, status_code=201)
async def create_vacancy(
    data: VacancyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Create a new vacancy."""
    org = await get_user_org(current_user, db)

    vacancy = Vacancy(
        org_id=org.id if org else None,
        title=data.title,
        description=data.description,
        requirements=data.requirements,
        responsibilities=data.responsibilities,
        salary_min=data.salary_min,
        salary_max=data.salary_max,
        salary_currency=data.salary_currency,
        location=data.location,
        employment_type=data.employment_type,
        experience_level=data.experience_level,
        status=data.status,
        priority=data.priority,
        tags=data.tags,
        extra_data=data.extra_data,
        department_id=data.department_id,
        hiring_manager_id=data.hiring_manager_id,
        closes_at=data.closes_at,
        created_by=current_user.id,
        published_at=datetime.utcnow() if data.status == VacancyStatus.open else None
    )

    db.add(vacancy)
    await db.commit()
    await db.refresh(vacancy)

    logger.info(f"Created vacancy {vacancy.id}: {vacancy.title}")

    return VacancyResponse(
        id=vacancy.id,
        title=vacancy.title,
        description=vacancy.description,
        requirements=vacancy.requirements,
        responsibilities=vacancy.responsibilities,
        salary_min=vacancy.salary_min,
        salary_max=vacancy.salary_max,
        salary_currency=vacancy.salary_currency or "RUB",
        location=vacancy.location,
        employment_type=vacancy.employment_type,
        experience_level=vacancy.experience_level,
        status=vacancy.status,
        priority=vacancy.priority or 0,
        tags=vacancy.tags or [],
        extra_data=vacancy.extra_data or {},
        department_id=vacancy.department_id,
        hiring_manager_id=vacancy.hiring_manager_id,
        created_by=vacancy.created_by,
        created_by_name=current_user.name,  # Creator is current user
        published_at=vacancy.published_at,
        closes_at=vacancy.closes_at,
        created_at=vacancy.created_at,
        updated_at=vacancy.updated_at,
        applications_count=0,
        stage_counts={}
    )


@router.get("/{vacancy_id}", response_model=VacancyResponse)
async def get_vacancy(
    vacancy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Get a single vacancy by ID (with access control)."""
    org = await get_user_org(current_user, db)

    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id)
    )
    vacancy = result.scalar()

    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check access rights
    if not await can_access_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="Access denied to this vacancy")

    # Get department name
    dept_name = None
    if vacancy.department_id:
        dept_result = await db.execute(
            select(Department.name).where(Department.id == vacancy.department_id)
        )
        dept_name = dept_result.scalar()

    # Get hiring manager name
    manager_name = None
    if vacancy.hiring_manager_id:
        manager_result = await db.execute(
            select(User.name).where(User.id == vacancy.hiring_manager_id)
        )
        manager_name = manager_result.scalar()

    # Get creator name
    creator_name = None
    if vacancy.created_by:
        creator_result = await db.execute(
            select(User.name).where(User.id == vacancy.created_by)
        )
        creator_name = creator_result.scalar()

    # Get application counts by stage
    stage_counts_result = await db.execute(
        select(
            VacancyApplication.stage,
            func.count(VacancyApplication.id)
        )
        .where(VacancyApplication.vacancy_id == vacancy.id)
        .group_by(VacancyApplication.stage)
    )
    stage_counts = {str(row[0].value): row[1] for row in stage_counts_result.all()}
    total_apps = sum(stage_counts.values())

    return VacancyResponse(
        id=vacancy.id,
        title=vacancy.title,
        description=vacancy.description,
        requirements=vacancy.requirements,
        responsibilities=vacancy.responsibilities,
        salary_min=vacancy.salary_min,
        salary_max=vacancy.salary_max,
        salary_currency=vacancy.salary_currency or "RUB",
        location=vacancy.location,
        employment_type=vacancy.employment_type,
        experience_level=vacancy.experience_level,
        status=vacancy.status,
        priority=vacancy.priority or 0,
        tags=vacancy.tags or [],
        extra_data=vacancy.extra_data or {},
        department_id=vacancy.department_id,
        department_name=dept_name,
        hiring_manager_id=vacancy.hiring_manager_id,
        hiring_manager_name=manager_name,
        created_by=vacancy.created_by,
        created_by_name=creator_name,
        published_at=vacancy.published_at,
        closes_at=vacancy.closes_at,
        created_at=vacancy.created_at,
        updated_at=vacancy.updated_at,
        applications_count=total_apps,
        stage_counts=stage_counts
    )


@router.put("/{vacancy_id}", response_model=VacancyResponse)
async def update_vacancy(
    vacancy_id: int,
    data: VacancyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Update a vacancy (with access control)."""
    org = await get_user_org(current_user, db)

    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id)
    )
    vacancy = result.scalar()

    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check edit rights
    if not await can_edit_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this vacancy")

    # Get update data (only fields that were explicitly set)
    update_data = data.model_dump(exclude_unset=True)

    # Validate salary range with combined values (existing + updates)
    final_salary_min = update_data.get("salary_min", vacancy.salary_min)
    final_salary_max = update_data.get("salary_max", vacancy.salary_max)
    if final_salary_min is not None and final_salary_max is not None:
        if final_salary_min > final_salary_max:
            raise HTTPException(
                status_code=422,
                detail="salary_min cannot be greater than salary_max"
            )

    # Handle tags and extra_data: convert None to empty values
    if "tags" in update_data and update_data["tags"] is None:
        update_data["tags"] = []
    if "extra_data" in update_data and update_data["extra_data"] is None:
        update_data["extra_data"] = {}

    # Update fields
    for field, value in update_data.items():
        setattr(vacancy, field, value)

    # Set published_at when status changes to open
    if data.status == VacancyStatus.open and not vacancy.published_at:
        vacancy.published_at = datetime.utcnow()

    await db.commit()
    await db.refresh(vacancy)

    # Invalidate scoring cache if relevant fields changed
    # (requirements, salary, experience level, etc.)
    scoring_relevant_fields = {
        'requirements', 'salary_min', 'salary_max', 'salary_currency',
        'experience_level', 'tags', 'description', 'responsibilities'
    }
    if any(field in update_data for field in scoring_relevant_fields):
        await scoring_cache.invalidate_vacancy_scores(vacancy.id)
        logger.info(f"Invalidated scoring cache for vacancy {vacancy.id} due to scoring-relevant field change")

    logger.info(f"Updated vacancy {vacancy.id}")

    # Return full response
    return await get_vacancy(vacancy_id, db, current_user)


@router.delete("/{vacancy_id}", status_code=204)
async def delete_vacancy(
    vacancy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access)
):
    """Delete a vacancy (with access control)."""
    org = await get_user_org(current_user, db)

    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id)
    )
    vacancy = result.scalar()

    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check edit rights (delete requires same permissions as edit)
    if not await can_edit_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="You don't have permission to delete this vacancy")

    await db.delete(vacancy)
    await db.commit()

    logger.info(f"Deleted vacancy {vacancy_id}")
