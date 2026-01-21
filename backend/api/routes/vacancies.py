"""
API routes for vacancy management and candidate pipeline (Kanban board).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional, List, Literal
from datetime import datetime, timezone
from pydantic import BaseModel, field_validator, model_validator
import logging

logger = logging.getLogger("hr-analyzer.vacancies")

from ..database import get_db
from ..models.database import (
    Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Entity, EntityType, User, Organization, Department, STAGE_SYNC_MAP, STATUS_SYNC_MAP,
    UserRole, OrgMember, OrgRole, DepartmentMember, DeptRole,
    SharedAccess, ResourceType, AccessLevel
)
from ..services.auth import get_current_user, get_user_org, has_full_database_access as auth_has_full_database_access
from ..services.features import can_access_feature
from ..services.cache import scoring_cache

router = APIRouter()


# === Vacancy Access Control Helpers ===

async def is_org_owner(user: User, org: Organization, db: AsyncSession) -> bool:
    """Check if user is owner of organization (not admin - they follow same rules as members)."""
    if user.role == UserRole.superadmin:
        return True

    result = await db.execute(
        select(OrgMember).where(
            OrgMember.org_id == org.id,
            OrgMember.user_id == user.id,
            OrgMember.role == OrgRole.owner  # Only owner, not admin
        )
    )
    return result.scalar_one_or_none() is not None


async def has_full_database_access(user: User, org: Organization, db: AsyncSession) -> bool:
    """
    Check if user has full database access (can see all vacancies and candidates).
    Wrapper around auth service function that accepts Organization object instead of org_id.
    """
    return await auth_has_full_database_access(user, org.id, db)


async def get_user_department_ids(user_id: int, org_id: int, db: AsyncSession) -> List[int]:
    """Get all department IDs user belongs to in the organization."""
    result = await db.execute(
        select(DepartmentMember.department_id)
        .join(Department, Department.id == DepartmentMember.department_id)
        .where(
            Department.org_id == org_id,
            DepartmentMember.user_id == user_id,
            Department.is_active == True
        )
    )
    return [row[0] for row in result.all()]


async def is_dept_lead_or_admin(user_id: int, department_id: int, db: AsyncSession) -> bool:
    """Check if user is lead or sub_admin of a specific department."""
    result = await db.execute(
        select(DepartmentMember).where(
            DepartmentMember.department_id == department_id,
            DepartmentMember.user_id == user_id,
            DepartmentMember.role.in_([DeptRole.lead, DeptRole.sub_admin])
        )
    )
    return result.scalar_one_or_none() is not None


async def has_shared_vacancy_access(vacancy_id: int, user_id: int, db: AsyncSession, required_level: AccessLevel = AccessLevel.view) -> bool:
    """
    Check if user has shared access to a vacancy.

    Args:
        vacancy_id: ID of the vacancy
        user_id: ID of the user
        db: Database session
        required_level: Minimum access level required (view, edit, full)

    Returns:
        True if user has sufficient shared access, False otherwise
    """
    # Access level hierarchy: view < edit < full
    access_levels = [AccessLevel.view, AccessLevel.edit, AccessLevel.full]
    required_idx = access_levels.index(required_level)
    allowed_levels = access_levels[required_idx:]

    result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id,
            SharedAccess.shared_with_id == user_id,
            SharedAccess.access_level.in_(allowed_levels),
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.now(timezone.utc))
        )
    )
    return result.scalar_one_or_none() is not None


async def get_shared_vacancy_ids(user_id: int, db: AsyncSession, required_level: AccessLevel = AccessLevel.view) -> List[int]:
    """
    Get all vacancy IDs the user has shared access to.

    Args:
        user_id: ID of the user
        db: Database session
        required_level: Minimum access level required

    Returns:
        List of vacancy IDs
    """
    # Access level hierarchy: view < edit < full
    access_levels = [AccessLevel.view, AccessLevel.edit, AccessLevel.full]
    required_idx = access_levels.index(required_level)
    allowed_levels = access_levels[required_idx:]

    result = await db.execute(
        select(SharedAccess.resource_id).where(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.shared_with_id == user_id,
            SharedAccess.access_level.in_(allowed_levels),
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.now(timezone.utc))
        )
    )
    return [row[0] for row in result.all()]


async def can_access_vacancy(vacancy: Vacancy, user: User, org: Organization, db: AsyncSession) -> bool:
    """
    Check if user can access (view) a specific vacancy.

    Access rules:
    - Superadmin/Owner: can access all vacancies in org
    - Member with has_full_access flag: can access all vacancies in org
    - Lead/Sub_admin of department: can access all vacancies in their department
    - Member: can only access vacancies they created or where they are hiring manager
    - Member with SharedAccess: can access vacancies shared with them
    """
    # Full database access (superadmin, owner, or member with has_full_access)
    if await has_full_database_access(user, org, db):
        return True

    # User is the creator or hiring manager
    if vacancy.created_by == user.id or vacancy.hiring_manager_id == user.id:
        return True

    # If vacancy has a department, check if user is lead/sub_admin of that dept
    if vacancy.department_id:
        if await is_dept_lead_or_admin(user.id, vacancy.department_id, db):
            return True

    # Check if user has shared access to this vacancy
    if await has_shared_vacancy_access(vacancy.id, user.id, db):
        return True

    return False


async def can_edit_vacancy(vacancy: Vacancy, user: User, org: Organization, db: AsyncSession) -> bool:
    """
    Check if user can edit a specific vacancy.

    Edit rules:
    - Superadmin/Owner: can edit all vacancies in org
    - Lead/Sub_admin of department: can edit vacancies in their department
    - Creator: can edit their own vacancies
    - Hiring manager: can edit vacancies where they are hiring manager
    - User with SharedAccess (edit or full level): can edit vacancies shared with them
    """
    # Org admin/owner can edit all
    if await is_org_owner(user, org, db):
        return True

    # User is the creator or hiring manager
    if vacancy.created_by == user.id or vacancy.hiring_manager_id == user.id:
        return True

    # If vacancy has a department, check if user is lead/sub_admin of that dept
    if vacancy.department_id:
        if await is_dept_lead_or_admin(user.id, vacancy.department_id, db):
            return True

    # Check if user has shared access with edit level
    if await has_shared_vacancy_access(vacancy.id, user.id, db, AccessLevel.edit):
        return True

    return False


async def can_share_vacancy(vacancy: Vacancy, user: User, org: Organization, db: AsyncSession) -> bool:
    """
    Check if user can share a specific vacancy with others.

    Share rules:
    - Superadmin/Owner: can share all vacancies in org
    - Lead/Sub_admin of department: can share vacancies in their department
    - Creator: can share their own vacancies
    - User with SharedAccess (full level): can share vacancies shared with them
    """
    # Org admin/owner can share all
    if await is_org_owner(user, org, db):
        return True

    # User is the creator
    if vacancy.created_by == user.id:
        return True

    # If vacancy has a department, check if user is lead/sub_admin of that dept
    if vacancy.department_id:
        if await is_dept_lead_or_admin(user.id, vacancy.department_id, db):
            return True

    # Check if user has shared access with full level
    if await has_shared_vacancy_access(vacancy.id, user.id, db, AccessLevel.full):
        return True

    return False


# === Feature Access Control ===

async def check_vacancy_access(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Check if user has access to the vacancies feature.

    This dependency verifies that:
    1. User is authenticated
    2. User's organization/department has the vacancies feature enabled
    3. Superadmin and Owner always have access (bypassed in can_access_feature)

    Raises:
        HTTPException 403 if user cannot access vacancies feature

    Returns:
        The authenticated user if they have access
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(
            status_code=403,
            detail="Vacancies feature unavailable - organization not found"
        )

    has_access = await can_access_feature(db, current_user.id, org.id, "candidate_database")
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="Candidate Database feature is not enabled for your department"
        )

    return current_user


# === Pydantic Schemas ===

class VacancyCreate(BaseModel):
    title: str
    description: Optional[str] = None
    requirements: Optional[str] = None
    responsibilities: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    employment_type: Optional[str] = None
    experience_level: Optional[str] = None
    status: VacancyStatus = VacancyStatus.draft
    priority: int = 0
    tags: List[str] = []
    extra_data: dict = {}
    department_id: Optional[int] = None
    hiring_manager_id: Optional[int] = None
    closes_at: Optional[datetime] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        """Validate title is not empty and has at least 3 characters."""
        if not v or not v.strip():
            raise ValueError("title cannot be empty")
        if len(v.strip()) < 3:
            raise ValueError("title must be at least 3 characters long")
        return v.strip()

    @field_validator("salary_min", "salary_max")
    @classmethod
    def validate_salary_positive(cls, v: Optional[int]) -> Optional[int]:
        """Validate salary values are non-negative."""
        if v is not None and v < 0:
            raise ValueError("salary cannot be negative")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: int) -> int:
        """Validate priority is in range 0-2."""
        if v < 0 or v > 2:
            raise ValueError("priority must be between 0 and 2")
        return v

    @field_validator("closes_at")
    @classmethod
    def validate_closes_at(cls, v: Optional[datetime]) -> Optional[datetime]:
        """Validate closes_at is not in the past."""
        if v is not None:
            now = datetime.now(timezone.utc) if v.tzinfo else datetime.utcnow()
            if v < now:
                raise ValueError("closes_at cannot be in the past")
        return v

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v) -> List[str]:
        """Ensure tags is a valid list."""
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("tags must be a list")
        return v

    @field_validator("extra_data", mode="before")
    @classmethod
    def validate_extra_data(cls, v) -> dict:
        """Ensure extra_data is a valid dict."""
        if v is None:
            return {}
        if not isinstance(v, dict):
            raise ValueError("extra_data must be a dictionary")
        return v

    @model_validator(mode="after")
    def validate_salary_range(self):
        """Validate salary_min is not greater than salary_max."""
        if self.salary_min is not None and self.salary_max is not None:
            if self.salary_min > self.salary_max:
                raise ValueError("salary_min cannot be greater than salary_max")
        return self


class VacancyUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    responsibilities: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: Optional[str] = None
    location: Optional[str] = None
    employment_type: Optional[str] = None
    experience_level: Optional[str] = None
    status: Optional[VacancyStatus] = None
    priority: Optional[int] = None
    tags: Optional[List[str]] = None
    extra_data: Optional[dict] = None
    department_id: Optional[int] = None
    hiring_manager_id: Optional[int] = None
    closes_at: Optional[datetime] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        """Validate title is not empty and has at least 3 characters if provided."""
        if v is not None:
            if not v.strip():
                raise ValueError("title cannot be empty")
            if len(v.strip()) < 3:
                raise ValueError("title must be at least 3 characters long")
            return v.strip()
        return v

    @field_validator("salary_min", "salary_max")
    @classmethod
    def validate_salary_positive(cls, v: Optional[int]) -> Optional[int]:
        """Validate salary values are non-negative."""
        if v is not None and v < 0:
            raise ValueError("salary cannot be negative")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: Optional[int]) -> Optional[int]:
        """Validate priority is in range 0-2 if provided."""
        if v is not None and (v < 0 or v > 2):
            raise ValueError("priority must be between 0 and 2")
        return v

    @field_validator("closes_at")
    @classmethod
    def validate_closes_at(cls, v: Optional[datetime]) -> Optional[datetime]:
        """Validate closes_at is not in the past."""
        if v is not None:
            now = datetime.now(timezone.utc) if v.tzinfo else datetime.utcnow()
            if v < now:
                raise ValueError("closes_at cannot be in the past")
        return v

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v) -> Optional[List[str]]:
        """Ensure tags is a valid list if provided."""
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("tags must be a list")
        return v

    @field_validator("extra_data", mode="before")
    @classmethod
    def validate_extra_data(cls, v) -> Optional[dict]:
        """Ensure extra_data is a valid dict if provided."""
        if v is None:
            return None
        if not isinstance(v, dict):
            raise ValueError("extra_data must be a dictionary")
        return v

    @model_validator(mode="after")
    def validate_salary_range(self):
        """Validate salary_min is not greater than salary_max."""
        if self.salary_min is not None and self.salary_max is not None:
            if self.salary_min > self.salary_max:
                raise ValueError("salary_min cannot be greater than salary_max")
        return self


class VacancyResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    requirements: Optional[str] = None
    responsibilities: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "RUB"
    location: Optional[str] = None
    employment_type: Optional[str] = None
    experience_level: Optional[str] = None
    status: VacancyStatus
    priority: int = 0
    tags: List[str] = []
    extra_data: dict = {}
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    hiring_manager_id: Optional[int] = None
    hiring_manager_name: Optional[str] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    published_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    applications_count: int = 0
    # Stage counts for quick overview
    stage_counts: dict = {}

    class Config:
        from_attributes = True


class ApplicationCreate(BaseModel):
    vacancy_id: int
    entity_id: int
    stage: ApplicationStage = ApplicationStage.applied  # Default to 'applied' (exists in DB enum, shown as "Новый" in UI)
    rating: Optional[int] = None
    notes: Optional[str] = None
    source: Optional[str] = None


class ApplicationUpdate(BaseModel):
    stage: Optional[ApplicationStage] = None
    stage_order: Optional[int] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    next_interview_at: Optional[datetime] = None


class ApplicationResponse(BaseModel):
    id: int
    vacancy_id: int
    vacancy_title: Optional[str] = None
    entity_id: int
    entity_name: Optional[str] = None
    entity_type: Optional[EntityType] = None
    entity_email: Optional[str] = None
    entity_phone: Optional[str] = None
    entity_position: Optional[str] = None
    stage: ApplicationStage
    stage_order: int = 0
    rating: Optional[int] = None
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    source: Optional[str] = None
    next_interview_at: Optional[datetime] = None
    applied_at: datetime
    last_stage_change_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class KanbanColumn(BaseModel):
    stage: ApplicationStage
    title: str
    applications: List[ApplicationResponse]
    count: int  # Number of applications loaded (may be limited)
    total_count: int = 0  # Total applications in this stage (for "X more" indicator)
    has_more: bool = False  # True if there are more applications not loaded


class KanbanBoard(BaseModel):
    vacancy_id: int
    vacancy_title: str
    columns: List[KanbanColumn]
    total_count: int


class BulkStageUpdate(BaseModel):
    application_ids: List[int]
    stage: ApplicationStage


# === Vacancy CRUD Endpoints ===

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


# === Application Endpoints ===

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

    # Track stage change
    if data.stage and data.stage != application.stage:
        application.last_stage_change_at = datetime.utcnow()

        # Update stage_order for the new stage
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
    from ..models.database import EntityStatus

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


# === Kanban Board Endpoints ===

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
    # Mapping: applied=Новый, screening=Скрининг, phone_screen=Практика,
    #          interview=Тех-практика, assessment=ИС, offer=Оффер, hired=Принят, rejected=Отказ
    stage_config = [
        (ApplicationStage.applied, "Новый", [ApplicationStage.applied]),
        (ApplicationStage.screening, "Скрининг", [ApplicationStage.screening]),
        (ApplicationStage.phone_screen, "Практика", [ApplicationStage.phone_screen]),
        (ApplicationStage.interview, "Тех-практика", [ApplicationStage.interview]),
        (ApplicationStage.assessment, "ИС", [ApplicationStage.assessment]),
        (ApplicationStage.offer, "Оффер", [ApplicationStage.offer]),
        (ApplicationStage.hired, "Принят", [ApplicationStage.hired]),
        (ApplicationStage.rejected, "Отказ", [ApplicationStage.rejected]),
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
        ApplicationStage.applied: "Новый",
        ApplicationStage.screening: "Скрининг",
        ApplicationStage.phone_screen: "Практика",
        ApplicationStage.interview: "Тех-практика",
        ApplicationStage.assessment: "ИС",
        ApplicationStage.offer: "Оффер",
        ApplicationStage.hired: "Принят",
        ApplicationStage.rejected: "Отказ",
        ApplicationStage.withdrawn: "Отозван",
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
    max_order_result = await db.execute(
        select(func.max(VacancyApplication.stage_order))
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == data.stage
        )
    )
    max_order = max_order_result.scalar() or 0

    now = datetime.utcnow()

    # Synchronize VacancyApplication.stage → Entity.status
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
                logger.info(f"bulk-move: Synchronized application {app.id} stage {data.stage} → entity {entity.id} status {new_entity_status}")

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
    from datetime import timedelta
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
    from ..services.vacancy_recommender import vacancy_recommender

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
    from ..services.vacancy_recommender import vacancy_recommender

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
            detail="Можно уведомлять кандидатов только по открытым вакансиям"
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
        message=f"Найдено {len(candidates_to_notify)} подходящих кандидатов для уведомления"
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
            detail="Кандидат уже добавлен в эту вакансию"
        )

    # Get max stage_order
    max_order_result = await db.execute(
        select(func.max(VacancyApplication.stage_order))
        .where(
            VacancyApplication.vacancy_id == vacancy_id,
            VacancyApplication.stage == stage
        )
    )
    max_order = max_order_result.scalar() or 0

    # Create application
    application = VacancyApplication(
        vacancy_id=vacancy_id,
        entity_id=entity_id,
        stage=stage,
        stage_order=max_order + 1,
        source="hr_invitation",
        notes=notes or f"Приглашён HR на этап {stage.value}",
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
        "message": f"Кандидат {entity.name} приглашён на вакансию {vacancy.title}"
    }


# ============================================================================
# VACANCY SHARING ENDPOINTS
# ============================================================================

class VacancyShareRequest(BaseModel):
    """Request schema for sharing a vacancy."""
    shared_with_id: int
    access_level: AccessLevel = AccessLevel.view
    note: Optional[str] = None
    expires_at: Optional[datetime] = None


class VacancyShareResponse(BaseModel):
    """Response schema for vacancy share operations."""
    id: int
    vacancy_id: int
    vacancy_title: str
    shared_by_id: int
    shared_by_name: str
    shared_with_id: int
    shared_with_name: str
    access_level: AccessLevel
    note: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/{vacancy_id}/share")
async def share_vacancy(
    vacancy_id: int,
    request: VacancyShareRequest,
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Share a vacancy with another user.

    Only users who can share the vacancy (admin, owner, creator, lead, or users with full access)
    can share it with others.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = result.scalar_one_or_none()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check if user can share
    if not await can_share_vacancy(vacancy, current_user, org, db):
        raise HTTPException(
            status_code=403,
            detail="У вас нет прав для предоставления доступа к этой вакансии"
        )

    # Check if target user exists and is in the same org
    target_result = await db.execute(
        select(User).join(OrgMember).where(
            User.id == request.shared_with_id,
            OrgMember.org_id == org.id,
            User.is_active == True
        )
    )
    target_user = target_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=404,
            detail="Пользователь не найден или не является членом организации"
        )

    # Can't share with yourself
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя поделиться с самим собой")

    # Check if share already exists
    existing = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id,
            SharedAccess.shared_with_id == request.shared_with_id
        )
    )
    existing_share = existing.scalar_one_or_none()

    if existing_share:
        # Update existing share
        existing_share.access_level = request.access_level
        existing_share.note = request.note
        existing_share.expires_at = request.expires_at
        existing_share.shared_by_id = current_user.id
        await db.commit()
        await db.refresh(existing_share)
        share = existing_share
    else:
        # Create new share
        share = SharedAccess(
            resource_type=ResourceType.vacancy,
            resource_id=vacancy_id,
            vacancy_id=vacancy_id,
            shared_by_id=current_user.id,
            shared_with_id=request.shared_with_id,
            access_level=request.access_level,
            note=request.note,
            expires_at=request.expires_at
        )
        db.add(share)
        await db.commit()
        await db.refresh(share)

    logger.info(
        f"User {current_user.id} shared vacancy {vacancy_id} with user {request.shared_with_id} "
        f"(level: {request.access_level.value})"
    )

    return VacancyShareResponse(
        id=share.id,
        vacancy_id=vacancy_id,
        vacancy_title=vacancy.title,
        shared_by_id=current_user.id,
        shared_by_name=current_user.name,
        shared_with_id=target_user.id,
        shared_with_name=target_user.name,
        access_level=share.access_level,
        note=share.note,
        expires_at=share.expires_at,
        created_at=share.created_at
    )


@router.get("/{vacancy_id}/shares")
async def get_vacancy_shares(
    vacancy_id: int,
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all shares for a vacancy.

    Only users who can share the vacancy can see its shares.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = result.scalar_one_or_none()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check if user can share (which also means they can view shares)
    if not await can_share_vacancy(vacancy, current_user, org, db):
        raise HTTPException(
            status_code=403,
            detail="У вас нет прав для просмотра доступа к этой вакансии"
        )

    # Get all shares
    shares_result = await db.execute(
        select(SharedAccess, User)
        .join(User, User.id == SharedAccess.shared_with_id)
        .where(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id
        )
        .order_by(SharedAccess.created_at.desc())
    )

    shares = []
    for share, user in shares_result.all():
        # Get shared_by user name
        shared_by_result = await db.execute(
            select(User.name).where(User.id == share.shared_by_id)
        )
        shared_by_name = shared_by_result.scalar() or "Unknown"

        shares.append({
            "id": share.id,
            "vacancy_id": vacancy_id,
            "vacancy_title": vacancy.title,
            "shared_by_id": share.shared_by_id,
            "shared_by_name": shared_by_name,
            "shared_with_id": user.id,
            "shared_with_name": user.name,
            "shared_with_email": user.email,
            "access_level": share.access_level.value,
            "note": share.note,
            "expires_at": share.expires_at.isoformat() if share.expires_at else None,
            "created_at": share.created_at.isoformat() if share.created_at else None
        })

    return {"shares": shares, "total": len(shares)}


@router.delete("/{vacancy_id}/share/{share_id}")
async def revoke_vacancy_share(
    vacancy_id: int,
    share_id: int,
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Revoke a share for a vacancy.

    Only users who can share the vacancy can revoke shares.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = result.scalar_one_or_none()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check if user can share
    if not await can_share_vacancy(vacancy, current_user, org, db):
        raise HTTPException(
            status_code=403,
            detail="У вас нет прав для отзыва доступа к этой вакансии"
        )

    # Get share
    share_result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.id == share_id,
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id
        )
    )
    share = share_result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Delete share
    await db.delete(share)
    await db.commit()

    logger.info(
        f"User {current_user.id} revoked share {share_id} for vacancy {vacancy_id}"
    )

    return {"message": "Доступ отозван", "share_id": share_id}


@router.get("/shared-with-me")
async def get_vacancies_shared_with_me(
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all vacancies that have been shared with the current user.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get shared vacancy IDs
    shared_ids = await get_shared_vacancy_ids(current_user.id, db)

    if not shared_ids:
        return {"vacancies": [], "total": 0}

    # Get vacancies with their share info
    result = await db.execute(
        select(Vacancy, SharedAccess)
        .join(SharedAccess, and_(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == Vacancy.id,
            SharedAccess.shared_with_id == current_user.id
        ))
        .where(
            Vacancy.id.in_(shared_ids),
            Vacancy.org_id == org.id
        )
        .order_by(SharedAccess.created_at.desc())
    )

    vacancies = []
    for vacancy, share in result.all():
        # Get shared_by user name
        shared_by_result = await db.execute(
            select(User.name).where(User.id == share.shared_by_id)
        )
        shared_by_name = shared_by_result.scalar() or "Unknown"

        # Get applications count
        apps_count_result = await db.execute(
            select(func.count(VacancyApplication.id))
            .where(VacancyApplication.vacancy_id == vacancy.id)
        )
        apps_count = apps_count_result.scalar() or 0

        vacancies.append({
            "id": vacancy.id,
            "title": vacancy.title,
            "description": vacancy.description,
            "status": vacancy.status.value,
            "department_id": vacancy.department_id,
            "applications_count": apps_count,
            "share": {
                "id": share.id,
                "shared_by_id": share.shared_by_id,
                "shared_by_name": shared_by_name,
                "access_level": share.access_level.value,
                "note": share.note,
                "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                "created_at": share.created_at.isoformat() if share.created_at else None
            }
        })

    return {"vacancies": vacancies, "total": len(vacancies)}
