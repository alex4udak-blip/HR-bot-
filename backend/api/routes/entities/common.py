"""
Common imports, schemas, and helper functions for entities module.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Request
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional, List, Literal
from datetime import datetime
from pydantic import BaseModel, field_validator
import re
import logging
import asyncio

import aiofiles

logger = logging.getLogger("hr-analyzer.entities")

from ...database import get_db
from ...models.database import (
    Entity, EntityType, EntityStatus, EntityTransfer,
    Chat, CallRecording, AnalysisHistory, User, Organization,
    SharedAccess, ResourceType, UserRole, AccessLevel, OrgRole, OrgMember,
    Department, DepartmentMember, DeptRole, Vacancy, Message,
    VacancyApplication, STATUS_SYNC_MAP, STAGE_SYNC_MAP,
    EntityFile, EntityFileType, VacancyStatus, ApplicationStage
)
from ...services.auth import get_current_user, get_user_org, get_user_org_role, can_share_to, has_full_database_access
from ...services.red_flags import red_flags_service
from ...services.cache import scoring_cache
from ...models.sharing import ShareRequestWithRelated as ShareRequest
from ..realtime import broadcast_entity_created, broadcast_entity_updated, broadcast_entity_deleted
from ...limiter import limiter


def _get_rate_limit_key(request: Request) -> str:
    """Get rate limit key based on authenticated user ID."""
    user = getattr(request.state, '_rate_limit_user', None)
    if user and hasattr(user, 'id'):
        return f"user:{user.id}"
    return request.client.host if request.client else "unknown"


# Ownership filter type
OwnershipFilter = Literal["all", "mine", "shared"]


# === Background Profile Regeneration ===

async def regenerate_entity_profile_background(entity_id: int, org_id: int):
    """
    Background task to regenerate entity AI profile when new context is added.
    Called when files, chats, or calls are linked to an entity.
    """
    from ...database import AsyncSessionLocal
    from ...services.entity_profile import entity_profile_service

    try:
        async with AsyncSessionLocal() as db:
            # Load entity with files
            entity_result = await db.execute(
                select(Entity)
                .options(selectinload(Entity.files))
                .where(Entity.id == entity_id, Entity.org_id == org_id)
            )
            entity = entity_result.scalar_one_or_none()
            if not entity:
                logger.warning(f"Profile regen: entity {entity_id} not found")
                return

            # Load chats with messages
            chats_result = await db.execute(
                select(Chat)
                .options(selectinload(Chat.messages))
                .where(Chat.entity_id == entity_id, Chat.org_id == org_id)
            )
            chats = list(chats_result.scalars().all())

            # Load calls
            calls_result = await db.execute(
                select(CallRecording)
                .where(CallRecording.entity_id == entity_id, CallRecording.org_id == org_id)
            )
            calls = list(calls_result.scalars().all())

            # Generate new profile
            profile = await entity_profile_service.generate_profile(
                entity=entity,
                chats=chats,
                calls=calls,
                files=entity.files
            )

            # Save profile
            if not entity.extra_data:
                entity.extra_data = {}
            entity.extra_data['ai_profile'] = profile
            await db.commit()

            logger.info(f"Profile regen: success for entity {entity_id}")
    except Exception as e:
        logger.error(f"Profile regen: error for entity {entity_id}: {e}")


# === Pydantic Schemas ===

class EntityCreate(BaseModel):
    type: EntityType
    name: str
    status: Optional[EntityStatus] = EntityStatus.new
    # Legacy single identifiers (kept for backward compatibility)
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    # New multiple identifiers
    telegram_usernames: Optional[List[str]] = []
    emails: Optional[List[str]] = []
    phones: Optional[List[str]] = []
    company: Optional[str] = None
    position: Optional[str] = None
    tags: Optional[List[str]] = []
    extra_data: Optional[dict] = {}
    department_id: Optional[int] = None
    # Expected salary for candidates
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: Optional[str] = 'RUB'

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        cleaned = re.sub(r"<[^>]*>", "", v).strip()
        if not cleaned:
            raise ValueError("name cannot be empty")
        return cleaned[:200]

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, v):
        if v is None:
            return []
        out = []
        for t in v:
            if isinstance(t, str):
                cleaned = re.sub(r"<[^>]*>", "", t).strip()[:80]
                if cleaned:
                    out.append(cleaned)
        return out


class EntityUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[EntityStatus] = None
    # Legacy single identifiers (kept for backward compatibility)
    phone: Optional[str] = None
    email: Optional[str] = None
    # New multiple identifiers
    telegram_usernames: Optional[List[str]] = None
    emails: Optional[List[str]] = None
    phones: Optional[List[str]] = None
    company: Optional[str] = None
    position: Optional[str] = None
    tags: Optional[List[str]] = None
    extra_data: Optional[dict] = None
    department_id: Optional[int] = None
    # Expected salary for candidates
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: Optional[str] = None
    # Optimistic locking version (optional, for concurrent update detection)
    version: Optional[int] = None

    @staticmethod
    def _strip_html(s: str) -> str:
        return re.sub(r"<[^>]*>", "", s).strip()

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v):
        if v is None:
            return v
        return cls._strip_html(v)[:200]

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, v):
        if v is None:
            return v
        out = []
        for t in v:
            if isinstance(t, str):
                cleaned = cls._strip_html(t)[:80]
                if cleaned:
                    out.append(cleaned)
        return out


class TransferCreate(BaseModel):
    to_user_id: int
    to_department_id: Optional[int] = None
    comment: Optional[str] = None


class EntityResponse(BaseModel):
    id: int
    type: EntityType
    name: str
    status: EntityStatus
    # Legacy single identifiers (kept for backward compatibility)
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    # New multiple identifiers
    telegram_usernames: List[str] = []
    emails: List[str] = []
    phones: List[str] = []
    company: Optional[str] = None
    position: Optional[str] = None
    tags: List[str] = []
    extra_data: dict = {}
    created_by: Optional[int] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    chats_count: int = 0
    calls_count: int = 0
    # Transfer tracking
    is_transferred: bool = False
    transferred_to_id: Optional[int] = None
    transferred_to_name: Optional[str] = None
    transferred_at: Optional[datetime] = None
    # Expected salary for candidates
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: Optional[str] = 'RUB'
    # Vacancy tracking for candidates
    vacancies_count: int = 0
    vacancy_names: List[str] = []  # Names of vacancies (first 3)

    class Config:
        from_attributes = True


class TransferResponse(BaseModel):
    id: int
    entity_id: int
    from_user_id: Optional[int] = None
    to_user_id: Optional[int] = None
    from_department_id: Optional[int] = None
    to_department_id: Optional[int] = None
    from_department_name: Optional[str] = None
    to_department_name: Optional[str] = None
    comment: Optional[str] = None
    created_at: datetime
    from_user_name: Optional[str] = None
    to_user_name: Optional[str] = None

    class Config:
        from_attributes = True


class StatusUpdate(BaseModel):
    """Quick status update for Kanban drag & drop"""
    status: EntityStatus


# === Helper Functions ===

def normalize_telegram_username(username: str) -> str:
    """
    Normalize telegram username by removing @ and converting to lowercase.

    Args:
        username: Raw telegram username (may include @)

    Returns:
        Normalized username (lowercase, without @)
    """
    if not username:
        return ""
    # Remove @ prefix if present
    normalized = username.lstrip('@').strip()
    # Convert to lowercase
    return normalized.lower()


def validate_email(email: str) -> bool:
    """
    Validate email format using a simple regex.

    Args:
        email: Email address to validate

    Returns:
        True if email is valid, False otherwise
    """
    if not email:
        return False
    # Simple email regex pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def normalize_and_validate_identifiers(
    telegram_usernames: Optional[List[str]] = None,
    emails: Optional[List[str]] = None,
    phones: Optional[List[str]] = None
) -> tuple[List[str], List[str], List[str]]:
    """
    Normalize and validate multiple identifiers.

    Args:
        telegram_usernames: List of telegram usernames
        emails: List of email addresses
        phones: List of phone numbers

    Returns:
        Tuple of (normalized_usernames, validated_emails, phones)

    Raises:
        HTTPException: If any email is invalid
    """
    # Normalize telegram usernames
    normalized_usernames = []
    if telegram_usernames:
        for username in telegram_usernames:
            if username:
                normalized = normalize_telegram_username(username)
                if normalized and normalized not in normalized_usernames:
                    normalized_usernames.append(normalized)

    # Validate and filter emails
    validated_emails = []
    if emails:
        for email in emails:
            if email:
                email = email.strip()
                if not validate_email(email):
                    raise HTTPException(400, f"Invalid email format: {email}")
                if email not in validated_emails:
                    validated_emails.append(email)

    # Filter phones (remove duplicates, keep non-empty)
    filtered_phones = []
    if phones:
        for phone in phones:
            if phone:
                phone = phone.strip()
                if phone and phone not in filtered_phones:
                    filtered_phones.append(phone)

    return normalized_usernames, validated_emails, filtered_phones


async def check_entity_access(
    entity: Entity,
    user: User,
    org_id: int,
    db: AsyncSession,
    required_level: Optional[AccessLevel] = None
) -> bool:
    """
    Check if user has access to entity based on new role hierarchy.

    Hierarchy:
    1. SUPERADMIN - sees EVERYTHING without exceptions
    2. OWNER - sees everything in organization, BUT NOT private content created by SUPERADMIN
    3. ADMIN (lead) - sees all resources in their department
    4. SUB_ADMIN - same as ADMIN for viewing (management rights differ)
    5. MEMBER - sees only THEIR OWN resources

    Args:
        entity: Entity to check access for
        user: Current user
        org_id: Organization ID
        db: Database session
        required_level: Minimum access level required (None for read, edit for update, full for delete/transfer)

    Returns:
        True if user has required access, False otherwise
    """
    from ...services.auth import is_superadmin, is_owner, can_view_in_department, was_created_by_superadmin

    # 1. SUPERADMIN - has access to EVERYTHING
    if is_superadmin(user):
        return True

    # 2. OWNER - has access to everything in organization, EXCEPT private content created by SUPERADMIN
    if await is_owner(user, org_id, db):
        # Check if entity was created by SUPERADMIN (private content restriction)
        if await was_created_by_superadmin(entity, db):
            # OWNER cannot access private SUPERADMIN content
            return False
        return True

    # 3. Entity owner has full access to their own resources
    if entity.created_by == user.id:
        return True

    # 3.5 Модель A («общий пул HR»): любой член организации ВИДИТ (read) всех
    # КАНДИДАТОВ своей орг. Без этого доска показывала всех (запрос только по
    # org_id), а детали/файлы/дедуп чужих кандидатов не открывались — рассинхрон.
    # Скоуп: только кандидаты (клиенты/партнёры — по строгим правилам ниже) и
    # строго в границах орга (entity в org_id И пользователь — член этого org_id;
    # cross-org остаётся закрыт). Правки/удаление — по правилам ниже.
    if (
        required_level is None
        and getattr(entity, "type", None) == EntityType.candidate
        and getattr(entity, "org_id", None) == org_id
    ):
        om = await db.execute(
            select(OrgMember.id).where(
                OrgMember.org_id == org_id,
                OrgMember.user_id == user.id,
            ).limit(1)
        )
        if om.scalar() is not None:
            return True

    # 4. Department-based access (ADMIN/SUB_ADMIN/MEMBER)
    if entity.department_id:
        dept_can_view = await can_view_in_department(
            user,
            resource_owner_id=entity.created_by,
            resource_dept_id=entity.department_id,
            db=db
        )

        if dept_can_view:
            # Can view based on department role
            # For modifications, need to check if user is admin
            if required_level is None:
                # Read access - granted
                return True
            elif required_level in (AccessLevel.edit, AccessLevel.full):
                # Edit/delete/transfer - only ADMIN/SUB_ADMIN can do this
                from ...services.auth import is_department_admin
                if await is_department_admin(user, entity.department_id, db):
                    return True
                # Otherwise fall through to SharedAccess check

    # 5. Check SharedAccess for explicitly shared resources
    shared_result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == ResourceType.entity,
            SharedAccess.resource_id == entity.id,
            SharedAccess.shared_with_id == user.id,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )
    )
    shared_access = shared_result.scalar_one_or_none()

    if not shared_access:
        # 6. Доступ через вакансию: рекрутёр работает с заявкой,
        # на которую этот entity подал заявку. Только для read-доступа.
        if required_level is None:
            from sqlalchemy import text as _text
            vac_app_q = select(VacancyApplication.id).join(
                Vacancy, Vacancy.id == VacancyApplication.vacancy_id
            ).where(
                VacancyApplication.entity_id == entity.id,
                or_(
                    Vacancy.created_by == user.id,
                    Vacancy.hiring_manager_id == user.id,
                    Vacancy.visible_to_all == True,
                    Vacancy.assigned_to_all == True,
                    _text(f"vacancies.assigned_to::jsonb @> '[{int(user.id)}]'::jsonb"),
                ),
            ).limit(1)
            vac_app_result = await db.execute(vac_app_q)
            if vac_app_result.scalar_one_or_none() is not None:
                return True
        return False

    # Check access level
    if required_level is None:
        # Any access level allows read
        return True
    elif required_level == AccessLevel.edit:
        # Edit requires edit or full
        return shared_access.access_level in [AccessLevel.edit, AccessLevel.full]
    elif required_level == AccessLevel.full:
        # Full operations require full access
        return shared_access.access_level == AccessLevel.full

    return False
