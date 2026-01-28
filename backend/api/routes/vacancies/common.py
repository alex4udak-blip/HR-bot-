"""
Shared schemas, imports, and helper functions for vacancy management.
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

from ...database import get_db
from ...models.database import (
    Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Entity, EntityType, User, Organization, Department, STAGE_SYNC_MAP, STATUS_SYNC_MAP,
    UserRole, OrgMember, OrgRole, DepartmentMember, DeptRole,
    SharedAccess, ResourceType, AccessLevel
)
from ...services.auth import get_current_user, get_user_org, has_full_database_access as auth_has_full_database_access
from ...services.features import can_access_feature
from ...services.cache import scoring_cache


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
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
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
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
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
    stage: ApplicationStage = ApplicationStage.applied  # Default to 'applied' (exists in DB enum, shown as "Novyj" in UI)
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
