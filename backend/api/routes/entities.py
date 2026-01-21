from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Literal
from datetime import datetime
from pydantic import BaseModel
import re
import logging

logger = logging.getLogger("hr-analyzer.entities")

from ..database import get_db
from ..models.database import (
    Entity, EntityType, EntityStatus, EntityTransfer,
    Chat, CallRecording, AnalysisHistory, User, Organization,
    SharedAccess, ResourceType, UserRole, AccessLevel, OrgRole,
    Department, DepartmentMember, DeptRole, Vacancy, Message,
    VacancyApplication, STATUS_SYNC_MAP
)
from ..services.auth import get_current_user, get_user_org, get_user_org_role, can_share_to, has_full_database_access
from ..services.red_flags import red_flags_service
from ..services.cache import scoring_cache
from ..models.sharing import ShareRequestWithRelated as ShareRequest
from .realtime import broadcast_entity_created, broadcast_entity_updated, broadcast_entity_deleted

# Ownership filter type
OwnershipFilter = Literal["all", "mine", "shared"]

router = APIRouter()


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
    from ..services.auth import is_superadmin, is_owner, can_view_in_department, was_created_by_superadmin

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
                from ..services.auth import is_department_admin
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


# === Routes ===

@router.get("")
async def list_entities(
    type: Optional[EntityType] = None,
    status: Optional[EntityStatus] = None,
    search: Optional[str] = None,
    identifier: Optional[str] = None,  # Search by any identifier (email, phone, telegram username)
    tags: Optional[str] = None,  # comma-separated
    ownership: Optional[OwnershipFilter] = None,  # mine, shared, all
    department_id: Optional[int] = None,  # filter by department
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List contacts with filters (filtered by user's organization and departments)"""
    current_user = await db.merge(current_user)

    # Initialize org for all code paths
    org = None

    # SUPERADMIN sees everything across all organizations
    if current_user.role == UserRole.superadmin:
        query = select(Entity)
        # Apply filters
        if ownership == "mine":
            query = query.where(Entity.created_by == current_user.id)
        # For superadmin, skip org/department filtering
    else:
        org = await get_user_org(current_user, db)
        if not org:
            return []

        # Get user's department memberships for access control
        dept_memberships_result = await db.execute(
            select(DepartmentMember).where(DepartmentMember.user_id == current_user.id)
        )
        dept_memberships = list(dept_memberships_result.scalars().all())
        user_dept_ids = [dm.department_id for dm in dept_memberships]
        # Only lead and sub_admin can see all department entities
        # Use enum comparison since dm.role comes from DB as DeptRole enum
        admin_dept_ids = [dm.department_id for dm in dept_memberships if dm.role in (DeptRole.lead, DeptRole.sub_admin)]

        # Shared entities query
        shared_ids_query = select(SharedAccess.resource_id).where(
            SharedAccess.resource_type == ResourceType.entity,
            SharedAccess.shared_with_id == current_user.id,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )

        # Determine base query based on ownership filter
        if ownership == "mine":
            # Only entities created by current user
            query = select(Entity).where(
                Entity.org_id == org.id,
                Entity.created_by == current_user.id
            )
        elif ownership == "shared":
            # Only entities shared with current user (not owned by them)
            query = select(Entity).where(
                Entity.org_id == org.id,
                Entity.id.in_(shared_ids_query),
                Entity.created_by != current_user.id
            )
        else:
            # All entities user can see: own + shared + department entities
            # Full access (superadmin, owner, or member with has_full_access flag) sees all
            has_full_access = await has_full_database_access(current_user, org.id, db)
            if has_full_access:
                query = select(Entity).where(Entity.org_id == org.id)
            else:
                # Own entities + shared with me + department entities (for admins only)
                conditions = [
                    Entity.created_by == current_user.id,
                    Entity.id.in_(shared_ids_query)
                ]
                # Only lead/sub_admin can view all entities in their departments
                # Regular members see only their own entities + shared
                if admin_dept_ids:
                    # Get all user IDs from admin's departments
                    dept_member_ids_result = await db.execute(
                        select(DepartmentMember.user_id).where(
                            DepartmentMember.department_id.in_(admin_dept_ids)
                        )
                    )
                    dept_member_ids = [r for r in dept_member_ids_result.scalars().all()]

                    # DEBUG: Log department access info
                    logger.info(f"list_entities: user={current_user.id}, admin_dept_ids={admin_dept_ids}, dept_member_ids={dept_member_ids}")

                    # Show entities created by department members (even without department_id)
                    if dept_member_ids:
                        conditions.append(Entity.created_by.in_(dept_member_ids))
                    # Also show entities explicitly assigned to admin's departments
                    conditions.append(Entity.department_id.in_(admin_dept_ids))

                query = select(Entity).where(
                    Entity.org_id == org.id,
                    or_(*conditions)
                )

    if type:
        query = query.where(Entity.type == type)
    if status:
        query = query.where(Entity.status == status)
    if search:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Entity.name.ilike(search_term),
                Entity.email.ilike(search_term),
                Entity.phone.ilike(search_term),
                Entity.company.ilike(search_term)
            )
        )
    if identifier:
        # Search by any identifier: email, emails[], phone, phones[], telegram_usernames[]
        identifier_term = identifier.strip()
        # Normalize telegram username for search
        normalized_username = normalize_telegram_username(identifier_term)
        query = query.where(
            or_(
                Entity.email.ilike(f"%{identifier_term}%"),
                Entity.phone.ilike(f"%{identifier_term}%"),
                # For JSON arrays, use PostgreSQL's JSONB operators
                func.jsonb_array_length(Entity.emails) > 0 and Entity.emails.op('@>')(func.jsonb_build_array(identifier_term)),
                func.jsonb_array_length(Entity.phones) > 0 and Entity.phones.op('@>')(func.jsonb_build_array(identifier_term)),
                func.jsonb_array_length(Entity.telegram_usernames) > 0 and Entity.telegram_usernames.op('@>')(func.jsonb_build_array(normalized_username))
            )
        )
    if tags:
        tag_list = [t.strip() for t in tags.split(",")]
        for tag in tag_list:
            query = query.where(Entity.tags.contains([tag]))
    if department_id:
        query = query.where(Entity.department_id == department_id)

    query = query.order_by(Entity.updated_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    entities = result.scalars().all()

    # DEBUG: Log query results
    logger.info(f"list_entities RESULT: user={current_user.id}, found {len(entities)} entities, ids={[e.id for e in entities][:20]}")

    if not entities:
        return []

    # Get all entity IDs for batch queries
    entity_ids = [entity.id for entity in entities]

    # Pre-fetch shared entity IDs for current user
    shared_with_me_result = await db.execute(
        select(SharedAccess.resource_id).where(
            SharedAccess.resource_type == ResourceType.entity,
            SharedAccess.shared_with_id == current_user.id,
            or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
        )
    )
    shared_with_me_ids = set(shared_with_me_result.scalars().all())

    # Pre-fetch owner names
    creator_ids = list(set(e.created_by for e in entities if e.created_by))
    owner_names = {}
    if creator_ids:
        owners_result = await db.execute(select(User).where(User.id.in_(creator_ids)))
        for owner in owners_result.scalars().all():
            owner_names[owner.id] = owner.name

    # Pre-fetch transferred_to names
    transferred_to_ids = list(set(e.transferred_to_id for e in entities if e.transferred_to_id))
    transferred_to_names = {}
    if transferred_to_ids:
        transferred_result = await db.execute(select(User).where(User.id.in_(transferred_to_ids)))
        for user in transferred_result.scalars().all():
            transferred_to_names[user.id] = user.name

    # Pre-fetch department names
    dept_ids = list(set(e.department_id for e in entities if e.department_id))
    dept_names = {}
    if dept_ids:
        depts_result = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        for dept in depts_result.scalars().all():
            dept_names[dept.id] = dept.name

    # Batch query: Get chat/call counts WITH ACCESS CONTROL
    # Full access users (superadmin, owner, or member with has_full_access) see all counts
    user_has_full_access = await has_full_database_access(current_user, org.id, db) if org else False

    if user_has_full_access:
        # Full access - count all chats/calls
        chats_counts_result = await db.execute(
            select(Chat.entity_id, func.count(Chat.id))
            .where(Chat.entity_id.in_(entity_ids))
            .group_by(Chat.entity_id)
        )
        chats_counts = {row[0]: row[1] for row in chats_counts_result.fetchall()}

        calls_counts_result = await db.execute(
            select(CallRecording.entity_id, func.count(CallRecording.id))
            .where(CallRecording.entity_id.in_(entity_ids))
            .group_by(CallRecording.entity_id)
        )
        calls_counts = {row[0]: row[1] for row in calls_counts_result.fetchall()}
    else:
        # Limited access - count only accessible chats/calls
        # Get IDs of chats shared with current user
        shared_chats_result = await db.execute(
            select(SharedAccess.resource_id).where(
                SharedAccess.resource_type == ResourceType.chat,
                SharedAccess.shared_with_id == current_user.id,
                or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
            )
        )
        shared_chat_ids = set(shared_chats_result.scalars().all())

        # Get IDs of calls shared with current user
        shared_calls_result = await db.execute(
            select(SharedAccess.resource_id).where(
                SharedAccess.resource_type == ResourceType.call,
                SharedAccess.shared_with_id == current_user.id,
                or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
            )
        )
        shared_call_ids = set(shared_calls_result.scalars().all())

        # Get departments where user is lead or sub_admin
        # Use string values to avoid enum serialization issues
        admin_dept_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == current_user.id,
                DepartmentMember.role.in_([DeptRole.lead, DeptRole.sub_admin])
            )
        )
        admin_dept_ids = [r for r in admin_dept_result.scalars().all()]

        # Get user IDs in departments where current user is lead/sub_admin
        dept_member_ids = set()
        if admin_dept_ids:
            dept_members_result = await db.execute(
                select(DepartmentMember.user_id).where(
                    DepartmentMember.department_id.in_(admin_dept_ids)
                )
            )
            dept_member_ids = set(dept_members_result.scalars().all())

        # Build chat access conditions
        chat_conditions = [Chat.owner_id == current_user.id]  # Own chats
        if shared_chat_ids:
            chat_conditions.append(Chat.id.in_(shared_chat_ids))  # Shared with me
        if dept_member_ids:
            chat_conditions.append(Chat.owner_id.in_(dept_member_ids))  # Dept members' chats

        chats_counts_result = await db.execute(
            select(Chat.entity_id, func.count(Chat.id))
            .where(Chat.entity_id.in_(entity_ids), or_(*chat_conditions))
            .group_by(Chat.entity_id)
        )
        chats_counts = {row[0]: row[1] for row in chats_counts_result.fetchall()}

        # Build call access conditions
        call_conditions = [CallRecording.owner_id == current_user.id]  # Own calls
        if shared_call_ids:
            call_conditions.append(CallRecording.id.in_(shared_call_ids))  # Shared with me
        if dept_member_ids:
            call_conditions.append(CallRecording.owner_id.in_(dept_member_ids))  # Dept members' calls

        calls_counts_result = await db.execute(
            select(CallRecording.entity_id, func.count(CallRecording.id))
            .where(CallRecording.entity_id.in_(entity_ids), or_(*call_conditions))
            .group_by(CallRecording.entity_id)
        )
        calls_counts = {row[0]: row[1] for row in calls_counts_result.fetchall()}

    # Batch query: Get vacancy application counts and vacancy names
    vacancies_counts = {}
    vacancy_names_map = {}
    try:
        # Get vacancy applications grouped by entity
        apps_result = await db.execute(
            select(VacancyApplication.entity_id, VacancyApplication.vacancy_id)
            .where(VacancyApplication.entity_id.in_(entity_ids))
        )
        apps_data = apps_result.fetchall()

        # Collect vacancy IDs and count per entity
        vacancy_ids = set()
        entity_vacancy_ids = {}  # {entity_id: [vacancy_ids]}
        for entity_id, vacancy_id in apps_data:
            vacancy_ids.add(vacancy_id)
            if entity_id not in entity_vacancy_ids:
                entity_vacancy_ids[entity_id] = []
            entity_vacancy_ids[entity_id].append(vacancy_id)

        # Get vacancy names
        if vacancy_ids:
            vacancies_result = await db.execute(
                select(Vacancy.id, Vacancy.title).where(Vacancy.id.in_(vacancy_ids))
            )
            vacancy_titles = {v.id: v.title for v in vacancies_result.fetchall()}

            # Build counts and names for each entity
            for entity_id, vac_ids in entity_vacancy_ids.items():
                vacancies_counts[entity_id] = len(vac_ids)
                # Get first 3 vacancy names
                names = [vacancy_titles.get(vid, "Unknown") for vid in vac_ids[:3]]
                vacancy_names_map[entity_id] = names
    except Exception as e:
        logger.warning(f"Failed to fetch vacancy data: {e}")
        # Continue without vacancy data

    # Build response using pre-fetched data
    response = []
    for entity in entities:
        is_mine = entity.created_by == current_user.id
        is_shared = entity.id in shared_with_me_ids and not is_mine

        response.append({
            "id": entity.id,
            "type": entity.type,
            "name": entity.name,
            "status": entity.status,
            "phone": entity.phone,
            "email": entity.email,
            "telegram_user_id": entity.telegram_user_id,
            "telegram_usernames": entity.telegram_usernames or [],
            "emails": entity.emails or [],
            "phones": entity.phones or [],
            "company": entity.company,
            "position": entity.position,
            "tags": entity.tags or [],
            "extra_data": entity.extra_data or {},
            "created_by": entity.created_by,
            "owner_name": owner_names.get(entity.created_by, "Unknown"),
            "department_id": entity.department_id,
            "department_name": dept_names.get(entity.department_id) if entity.department_id else None,
            "is_mine": is_mine,
            "is_shared": is_shared,
            "created_at": entity.created_at.isoformat() if entity.created_at else None,
            "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
            "chats_count": chats_counts.get(entity.id, 0),
            "calls_count": calls_counts.get(entity.id, 0),
            # Optimistic locking version
            "version": entity.version or 1,
            # Transfer tracking
            "is_transferred": entity.is_transferred or False,
            "transferred_to_id": entity.transferred_to_id,
            "transferred_to_name": transferred_to_names.get(entity.transferred_to_id) if entity.transferred_to_id else None,
            "transferred_at": entity.transferred_at.isoformat() if entity.transferred_at else None,
            # Expected salary for candidates
            "expected_salary_min": entity.expected_salary_min,
            "expected_salary_max": entity.expected_salary_max,
            "expected_salary_currency": entity.expected_salary_currency or 'RUB',
            # Vacancy tracking
            "vacancies_count": vacancies_counts.get(entity.id, 0),
            "vacancy_names": vacancy_names_map.get(entity.id, [])
        })

    return response


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
    offset: int = Query(0, ge=0),
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
    from ..services.smart_search import smart_search_service

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


@router.post("", status_code=201)
async def create_entity(
    data: EntityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a contact (in user's organization)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Validate department_id if provided
    department_name = None
    if data.department_id:
        dept_result = await db.execute(
            select(Department).where(Department.id == data.department_id, Department.org_id == org.id)
        )
        dept = dept_result.scalar_one_or_none()
        if not dept:
            raise HTTPException(400, "Invalid department")
        department_name = dept.name

    # Normalize and validate multiple identifiers
    normalized_usernames, validated_emails, filtered_phones = normalize_and_validate_identifiers(
        telegram_usernames=data.telegram_usernames,
        emails=data.emails,
        phones=data.phones
    )

    entity = Entity(
        org_id=org.id,
        type=data.type,
        name=data.name,
        status=data.status,
        phone=data.phone,
        email=data.email,
        telegram_user_id=data.telegram_user_id,
        telegram_usernames=normalized_usernames,
        emails=validated_emails,
        phones=filtered_phones,
        company=data.company,
        position=data.position,
        tags=data.tags or [],
        extra_data=data.extra_data or {},
        created_by=current_user.id,
        department_id=data.department_id,
        expected_salary_min=data.expected_salary_min,
        expected_salary_max=data.expected_salary_max,
        expected_salary_currency=data.expected_salary_currency or 'RUB'
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)

    response_data = {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status,
        "phone": entity.phone,
        "email": entity.email,
        "telegram_user_id": entity.telegram_user_id,
        "telegram_usernames": entity.telegram_usernames or [],
        "emails": entity.emails or [],
        "phones": entity.phones or [],
        "company": entity.company,
        "position": entity.position,
        "tags": entity.tags or [],
        "extra_data": entity.extra_data or {},
        "created_by": entity.created_by,
        "department_id": entity.department_id,
        "department_name": department_name,
        "created_at": entity.created_at.isoformat() if entity.created_at else None,
        "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
        "chats_count": 0,
        "calls_count": 0,
        "expected_salary_min": entity.expected_salary_min,
        "expected_salary_max": entity.expected_salary_max,
        "expected_salary_currency": entity.expected_salary_currency or 'RUB'
    }

    # Broadcast entity.created event
    await broadcast_entity_created(org.id, response_data)

    return response_data


@router.get("/{entity_id}")
async def get_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get contact with all relations"""
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

    # Check if user has access to view this entity
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=None)
    if not has_access:
        raise HTTPException(404, "Entity not found")

    # Load related data WITH ACCESS CONTROL
    # Full access users (superadmin, owner, or member with has_full_access) see all
    user_has_full_access = await has_full_database_access(current_user, org.id, db)

    if user_has_full_access:
        chats_result = await db.execute(
            select(Chat).where(Chat.entity_id == entity_id)
        )
        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.entity_id == entity_id).order_by(CallRecording.created_at.desc())
        )
        chats = chats_result.scalars().all()
        calls = calls_result.scalars().all()
    else:
        # Limited access - only show accessible chats/calls
        # Get IDs of chats shared with current user
        shared_chats_result = await db.execute(
            select(SharedAccess.resource_id).where(
                SharedAccess.resource_type == ResourceType.chat,
                SharedAccess.shared_with_id == current_user.id,
                or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
            )
        )
        shared_chat_ids = set(shared_chats_result.scalars().all())

        # Get IDs of calls shared with current user
        shared_calls_result = await db.execute(
            select(SharedAccess.resource_id).where(
                SharedAccess.resource_type == ResourceType.call,
                SharedAccess.shared_with_id == current_user.id,
                or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
            )
        )
        shared_call_ids = set(shared_calls_result.scalars().all())

        # Get departments where user is lead or sub_admin
        # Use string values to avoid enum serialization issues
        admin_dept_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == current_user.id,
                DepartmentMember.role.in_([DeptRole.lead, DeptRole.sub_admin])
            )
        )
        admin_dept_ids = [r for r in admin_dept_result.scalars().all()]

        # Get user IDs in departments where current user is lead/sub_admin
        dept_member_ids = set()
        if admin_dept_ids:
            dept_members_result = await db.execute(
                select(DepartmentMember.user_id).where(
                    DepartmentMember.department_id.in_(admin_dept_ids)
                )
            )
            dept_member_ids = set(dept_members_result.scalars().all())

        # Build chat access conditions
        chat_conditions = [Chat.owner_id == current_user.id]  # Own chats
        if shared_chat_ids:
            chat_conditions.append(Chat.id.in_(shared_chat_ids))  # Shared with me
        if dept_member_ids:
            chat_conditions.append(Chat.owner_id.in_(dept_member_ids))  # Dept members' chats

        chats_result = await db.execute(
            select(Chat).where(Chat.entity_id == entity_id, or_(*chat_conditions))
        )
        chats = chats_result.scalars().all()

        # Build call access conditions
        call_conditions = [CallRecording.owner_id == current_user.id]  # Own calls
        if shared_call_ids:
            call_conditions.append(CallRecording.id.in_(shared_call_ids))  # Shared with me
        if dept_member_ids:
            call_conditions.append(CallRecording.owner_id.in_(dept_member_ids))  # Dept members' calls

        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.entity_id == entity_id, or_(*call_conditions)).order_by(CallRecording.created_at.desc())
        )
        calls = calls_result.scalars().all()

    # Get transfers - wrap in try/except in case new columns don't exist yet
    try:
        transfers_result = await db.execute(
            select(EntityTransfer).where(EntityTransfer.entity_id == entity_id).order_by(EntityTransfer.created_at.desc())
        )
        transfers = transfers_result.scalars().all()
    except Exception as e:
        logger.warning(f"Could not fetch transfers (migration may be pending): {e}")
        transfers = []

    analyses_result = await db.execute(
        select(AnalysisHistory).where(AnalysisHistory.entity_id == entity_id).order_by(AnalysisHistory.created_at.desc())
    )
    analyses = analyses_result.scalars().all()

    # Get department info for entity
    department_name = None
    if entity.department_id:
        dept_result = await db.execute(select(Department).where(Department.id == entity.department_id))
        dept = dept_result.scalar_one_or_none()
        if dept:
            department_name = dept.name

    # Pre-fetch user names and department names for transfers (batch queries to avoid N+1)
    user_ids = set()
    dept_ids = set()
    for t in transfers:
        if t.from_user_id:
            user_ids.add(t.from_user_id)
        if t.to_user_id:
            user_ids.add(t.to_user_id)
        if hasattr(t, 'from_department_id') and t.from_department_id:
            dept_ids.add(t.from_department_id)
        if hasattr(t, 'to_department_id') and t.to_department_id:
            dept_ids.add(t.to_department_id)

    # Batch fetch user names
    user_names = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for user in users_result.scalars().all():
            user_names[user.id] = user.name

    # Batch fetch department names
    dept_names = {}
    if dept_ids:
        depts_result = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        for dept in depts_result.scalars().all():
            dept_names[dept.id] = dept.name

    # Build transfer data using pre-fetched names
    transfer_data = []
    for t in transfers:
        from_user_name = user_names.get(t.from_user_id) if t.from_user_id else None
        to_user_name = user_names.get(t.to_user_id) if t.to_user_id else None
        from_dept_name = None
        to_dept_name = None

        # Get department names (use new fields if available, fallback to old strings)
        if hasattr(t, 'from_department_id') and t.from_department_id:
            from_dept_name = dept_names.get(t.from_department_id)
        elif hasattr(t, 'from_department') and t.from_department:
            from_dept_name = t.from_department

        if hasattr(t, 'to_department_id') and t.to_department_id:
            to_dept_name = dept_names.get(t.to_department_id)
        elif hasattr(t, 'to_department') and t.to_department:
            to_dept_name = t.to_department

        transfer_data.append({
            "id": t.id,
            "entity_id": t.entity_id,
            "from_user_id": t.from_user_id,
            "to_user_id": t.to_user_id,
            "from_department_id": getattr(t, 'from_department_id', None),
            "to_department_id": getattr(t, 'to_department_id', None),
            "from_department_name": from_dept_name,
            "to_department_name": to_dept_name,
            "comment": t.comment,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "from_user_name": from_user_name,
            "to_user_name": to_user_name
        })

    # Get transferred_to name if entity is transferred
    transferred_to_name = None
    if entity.transferred_to_id:
        transferred_to_result = await db.execute(
            select(User.name).where(User.id == entity.transferred_to_id)
        )
        transferred_to_name = transferred_to_result.scalar()

    return {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status,
        "phone": entity.phone,
        "email": entity.email,
        "telegram_user_id": entity.telegram_user_id,
        "telegram_usernames": entity.telegram_usernames or [],
        "emails": entity.emails or [],
        "phones": entity.phones or [],
        "company": entity.company,
        "position": entity.position,
        "tags": entity.tags or [],
        "extra_data": entity.extra_data or {},
        "created_by": entity.created_by,
        "department_id": entity.department_id,
        "department_name": department_name,
        "created_at": entity.created_at.isoformat() if entity.created_at else None,
        "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
        # Optimistic locking version
        "version": entity.version or 1,
        # Transfer tracking
        "is_transferred": entity.is_transferred or False,
        "transferred_to_id": entity.transferred_to_id,
        "transferred_to_name": transferred_to_name,
        "transferred_at": entity.transferred_at.isoformat() if entity.transferred_at else None,
        # Expected salary for candidates
        "expected_salary_min": entity.expected_salary_min,
        "expected_salary_max": entity.expected_salary_max,
        "expected_salary_currency": entity.expected_salary_currency or 'RUB',
        "chats": [
            {
                "id": c.id,
                "title": c.custom_name or c.title,
                "chat_type": c.chat_type,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in chats
        ],
        "calls": [
            {
                "id": c.id,
                "source_type": c.source_type,
                "status": c.status,
                "duration_seconds": c.duration_seconds,
                "summary": c.summary,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in calls
        ],
        "transfers": transfer_data,
        "analyses": [
            {
                "id": a.id,
                "report_type": a.report_type,
                "result": a.result[:500] if a.result else None,
                "created_at": a.created_at.isoformat() if a.created_at else None
            }
            for a in analyses
        ]
    }


@router.get("/{entity_id}/red-flags")
async def get_entity_red_flags(
    entity_id: int,
    vacancy_id: Optional[int] = Query(None, description="Optional vacancy ID to compare against"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get red flags analysis for a candidate.

    Analyzes the candidate's profile and communications for potential red flags:
    - Job hopping (frequent job changes)
    - Employment gaps
    - Salary mismatch (if vacancy provided)
    - Skill inconsistency
    - Overqualified/underqualified
    - Location concerns
    - Missing references
    - Communication issues (AI analysis)

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
        .limit(5)  # Limit to last 5 calls
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


@router.put("/{entity_id}")
async def update_entity(
    entity_id: int,
    data: EntityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Use SELECT FOR UPDATE to prevent race conditions
    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.org_id == org.id)
        .with_for_update()
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Don't allow editing of transferred entities (frozen copies)
    if entity.is_transferred:
        raise HTTPException(400, "Cannot edit a transferred entity. This is a read-only copy.")

    # Check edit permissions (Salesforce-style)
    can_edit = False
    if current_user.role == UserRole.superadmin:
        can_edit = True
    else:
        # Full access (owner or member with has_full_access) can edit all
        user_has_full_access = await has_full_database_access(current_user, org.id, db)
        if user_has_full_access:
            can_edit = True
        elif entity.created_by == current_user.id:
            can_edit = True  # Owner of record
        else:
            # Check if shared with edit/full access
            shared_result = await db.execute(
                select(SharedAccess).where(
                    SharedAccess.resource_type == ResourceType.entity,
                    SharedAccess.resource_id == entity_id,
                    SharedAccess.shared_with_id == current_user.id,
                    SharedAccess.access_level.in_([AccessLevel.edit, AccessLevel.full]),
                    or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
                )
            )
            if shared_result.scalar_one_or_none():
                can_edit = True

    if not can_edit:
        raise HTTPException(403, "No edit permission for this entity")

    # Validate department_id if provided
    if data.department_id is not None:
        if data.department_id:
            dept_result = await db.execute(
                select(Department).where(Department.id == data.department_id, Department.org_id == org.id)
            )
            if not dept_result.scalar_one_or_none():
                raise HTTPException(400, "Invalid department")

    # Normalize and validate multiple identifiers if provided
    if data.telegram_usernames is not None or data.emails is not None or data.phones is not None:
        normalized_usernames, validated_emails, filtered_phones = normalize_and_validate_identifiers(
            telegram_usernames=data.telegram_usernames,
            emails=data.emails,
            phones=data.phones
        )
        # Override the data with normalized values
        if data.telegram_usernames is not None:
            data.telegram_usernames = normalized_usernames
        if data.emails is not None:
            data.emails = validated_emails
        if data.phones is not None:
            data.phones = filtered_phones

    # Optimistic locking: check version if provided
    if data.version is not None and entity.version != data.version:
        raise HTTPException(
            409,
            f"Conflict: Entity was modified by another request. "
            f"Expected version {data.version}, but current version is {entity.version}. "
            f"Please refresh and try again."
        )

    update_data = data.model_dump(exclude_unset=True)
    # Remove version from update_data to prevent it from being set directly
    update_data.pop('version', None)

    for key, value in update_data.items():
        setattr(entity, key, value)

    entity.updated_at = datetime.utcnow()
    # Increment version for optimistic locking
    entity.version = (entity.version or 1) + 1

    # Synchronize Entity.status → VacancyApplication.stage if status changed
    if 'status' in update_data and data.status in STATUS_SYNC_MAP:
        new_stage = STATUS_SYNC_MAP[data.status]
        # Find active application for this entity
        from ..models.database import VacancyStatus
        app_result = await db.execute(
            select(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(
                VacancyApplication.entity_id == entity_id,
                Vacancy.status != VacancyStatus.closed
            )
        )
        application = app_result.scalar()
        if application and application.stage != new_stage:
            application.stage = new_stage
            application.last_stage_change_at = datetime.utcnow()
            logger.info(f"PUT /entities/{entity_id}: Synchronized status {data.status} → application {application.id} stage {new_stage}")

    await db.commit()
    await db.refresh(entity)

    # Get department name
    department_name = None
    if entity.department_id:
        dept_result = await db.execute(select(Department.name).where(Department.id == entity.department_id))
        department_name = dept_result.scalar()

    response_data = {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status,
        "phone": entity.phone,
        "email": entity.email,
        "telegram_user_id": entity.telegram_user_id,
        "telegram_usernames": entity.telegram_usernames or [],
        "emails": entity.emails or [],
        "phones": entity.phones or [],
        "company": entity.company,
        "position": entity.position,
        "tags": entity.tags or [],
        "extra_data": entity.extra_data or {},
        "created_by": entity.created_by,
        "department_id": entity.department_id,
        "department_name": department_name,
        "created_at": entity.created_at.isoformat() if entity.created_at else None,
        "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
        "expected_salary_min": entity.expected_salary_min,
        "expected_salary_max": entity.expected_salary_max,
        "expected_salary_currency": entity.expected_salary_currency or 'RUB',
        "version": entity.version
    }

    # Invalidate scoring cache if relevant fields changed
    # (skills, experience, salary, etc.)
    scoring_relevant_fields = {
        'tags', 'extra_data', 'expected_salary_min', 'expected_salary_max',
        'expected_salary_currency', 'position', 'ai_summary'
    }
    if any(field in update_data for field in scoring_relevant_fields):
        await scoring_cache.invalidate_entity_scores(entity.id)
        logger.info(f"Invalidated scoring cache for entity {entity.id} due to scoring-relevant field change")

    # Broadcast entity.updated event
    await broadcast_entity_updated(org.id, response_data)

    return response_data


class StatusUpdate(BaseModel):
    """Quick status update for Kanban drag & drop"""
    status: EntityStatus


@router.patch("/{entity_id}/status")
async def update_entity_status(
    entity_id: int,
    data: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Quick status update for drag & drop in Kanban board.

    This is a simplified endpoint for updating only the status field,
    optimized for Kanban drag & drop operations.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.org_id == org.id)
        .with_for_update()
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    if entity.is_transferred:
        raise HTTPException(400, "Cannot edit a transferred entity")

    # Update status
    old_status = entity.status
    entity.status = data.status

    # Synchronize Entity.status → VacancyApplication.stage
    # Since one candidate = max one active vacancy, we sync the stage
    if data.status in STATUS_SYNC_MAP:
        new_stage = STATUS_SYNC_MAP[data.status]
        # Find active application for this entity
        from ..models.database import VacancyApplication, Vacancy, VacancyStatus
        app_result = await db.execute(
            select(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(
                VacancyApplication.entity_id == entity_id,
                Vacancy.status != VacancyStatus.closed
            )
        )
        application = app_result.scalar()
        if application and application.stage != new_stage:
            application.stage = new_stage
            application.last_stage_change_at = datetime.utcnow()
            logger.info(f"Synchronized entity {entity_id} status {data.status} to application {application.id} stage {new_stage}")

    await db.commit()
    await db.refresh(entity)

    logger.info(f"Entity {entity_id} status changed: {old_status} -> {data.status}")

    # Broadcast update
    await broadcast_entity_updated(org.id, {
        "id": entity.id,
        "type": entity.type,
        "name": entity.name,
        "status": entity.status
    })

    return {
        "id": entity.id,
        "status": entity.status,
        "previous_status": old_status
    }


@router.delete("/{entity_id}")
async def delete_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Use SELECT FOR UPDATE to prevent race conditions
    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.org_id == org.id)
        .with_for_update()
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Don't allow deleting of transferred entities (frozen copies)
    if entity.is_transferred:
        raise HTTPException(400, "Cannot delete a transferred entity. This is a read-only copy.")

    # Check delete permissions
    can_delete = False
    if current_user.role == UserRole.superadmin:
        can_delete = True
    else:
        # Full access (owner or member with has_full_access) can delete all
        user_has_full_access = await has_full_database_access(current_user, org.id, db)
        if user_has_full_access:
            can_delete = True
        elif entity.created_by == current_user.id:
            can_delete = True  # Owner of record
        else:
            # Check if shared with full access
            shared_result = await db.execute(
                select(SharedAccess).where(
                    SharedAccess.resource_type == ResourceType.entity,
                    SharedAccess.resource_id == entity_id,
                    SharedAccess.shared_with_id == current_user.id,
                    SharedAccess.access_level == AccessLevel.full,
                    or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
                )
            )
            if shared_result.scalar_one_or_none():
                can_delete = True

    if not can_delete:
        raise HTTPException(403, "No delete permission for this entity")

    # Store entity_id and org_id before deletion
    deleted_entity_id = entity.id
    deleted_org_id = entity.org_id

    await db.delete(entity)
    await db.commit()

    # Broadcast entity.deleted event
    await broadcast_entity_deleted(deleted_org_id, deleted_entity_id)

    return {"success": True}


@router.post("/{entity_id}/transfer")
async def transfer_entity(
    entity_id: int,
    data: TransferCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Transfer contact to another user/department with copy mechanism.
    Creates a frozen copy for the old owner and transfers the original to the new owner.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Use SELECT FOR UPDATE to prevent race conditions during transfer
    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.org_id == org.id)
        .with_for_update()
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Don't allow transfer of already transferred entities (frozen copies)
    if entity.is_transferred:
        raise HTTPException(400, "Cannot transfer a frozen copy. Transfer the original entity instead.")

    # Check transfer permissions - requires full access or ownership
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.full)
    if not has_access:
        raise HTTPException(403, "No transfer permission for this entity")

    # Validate target user exists and is in the same org
    to_user_result = await db.execute(
        select(User).where(User.id == data.to_user_id)
    )
    to_user = to_user_result.scalar_one_or_none()
    if not to_user:
        raise HTTPException(404, "Target user not found")

    # Check if target user has access to this org
    from_user_role = await get_user_org_role(current_user, org.id, db)
    to_user_role = await get_user_org_role(to_user, org.id, db)
    if to_user_role is None and to_user.role != UserRole.superadmin:
        raise HTTPException(400, "Target user is not a member of this organization")

    # Check transfer permissions based on roles and departments
    # Get current user's department memberships
    from_dept_memberships = await db.execute(
        select(DepartmentMember).where(DepartmentMember.user_id == current_user.id)
    )
    from_dept_memberships = list(from_dept_memberships.scalars().all())
    from_dept_ids = [dm.department_id for dm in from_dept_memberships]

    # Get target user's department memberships
    to_dept_memberships = await db.execute(
        select(DepartmentMember).where(DepartmentMember.user_id == data.to_user_id)
    )
    to_dept_memberships = list(to_dept_memberships.scalars().all())
    to_dept_ids = [dm.department_id for dm in to_dept_memberships]

    # Check transfer permissions based on roles
    can_transfer = False
    if current_user.role == UserRole.superadmin or from_user_role == "owner":
        # SUPERADMIN and OWNER can transfer to anyone
        can_transfer = True
    else:
        # Check department-based permissions
        # Use enum comparison since dm.role comes from DB as DeptRole enum
        has_sub_admin = any(dm.role == DeptRole.sub_admin for dm in from_dept_memberships)

        if has_sub_admin or from_user_role == "admin":
            # SUB_ADMIN and ADMIN can transfer to:
            # 1. Anyone in their own department
            # 2. Admins/sub_admins of other departments
            if any(dept_id in from_dept_ids for dept_id in to_dept_ids):
                # Same department
                can_transfer = True
            else:
                # Check if target is admin/sub_admin of any department
                is_target_admin = any(dm.role in (DeptRole.sub_admin, DeptRole.lead) for dm in to_dept_memberships)
                if is_target_admin or to_user_role == "admin":
                    can_transfer = True
        else:
            # MEMBER can only transfer within their own department
            if any(dept_id in from_dept_ids for dept_id in to_dept_ids):
                can_transfer = True

    if not can_transfer:
        raise HTTPException(403, "You don't have permission to transfer to this user based on your role and department")

    # Get current user's department (first one if multiple)
    from_dept_id = from_dept_ids[0] if from_dept_ids else None

    # Validate to_department_id if provided
    if data.to_department_id:
        dept_result = await db.execute(
            select(Department).where(Department.id == data.to_department_id, Department.org_id == org.id)
        )
        if not dept_result.scalar_one_or_none():
            raise HTTPException(400, "Invalid target department")

    # === STEP 1: Create a frozen copy for the old owner ===
    old_owner_id = entity.created_by
    new_owner_name = to_user.name if to_user else "Unknown"

    # Create copy with all data except relationships
    entity_copy = Entity(
        org_id=entity.org_id,
        department_id=entity.department_id,
        type=entity.type,
        name=f"{entity.name} [Передан → {new_owner_name}]",
        status=entity.status,
        phone=entity.phone,
        email=entity.email,
        telegram_user_id=entity.telegram_user_id,
        company=entity.company,
        position=entity.position,
        tags=entity.tags.copy() if entity.tags else [],
        extra_data=entity.extra_data.copy() if entity.extra_data else {},
        created_by=old_owner_id,  # Keep old owner
        created_at=entity.created_at,
        updated_at=datetime.utcnow(),
        # Mark as transferred
        is_transferred=True,
        transferred_to_id=data.to_user_id,
        transferred_at=datetime.utcnow()
    )
    db.add(entity_copy)
    await db.flush()  # Get the ID of the copy

    # === STEP 2: Copy all chats to the frozen copy ===
    chats_result = await db.execute(
        select(Chat).where(Chat.entity_id == entity_id)
    )
    chats = list(chats_result.scalars().all())

    # === STEP 3: Copy all calls to the frozen copy ===
    calls_result = await db.execute(
        select(CallRecording).where(CallRecording.entity_id == entity_id)
    )
    calls = list(calls_result.scalars().all())

    # Link chats and calls to the copy (read-only reference)
    # Note: We don't duplicate chats/calls, we just create references
    # The copy will reference the same chats/calls for historical context

    # === STEP 4: Update original entity - transfer to new owner ===
    entity.created_by = data.to_user_id
    if data.to_department_id:
        entity.department_id = data.to_department_id
    entity.updated_at = datetime.utcnow()

    # === STEP 5: Transfer all chats and calls to new owner ===
    for chat in chats:
        chat.owner_id = data.to_user_id

    for call in calls:
        call.owner_id = data.to_user_id

    # === STEP 6: Create transfer record ===
    from datetime import timedelta
    transfer = EntityTransfer(
        entity_id=entity_id,
        from_user_id=current_user.id,
        to_user_id=data.to_user_id,
        from_department_id=from_dept_id,
        to_department_id=data.to_department_id,
        comment=data.comment,
        copy_entity_id=entity_copy.id,
        cancel_deadline=datetime.utcnow() + timedelta(hours=1)
    )
    db.add(transfer)

    await db.commit()

    return {
        "success": True,
        "transfer_id": transfer.id,
        "original_entity_id": entity.id,
        "copy_entity_id": entity_copy.id,
        "transferred_chats": len(chats),
        "transferred_calls": len(calls),
        "cancel_deadline": transfer.cancel_deadline.isoformat() if transfer.cancel_deadline else None
    }


@router.post("/transfers/{transfer_id}/cancel")
async def cancel_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Cancel a transfer within the allowed time window (1 hour).
    Reverts the entity, chats and calls back to original owner.
    """
    current_user = await db.merge(current_user)

    # Get transfer record with row lock to prevent concurrent cancellations
    result = await db.execute(
        select(EntityTransfer)
        .where(EntityTransfer.id == transfer_id)
        .with_for_update()
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(404, "Transfer not found")

    # Check if user is the one who made the transfer or superadmin
    if transfer.from_user_id != current_user.id and current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Only the person who transferred can cancel")

    # Check if already cancelled
    if transfer.cancelled_at:
        raise HTTPException(400, "Transfer already cancelled")

    # Check if within cancellation window
    if transfer.cancel_deadline and datetime.utcnow() > transfer.cancel_deadline:
        raise HTTPException(400, "Cancellation window expired (1 hour)")

    # Get the original entity with row lock to prevent race conditions
    entity_result = await db.execute(
        select(Entity)
        .where(Entity.id == transfer.entity_id)
        .with_for_update()
    )
    entity = entity_result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # === STEP 1: Revert entity ownership ===
    entity.created_by = transfer.from_user_id
    if transfer.from_department_id:
        entity.department_id = transfer.from_department_id
    entity.updated_at = datetime.utcnow()

    # === STEP 2: Revert all chats ownership ===
    chats_result = await db.execute(
        select(Chat).where(Chat.entity_id == transfer.entity_id)
    )
    chats = list(chats_result.scalars().all())
    for chat in chats:
        chat.owner_id = transfer.from_user_id

    # === STEP 3: Revert all calls ownership ===
    calls_result = await db.execute(
        select(CallRecording).where(CallRecording.entity_id == transfer.entity_id)
    )
    calls = list(calls_result.scalars().all())
    for call in calls:
        call.owner_id = transfer.from_user_id

    # === STEP 4: Delete the frozen copy ===
    if transfer.copy_entity_id:
        copy_result = await db.execute(
            select(Entity).where(Entity.id == transfer.copy_entity_id)
        )
        copy_entity = copy_result.scalar_one_or_none()
        if copy_entity:
            await db.delete(copy_entity)

    # === STEP 5: Mark transfer as cancelled ===
    transfer.cancelled_at = datetime.utcnow()

    await db.commit()

    return {
        "success": True,
        "entity_id": entity.id,
        "reverted_chats": len(chats),
        "reverted_calls": len(calls)
    }


@router.get("/transfers/pending")
async def get_pending_transfers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get transfers that can still be cancelled (made by current user within 1 hour)."""
    current_user = await db.merge(current_user)

    result = await db.execute(
        select(EntityTransfer)
        .options(
            selectinload(EntityTransfer.entity),
            selectinload(EntityTransfer.to_user)
        )
        .where(
            EntityTransfer.from_user_id == current_user.id,
            EntityTransfer.cancelled_at.is_(None),
            EntityTransfer.cancel_deadline > datetime.utcnow()
        )
        .order_by(EntityTransfer.created_at.desc())
    )
    transfers = result.scalars().all()

    return [
        {
            "id": t.id,
            "entity_id": t.entity_id,
            "entity_name": t.entity.name if t.entity else None,
            "to_user_id": t.to_user_id,
            "to_user_name": t.to_user.name if t.to_user else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "cancel_deadline": t.cancel_deadline.isoformat() if t.cancel_deadline else None,
            "time_remaining_seconds": (t.cancel_deadline - datetime.utcnow()).total_seconds() if t.cancel_deadline else 0
        }
        for t in transfers
    ]


@router.post("/{entity_id}/link-chat/{chat_id}")
async def link_chat_to_entity(
    entity_id: int,
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Link a chat to a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Verify entity exists and belongs to same org
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check edit permissions - requires edit or full access
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        raise HTTPException(403, "No edit permission for this entity")

    # Get and update chat (must belong to same org)
    chat_result = await db.execute(
        select(Chat).where(Chat.id == chat_id, Chat.org_id == org.id)
    )
    chat = chat_result.scalar_one_or_none()

    if not chat:
        raise HTTPException(404, "Chat not found")

    chat.entity_id = entity_id
    await db.commit()
    return {"success": True}


@router.delete("/{entity_id}/unlink-chat/{chat_id}")
async def unlink_chat_from_entity(
    entity_id: int,
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Unlink a chat from a contact"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Verify entity exists and user has edit access
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check edit permissions - requires edit or full access
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        raise HTTPException(403, "No edit permission for this entity")

    chat_result = await db.execute(
        select(Chat).where(
            Chat.id == chat_id,
            Chat.entity_id == entity_id,
            Chat.org_id == org.id
        )
    )
    chat = chat_result.scalar_one_or_none()

    if not chat:
        raise HTTPException(404, "Chat not found or not linked to this entity")

    chat.entity_id = None
    await db.commit()
    return {"success": True}


@router.get("/stats/by-type")
async def get_entities_stats_by_type(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get entity counts by type (filtered by org)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return {}

    result = await db.execute(
        select(Entity.type, func.count(Entity.id))
        .where(Entity.org_id == org.id)
        .group_by(Entity.type)
    )
    stats = {row[0].value: row[1] for row in result.all()}
    return stats


@router.get("/stats/by-status")
async def get_entities_stats_by_status(
    type: Optional[EntityType] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get entity counts by status (filtered by org)"""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return {}

    query = select(Entity.status, func.count(Entity.id)).where(Entity.org_id == org.id)
    if type:
        query = query.where(Entity.type == type)
    query = query.group_by(Entity.status)

    result = await db.execute(query)
    stats = {row[0].value: row[1] for row in result.all()}
    return stats


@router.post("/{entity_id}/share")
async def share_entity(
    entity_id: int,
    data: ShareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Share an entity (contact) with another user.

    If auto_share_related=True, automatically shares all related chats and calls
    with the same access level.

    Permissions:
    - MEMBER → only within their department
    - ADMIN → their department + admins of other departments + OWNER/SUPERADMIN
    - OWNER → anyone in organization
    - SUPERADMIN → anyone
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

    # Check if user has permission to share this entity (requires full access or ownership)
    can_share = False
    if current_user.role == UserRole.superadmin:
        can_share = True
    else:
        # Full access (owner or member with has_full_access) can share all
        user_has_full_access = await has_full_database_access(current_user, org.id, db)
        if user_has_full_access:
            can_share = True
        elif entity.created_by == current_user.id:
            can_share = True  # Owner of entity
        else:
            # Check if shared with full access
            shared_result = await db.execute(
                select(SharedAccess).where(
                    SharedAccess.resource_type == ResourceType.entity,
                    SharedAccess.resource_id == entity_id,
                    SharedAccess.shared_with_id == current_user.id,
                    SharedAccess.access_level == AccessLevel.full,
                    or_(SharedAccess.expires_at.is_(None), SharedAccess.expires_at > datetime.utcnow())
                )
            )
            if shared_result.scalar_one_or_none():
                can_share = True

    if not can_share:
        raise HTTPException(403, "No permission to share this entity")

    # Get target user
    to_user_result = await db.execute(
        select(User).where(User.id == data.shared_with_id)
    )
    to_user = to_user_result.scalar_one_or_none()

    if not to_user:
        raise HTTPException(404, "Target user not found")

    # Check if current_user can share with to_user
    if not await can_share_to(current_user, to_user, org.id, db):
        raise HTTPException(403, "You cannot share with this user based on your role and department")

    # Check if already shared
    existing_result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == ResourceType.entity,
            SharedAccess.resource_id == entity_id,
            SharedAccess.shared_with_id == data.shared_with_id
        )
    )
    existing_share = existing_result.scalar_one_or_none()

    if existing_share:
        # Update existing share
        existing_share.access_level = data.access_level
        existing_share.note = data.note
        existing_share.expires_at = data.expires_at
        existing_share.shared_by_id = current_user.id
    else:
        # Create new share
        share = SharedAccess(
            resource_type=ResourceType.entity,
            resource_id=entity_id,
            entity_id=entity_id,  # FK for cascade delete
            shared_by_id=current_user.id,
            shared_with_id=data.shared_with_id,
            access_level=data.access_level,
            note=data.note,
            expires_at=data.expires_at
        )
        db.add(share)

    await db.commit()

    # Auto-share related chats and calls if requested
    shared_chats = 0
    shared_calls = 0

    if data.auto_share_related:
        # Find all chats and calls linked to this entity
        chats_result = await db.execute(
            select(Chat).where(Chat.entity_id == entity_id, Chat.org_id == org.id)
        )
        chats = chats_result.scalars().all()
        chat_ids = [c.id for c in chats]

        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.entity_id == entity_id, CallRecording.org_id == org.id)
        )
        calls = calls_result.scalars().all()
        call_ids = [c.id for c in calls]

        # Batch fetch all existing shares for this user (avoid N+1 queries)
        existing_shares_result = await db.execute(
            select(SharedAccess).where(
                SharedAccess.shared_with_id == data.shared_with_id,
                ((SharedAccess.resource_type == ResourceType.chat) & (SharedAccess.resource_id.in_(chat_ids))) |
                ((SharedAccess.resource_type == ResourceType.call) & (SharedAccess.resource_id.in_(call_ids)))
            )
        ) if chat_ids or call_ids else None

        # Build lookup dict: (resource_type, resource_id) -> SharedAccess
        existing_shares_map = {}
        if existing_shares_result:
            for share in existing_shares_result.scalars().all():
                existing_shares_map[(share.resource_type, share.resource_id)] = share

        # Process chats
        for chat in chats:
            key = (ResourceType.chat, chat.id)
            if key in existing_shares_map:
                # Update existing
                existing_share = existing_shares_map[key]
                existing_share.access_level = data.access_level
                existing_share.expires_at = data.expires_at
                existing_share.shared_by_id = current_user.id
            else:
                # Create new share for chat
                chat_share = SharedAccess(
                    resource_type=ResourceType.chat,
                    resource_id=chat.id,
                    chat_id=chat.id,  # FK for cascade delete
                    shared_by_id=current_user.id,
                    shared_with_id=data.shared_with_id,
                    access_level=data.access_level,
                    expires_at=data.expires_at
                )
                db.add(chat_share)
                shared_chats += 1

        # Process calls
        for call in calls:
            key = (ResourceType.call, call.id)
            if key in existing_shares_map:
                # Update existing
                existing_share = existing_shares_map[key]
                existing_share.access_level = data.access_level
                existing_share.expires_at = data.expires_at
                existing_share.shared_by_id = current_user.id
            else:
                # Create new share for call
                call_share = SharedAccess(
                    resource_type=ResourceType.call,
                    resource_id=call.id,
                    call_id=call.id,  # FK for cascade delete
                    shared_by_id=current_user.id,
                    shared_with_id=data.shared_with_id,
                    access_level=data.access_level,
                    expires_at=data.expires_at
                )
                db.add(call_share)
                shared_calls += 1

        await db.commit()

    return {
        "success": True,
        "entity_id": entity_id,
        "shared_with_id": data.shared_with_id,
        "access_level": data.access_level.value,
        "auto_shared": {
            "chats": shared_chats,
            "calls": shared_calls
        } if data.auto_share_related else None
    }


@router.get("/{entity_id}/chat-participants")
async def get_entity_chat_participants(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all participants from chats linked to this Entity.
    Returns a list of participants with their roles and identifiers.
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

    # Get all chats linked to this entity
    from ..models.database import Message

    chats_result = await db.execute(
        select(Chat).where(Chat.entity_id == entity_id)
    )
    chats = chats_result.scalars().all()

    if not chats:
        return []

    # Collect all participants from all chats
    participants_map = {}  # Key: telegram_user_id, Value: participant info

    for chat in chats:
        # Get messages from this chat to identify participants
        messages_result = await db.execute(
            select(Message.telegram_user_id, Message.username, Message.first_name, Message.last_name)
            .where(Message.chat_id == chat.id)
            .distinct(Message.telegram_user_id)
        )
        messages = messages_result.all()

        for msg in messages:
            telegram_user_id, username, first_name, last_name = msg

            if telegram_user_id and telegram_user_id not in participants_map:
                # Build participant name
                name_parts = []
                if first_name:
                    name_parts.append(first_name)
                if last_name:
                    name_parts.append(last_name)
                name = " ".join(name_parts) if name_parts else f"User {telegram_user_id}"

                participants_map[telegram_user_id] = {
                    "telegram_user_id": telegram_user_id,
                    "telegram_username": username,
                    "name": name,
                    "first_name": first_name,
                    "last_name": last_name,
                    "chat_ids": []
                }

            # Add chat to participant's chat list
            if telegram_user_id and chat.id not in participants_map[telegram_user_id]["chat_ids"]:
                participants_map[telegram_user_id]["chat_ids"].append(chat.id)

    # Convert to list and sort by name
    participants = list(participants_map.values())
    participants.sort(key=lambda p: p["name"])

    return participants


# === Entity-Vacancy Integration API ===

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
    Returns a list of VacancyApplication with vacancy details.
    """
    from ..models.database import VacancyApplication, Vacancy, VacancyStatus

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
    Creates a VacancyApplication linking entity to vacancy.
    """
    from ..models.database import VacancyApplication, Vacancy, ApplicationStage

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

    # Check if entity is already in ANY active vacancy (one candidate = max one vacancy)
    from ..models.database import VacancyStatus
    existing_any_vacancy = await db.execute(
        select(VacancyApplication)
        .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
        .where(
            VacancyApplication.entity_id == entity_id,
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

    # Get max stage_order for the 'applied' stage (HR pipeline - shown as "Новый" in UI)
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
        stage=ApplicationStage.applied,  # Use 'applied' (exists in DB enum, shown as "Новый" in UI)
        stage_order=max_order + 1,
        source=data.source,
        notes=data.notes,
        created_by=current_user.id
    )

    db.add(application)

    # Synchronize Entity.status to match VacancyApplication.stage
    from ..models.database import STAGE_SYNC_MAP
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


# === Entity Files API ===

from pathlib import Path
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse
import os
import uuid
import mimetypes

# Uploads directory for entity files
ENTITY_FILES_DIR = Path(__file__).parent.parent.parent / "uploads" / "entity_files"
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
MAX_FILES_PER_ENTITY = 20  # Maximum files per entity
MIN_DISK_SPACE_MB = 100  # Minimum required free disk space in MB

# File operations logger
file_logger = logging.getLogger("hr-analyzer.entity-files")

# Allowed file extensions whitelist (security: prevent executable uploads)
ALLOWED_EXTENSIONS = {
    # Documents
    '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt',
    # Spreadsheets
    '.xls', '.xlsx', '.ods', '.csv',
    # Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
    # Archives
    '.zip', '.rar', '.7z', '.tar', '.gz',
    # Presentations
    '.ppt', '.pptx', '.odp',
}

# MIME type whitelist for content validation
ALLOWED_MIME_TYPES = {
    # Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/rtf',
    'text/plain',
    # Spreadsheets
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    # Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/svg+xml',
    # Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
    # Presentations
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation',
    # Generic (fallback for unknown but allowed extensions)
    'application/octet-stream',
}

# Dangerous patterns in filenames
DANGEROUS_PATTERNS = [
    '.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar',
    '.msi', '.dll', '.scr', '.com', '.pif', '.application', '.gadget',
    '.hta', '.cpl', '.msc', '.wsf', '.wsh', '.reg', '.inf', '.lnk',
]


def validate_file_upload(filename: str, content_type: str) -> tuple[bool, str]:
    """
    Validate uploaded file for security.
    Returns (is_valid, error_message).
    """
    if not filename:
        return False, "Filename is required"

    # Normalize filename to lowercase for checks
    filename_lower = filename.lower()

    # Check for null bytes (path traversal attack)
    if '\x00' in filename:
        return False, "Invalid filename"

    # Check for path traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
        return False, "Invalid filename"

    # Check for dangerous double extensions (e.g., resume.pdf.exe)
    for pattern in DANGEROUS_PATTERNS:
        if pattern in filename_lower:
            return False, f"File type not allowed: {pattern}"

    # Get and validate extension
    extension = Path(filename_lower).suffix
    if not extension:
        return False, "File must have an extension"

    if extension not in ALLOWED_EXTENSIONS:
        return False, f"File type '{extension}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"

    # Validate MIME type if provided
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        # Log suspicious MIME type but allow if extension is valid
        # (MIME types can be spoofed, but extensions we control)
        logger.warning(f"Suspicious MIME type {content_type} for file {filename}")

    return True, ""


def check_disk_space(path: Path, required_mb: int = MIN_DISK_SPACE_MB) -> tuple[bool, int]:
    """
    Check if there is enough free disk space.
    Returns (has_enough_space, free_space_mb).
    """
    try:
        import shutil
        # Get disk usage stats for the path (or its parent if it doesn't exist)
        check_path = path if path.exists() else path.parent
        while not check_path.exists() and check_path != check_path.parent:
            check_path = check_path.parent

        if not check_path.exists():
            check_path = Path("/")

        total, used, free = shutil.disk_usage(check_path)
        free_mb = free // (1024 * 1024)
        return free_mb >= required_mb, free_mb
    except Exception as e:
        file_logger.warning(f"Failed to check disk space: {e}")
        # If we can't check, assume there's enough space
        return True, -1


async def get_entity_file_count(db: AsyncSession, entity_id: int) -> int:
    """Get the number of files attached to an entity."""
    from ..models.database import EntityFile
    result = await db.execute(
        select(func.count(EntityFile.id)).where(EntityFile.entity_id == entity_id)
    )
    return result.scalar() or 0


async def cleanup_orphaned_files_for_entity(
    db: AsyncSession,
    entity_id: int,
    org_id: int
) -> tuple[int, list[str]]:
    """
    Find and remove orphaned files for an entity.
    Orphaned files are files on disk that have no corresponding DB record.
    Returns (count of removed files, list of removed file paths).
    """
    from ..models.database import EntityFile

    entity_dir = ENTITY_FILES_DIR / str(entity_id)
    if not entity_dir.exists():
        return 0, []

    # Get all files on disk for this entity
    disk_files = set()
    for file_path in entity_dir.iterdir():
        if file_path.is_file():
            disk_files.add(str(file_path))

    if not disk_files:
        return 0, []

    # Get all file paths from database
    result = await db.execute(
        select(EntityFile.file_path).where(
            EntityFile.entity_id == entity_id,
            EntityFile.org_id == org_id
        )
    )
    db_file_paths = set(row[0] for row in result.fetchall())

    # Find orphaned files (on disk but not in DB)
    orphaned_files = disk_files - db_file_paths
    removed_files = []

    for orphan_path in orphaned_files:
        try:
            Path(orphan_path).unlink()
            removed_files.append(orphan_path)
            file_logger.info(f"Removed orphaned file: {orphan_path}")
        except OSError as e:
            file_logger.warning(f"Failed to remove orphaned file {orphan_path}: {e}")

    return len(removed_files), removed_files


async def cleanup_all_orphaned_files(db: AsyncSession, org_id: int) -> dict:
    """
    Clean up orphaned files across all entities in an organization.
    Returns statistics about the cleanup.
    """
    from ..models.database import EntityFile

    if not ENTITY_FILES_DIR.exists():
        return {"total_removed": 0, "entities_processed": 0, "errors": []}

    total_removed = 0
    entities_processed = 0
    errors = []

    # Get all entity directories
    for entity_dir in ENTITY_FILES_DIR.iterdir():
        if not entity_dir.is_dir():
            continue

        try:
            entity_id = int(entity_dir.name)
        except ValueError:
            continue

        # Check if entity belongs to this org
        from ..models.database import Entity
        entity_result = await db.execute(
            select(Entity.id).where(Entity.id == entity_id, Entity.org_id == org_id)
        )
        if not entity_result.scalar():
            continue

        try:
            count, _ = await cleanup_orphaned_files_for_entity(db, entity_id, org_id)
            total_removed += count
            entities_processed += 1
        except Exception as e:
            errors.append(f"Entity {entity_id}: {str(e)}")
            file_logger.error(f"Error cleaning up entity {entity_id}: {e}")

    return {
        "total_removed": total_removed,
        "entities_processed": entities_processed,
        "errors": errors
    }


class EntityFileResponse(BaseModel):
    """Response schema for entity file."""
    id: int
    entity_id: int
    file_type: str
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    description: Optional[str] = None
    uploaded_by: Optional[int] = None
    uploader_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/{entity_id}/files")
async def get_entity_files(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all files attached to an entity.
    Returns a list of EntityFile with metadata.
    """
    from ..models.database import EntityFile, EntityFileType

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

    # Get all files for this entity
    files_result = await db.execute(
        select(EntityFile)
        .where(EntityFile.entity_id == entity_id)
        .order_by(EntityFile.created_at.desc())
    )
    files = files_result.scalars().all()

    if not files:
        return []

    # Get uploader names
    uploader_ids = [f.uploaded_by for f in files if f.uploaded_by]
    uploader_names = {}
    if uploader_ids:
        uploaders_result = await db.execute(
            select(User).where(User.id.in_(uploader_ids))
        )
        uploader_names = {u.id: u.name for u in uploaders_result.scalars().all()}

    # Build response
    response = []
    for f in files:
        response.append(EntityFileResponse(
            id=f.id,
            entity_id=f.entity_id,
            file_type=f.file_type.value if f.file_type else "other",
            file_name=f.file_name,
            file_size=f.file_size,
            mime_type=f.mime_type,
            description=f.description,
            uploaded_by=f.uploaded_by,
            uploader_name=uploader_names.get(f.uploaded_by) if f.uploaded_by else None,
            created_at=f.created_at
        ))

    return response


@router.post("/{entity_id}/files")
async def upload_entity_file(
    entity_id: int,
    file: UploadFile = File(...),
    file_type: str = Form("other"),
    description: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload a file for an entity.
    Saves file to uploads/entities/{entity_id}/ and creates EntityFile record.
    """
    from ..models.database import EntityFile, EntityFileType

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
        file_logger.warning(
            f"Upload denied: user {current_user.id} lacks edit permission for entity {entity_id}"
        )
        raise HTTPException(403, "No edit permission for this entity")

    # Check file count limit per entity
    current_file_count = await get_entity_file_count(db, entity_id)
    if current_file_count >= MAX_FILES_PER_ENTITY:
        file_logger.warning(
            f"Upload denied: entity {entity_id} has reached file limit ({MAX_FILES_PER_ENTITY}), "
            f"user {current_user.id}"
        )
        raise HTTPException(
            400,
            f"Maximum number of files ({MAX_FILES_PER_ENTITY}) per entity reached. "
            "Please delete some files before uploading new ones."
        )

    # Parse file_type enum
    try:
        file_type_enum = EntityFileType(file_type)
    except ValueError:
        file_type_enum = EntityFileType.other

    # Get original filename and validate
    original_name = file.filename or "unnamed_file"
    content_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    # SECURITY: Validate file type before reading content
    is_valid, error_msg = validate_file_upload(original_name, content_type)
    if not is_valid:
        file_logger.warning(
            f"Upload denied: invalid file '{original_name}' for entity {entity_id}, "
            f"user {current_user.id}, reason: {error_msg}"
        )
        raise HTTPException(400, error_msg)

    # Create directory if not exists
    entity_files_dir = ENTITY_FILES_DIR / str(entity_id)
    entity_files_dir.mkdir(parents=True, exist_ok=True)

    # Check disk space before uploading
    has_space, free_mb = check_disk_space(entity_files_dir)
    if not has_space:
        file_logger.error(
            f"Upload denied: insufficient disk space ({free_mb}MB free, "
            f"need {MIN_DISK_SPACE_MB}MB), entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(
            507,
            f"Insufficient disk space. Only {free_mb}MB available, "
            f"minimum {MIN_DISK_SPACE_MB}MB required."
        )

    # Generate unique filename to avoid collisions
    file_extension = Path(original_name.lower()).suffix
    unique_name = f"{uuid.uuid4().hex}{file_extension}"
    file_path = entity_files_dir / unique_name

    # Read and save file
    content = await file.read()
    file_size = len(content)

    # Validate file size
    if file_size > MAX_FILE_SIZE:
        file_logger.warning(
            f"Upload denied: file too large ({file_size} bytes > {MAX_FILE_SIZE} bytes), "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB")

    # Check if file size fits in available space (with buffer)
    file_size_mb = file_size / (1024 * 1024)
    if free_mb > 0 and file_size_mb > (free_mb - MIN_DISK_SPACE_MB):
        file_logger.error(
            f"Upload denied: file ({file_size_mb:.2f}MB) would exceed safe disk space limit, "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(
            507,
            f"File size ({file_size_mb:.2f}MB) exceeds available disk space."
        )

    # SECURITY: Additional content-based validation for PDFs and images
    # Check magic bytes to ensure file content matches extension
    if file_extension == '.pdf' and not content.startswith(b'%PDF'):
        file_logger.warning(
            f"Upload denied: invalid PDF magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid PDF file: content does not match PDF format")
    elif file_extension in {'.jpg', '.jpeg'} and not content.startswith(b'\xff\xd8\xff'):
        file_logger.warning(
            f"Upload denied: invalid JPEG magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid JPEG file: content does not match JPEG format")
    elif file_extension == '.png' and not content.startswith(b'\x89PNG'):
        file_logger.warning(
            f"Upload denied: invalid PNG magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid PNG file: content does not match PNG format")
    elif file_extension == '.zip' and not content.startswith(b'PK'):
        file_logger.warning(
            f"Upload denied: invalid ZIP magic bytes for '{original_name}', "
            f"entity {entity_id}, user {current_user.id}"
        )
        raise HTTPException(400, "Invalid ZIP file: content does not match ZIP format")

    file_path.write_bytes(content)

    # Use validated MIME type
    mime_type = content_type

    # Create database record
    entity_file = EntityFile(
        entity_id=entity_id,
        org_id=org.id,
        file_type=file_type_enum,
        file_name=original_name,
        file_path=str(file_path),
        file_size=file_size,
        mime_type=mime_type,
        description=description,
        uploaded_by=current_user.id
    )

    db.add(entity_file)
    await db.commit()
    await db.refresh(entity_file)

    file_logger.info(
        f"FILE_UPLOAD: success | entity_id={entity_id} | file_id={entity_file.id} | "
        f"file_name='{original_name}' | file_type={file_type_enum.value} | "
        f"size={file_size} bytes | mime_type={mime_type} | "
        f"user_id={current_user.id} | user_name='{current_user.name}' | "
        f"org_id={org.id} | path={file_path}"
    )

    return EntityFileResponse(
        id=entity_file.id,
        entity_id=entity_file.entity_id,
        file_type=entity_file.file_type.value if entity_file.file_type else "other",
        file_name=entity_file.file_name,
        file_size=entity_file.file_size,
        mime_type=entity_file.mime_type,
        description=entity_file.description,
        uploaded_by=entity_file.uploaded_by,
        uploader_name=current_user.name,
        created_at=entity_file.created_at
    )


@router.delete("/{entity_id}/files/{file_id}")
async def delete_entity_file(
    entity_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a file from an entity.
    Removes file from disk and deletes EntityFile record.
    """
    from ..models.database import EntityFile

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
        file_logger.warning(
            f"FILE_DELETE: denied | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id} | reason=no_edit_permission"
        )
        raise HTTPException(403, "No edit permission for this entity")

    # Get file record
    file_result = await db.execute(
        select(EntityFile).where(
            EntityFile.id == file_id,
            EntityFile.entity_id == entity_id
        )
    )
    entity_file = file_result.scalar_one_or_none()

    if not entity_file:
        file_logger.warning(
            f"FILE_DELETE: not_found | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id}"
        )
        raise HTTPException(404, "File not found")

    # Store file info for logging before deletion
    deleted_file_name = entity_file.file_name
    deleted_file_path = entity_file.file_path
    deleted_file_size = entity_file.file_size

    # Delete file from disk
    file_path = Path(entity_file.file_path)
    disk_deleted = False
    if file_path.exists():
        try:
            file_path.unlink()
            disk_deleted = True
            file_logger.debug(f"Deleted file from disk: {file_path}")
        except OSError as e:
            file_logger.warning(f"Failed to delete file from disk {file_path}: {e}")

    # Delete database record
    await db.delete(entity_file)
    await db.commit()

    file_logger.info(
        f"FILE_DELETE: success | entity_id={entity_id} | file_id={file_id} | "
        f"file_name='{deleted_file_name}' | size={deleted_file_size} bytes | "
        f"disk_deleted={disk_deleted} | user_id={current_user.id} | "
        f"user_name='{current_user.name}' | org_id={org.id} | path={deleted_file_path}"
    )

    return {"success": True, "file_id": file_id}


@router.get("/{entity_id}/files/{file_id}/download")
async def download_entity_file(
    entity_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Download a file from an entity.
    Returns the file as a FileResponse.
    """
    from ..models.database import EntityFile

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
        file_logger.warning(
            f"FILE_DOWNLOAD: denied | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id} | reason=no_view_permission"
        )
        raise HTTPException(404, "Entity not found")

    # Get file record
    file_result = await db.execute(
        select(EntityFile).where(
            EntityFile.id == file_id,
            EntityFile.entity_id == entity_id
        )
    )
    entity_file = file_result.scalar_one_or_none()

    if not entity_file:
        file_logger.warning(
            f"FILE_DOWNLOAD: not_found | entity_id={entity_id} | file_id={file_id} | "
            f"user_id={current_user.id}"
        )
        raise HTTPException(404, "File not found")

    # Check if file exists on disk
    file_path = Path(entity_file.file_path)
    if not file_path.exists():
        file_logger.error(
            f"FILE_DOWNLOAD: missing_on_disk | entity_id={entity_id} | file_id={file_id} | "
            f"file_name='{entity_file.file_name}' | path={entity_file.file_path} | "
            f"user_id={current_user.id}"
        )
        raise HTTPException(404, "File not found on disk")

    # Log successful download
    file_logger.info(
        f"FILE_DOWNLOAD: success | entity_id={entity_id} | file_id={file_id} | "
        f"file_name='{entity_file.file_name}' | size={entity_file.file_size} bytes | "
        f"mime_type={entity_file.mime_type} | user_id={current_user.id} | "
        f"user_name='{current_user.name}' | org_id={org.id}"
    )

    # Return file
    return FileResponse(
        path=file_path,
        filename=entity_file.file_name,
        media_type=entity_file.mime_type or "application/octet-stream"
    )


@router.post("/{entity_id}/files/cleanup")
async def cleanup_entity_orphaned_files(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Clean up orphaned files for a specific entity.
    Orphaned files are files on disk that have no corresponding database record.
    Requires edit permission on the entity.
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
        file_logger.warning(
            f"FILE_CLEANUP: denied | entity_id={entity_id} | "
            f"user_id={current_user.id} | reason=no_edit_permission"
        )
        raise HTTPException(403, "No edit permission for this entity")

    # Perform cleanup
    count, removed_files = await cleanup_orphaned_files_for_entity(db, entity_id, org.id)

    file_logger.info(
        f"FILE_CLEANUP: success | entity_id={entity_id} | "
        f"removed_count={count} | user_id={current_user.id} | "
        f"user_name='{current_user.name}' | org_id={org.id}"
    )

    return {
        "success": True,
        "entity_id": entity_id,
        "removed_count": count,
        "removed_files": removed_files
    }


@router.post("/files/cleanup-all")
async def cleanup_all_orphaned_files_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Clean up orphaned files for all entities in the user's organization.
    Orphaned files are files on disk that have no corresponding database record.
    Requires admin or owner role in the organization.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Check if user has admin access
    org_role = await get_user_org_role(current_user, org.id, db)
    if org_role not in [OrgRole.owner, OrgRole.admin]:
        file_logger.warning(
            f"FILE_CLEANUP_ALL: denied | org_id={org.id} | "
            f"user_id={current_user.id} | role={org_role} | reason=not_admin"
        )
        raise HTTPException(403, "Admin or owner access required for organization-wide cleanup")

    # Perform cleanup
    result = await cleanup_all_orphaned_files(db, org.id)

    file_logger.info(
        f"FILE_CLEANUP_ALL: success | org_id={org.id} | "
        f"entities_processed={result['entities_processed']} | "
        f"total_removed={result['total_removed']} | "
        f"errors_count={len(result['errors'])} | "
        f"user_id={current_user.id} | user_name='{current_user.name}'"
    )

    return {
        "success": True,
        "org_id": org.id,
        **result
    }


# === Resume Parsing API ===

from ..services.resume_parser import resume_parser_service, ParsedResume


class ParsedResumeResponse(BaseModel):
    """Ответ с данными распарсенного резюме."""
    # Основные данные
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram: Optional[str] = None

    # Профессиональные данные
    position: Optional[str] = None
    company: Optional[str] = None
    experience_years: Optional[int] = None

    # Зарплатные ожидания
    expected_salary_min: Optional[int] = None
    expected_salary_max: Optional[int] = None
    expected_salary_currency: str = "RUB"

    # Навыки и образование
    skills: List[str] = []
    education: List[dict] = []
    experience: List[dict] = []
    languages: List[dict] = []

    # Дополнительные данные
    location: Optional[str] = None
    about: Optional[str] = None
    links: List[str] = []

    # Метаданные парсинга
    parse_confidence: float = 0.0
    parse_warnings: List[str] = []

    class Config:
        from_attributes = True


class EntityFromResumeResponse(BaseModel):
    """Ответ при создании Entity из резюме."""
    entity: dict  # Созданная карточка кандидата
    parsed_data: ParsedResumeResponse  # Распарсенные данные резюме
    file_id: Optional[int] = None  # ID прикреплённого файла


@router.post("/parse-resume", response_model=ParsedResumeResponse)
async def parse_resume(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Парсинг резюме и извлечение структурированных данных.

    Принимает файл резюме (PDF, DOC, DOCX) и возвращает JSON
    с извлечёнными данными: ФИО, контакты, навыки, опыт и т.д.

    Этот endpoint только парсит резюме, но не создаёт карточку кандидата.
    Для создания карточки используйте POST /api/entities/from-resume.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "Нет доступа к организации")

    # Проверяем размер файла
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            413,
            f"Файл слишком большой. Максимальный размер: {MAX_FILE_SIZE // (1024 * 1024)} МБ"
        )

    filename = file.filename or "resume"

    # Проверяем расширение файла
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    allowed_extensions = {'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'}
    if ext not in allowed_extensions:
        raise HTTPException(
            400,
            f"Неподдерживаемый формат файла: .{ext}. "
            f"Поддерживаются: {', '.join(allowed_extensions)}"
        )

    try:
        # Парсим резюме
        parsed = await resume_parser_service.parse_resume(content, filename)

        logger.info(
            f"RESUME_PARSE: success | filename='{filename}' | "
            f"name='{parsed.name}' | confidence={parsed.parse_confidence} | "
            f"user_id={current_user.id} | org_id={org.id}"
        )

        return ParsedResumeResponse(
            name=parsed.name,
            phone=parsed.phone,
            email=parsed.email,
            telegram=parsed.telegram,
            position=parsed.position,
            company=parsed.company,
            experience_years=parsed.experience_years,
            expected_salary_min=parsed.expected_salary_min,
            expected_salary_max=parsed.expected_salary_max,
            expected_salary_currency=parsed.expected_salary_currency,
            skills=parsed.skills or [],
            education=parsed.education or [],
            experience=parsed.experience or [],
            languages=parsed.languages or [],
            location=parsed.location,
            about=parsed.about,
            links=parsed.links or [],
            parse_confidence=parsed.parse_confidence,
            parse_warnings=parsed.parse_warnings or []
        )

    except ValueError as e:
        logger.warning(
            f"RESUME_PARSE: failed | filename='{filename}' | "
            f"error='{str(e)}' | user_id={current_user.id}"
        )
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(
            f"RESUME_PARSE: error | filename='{filename}' | "
            f"error='{str(e)}' | user_id={current_user.id}"
        )
        raise HTTPException(500, f"Ошибка парсинга резюме: {str(e)}")


@router.post("/from-resume", response_model=EntityFromResumeResponse)
async def create_entity_from_resume(
    file: UploadFile = File(...),
    department_id: Optional[int] = Form(None),
    auto_attach_file: bool = Form(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Парсинг резюме и автоматическое создание карточки кандидата.

    Этот endpoint:
    1. Парсит резюме (PDF, DOC, DOCX)
    2. Извлекает структурированные данные с помощью AI
    3. Создаёт Entity типа 'candidate' с заполненными полями
    4. Опционально прикрепляет оригинал файла к карточке

    Args:
        file: Файл резюме
        department_id: ID отдела (опционально)
        auto_attach_file: Прикреплять ли файл к карточке (по умолчанию True)

    Returns:
        Созданная карточка кандидата и распарсенные данные
    """
    from ..models.database import EntityFile, EntityFileType

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "Нет доступа к организации")

    # Проверяем размер файла
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            413,
            f"Файл слишком большой. Максимальный размер: {MAX_FILE_SIZE // (1024 * 1024)} МБ"
        )

    filename = file.filename or "resume"

    # Проверяем расширение файла
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    allowed_extensions = {'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'html', 'htm', 'zip'}
    if ext not in allowed_extensions:
        raise HTTPException(
            400,
            f"Неподдерживаемый формат файла: .{ext}. "
            f"Поддерживаются: {', '.join(allowed_extensions)}"
        )

    # Валидация department_id
    department_name = None
    if department_id:
        dept_result = await db.execute(
            select(Department).where(
                Department.id == department_id,
                Department.org_id == org.id
            )
        )
        dept = dept_result.scalar_one_or_none()
        if not dept:
            raise HTTPException(400, "Недействительный отдел")
        department_name = dept.name

    try:
        # Шаг 1: Парсим резюме
        parsed = await resume_parser_service.parse_resume(content, filename)

        # Шаг 2: Конвертируем в данные для Entity
        entity_data = parsed.to_entity_data()

        # Нормализуем идентификаторы
        normalized_usernames, validated_emails, filtered_phones = normalize_and_validate_identifiers(
            telegram_usernames=entity_data.get("telegram_usernames", []),
            emails=entity_data.get("emails", []),
            phones=entity_data.get("phones", [])
        )

        # Шаг 3: Создаём Entity
        entity = Entity(
            org_id=org.id,
            type=EntityType.candidate,
            name=entity_data["name"],
            status=EntityStatus.new,
            phone=entity_data.get("phone"),
            email=entity_data.get("email"),
            telegram_usernames=normalized_usernames,
            emails=validated_emails,
            phones=filtered_phones,
            company=entity_data.get("company"),
            position=entity_data.get("position"),
            tags=entity_data.get("tags", []),
            extra_data=entity_data.get("extra_data", {}),
            created_by=current_user.id,
            department_id=department_id,
            expected_salary_min=entity_data.get("expected_salary_min"),
            expected_salary_max=entity_data.get("expected_salary_max"),
            expected_salary_currency=entity_data.get("expected_salary_currency", "RUB")
        )
        db.add(entity)
        await db.flush()  # Получаем ID entity

        # Шаг 4: Прикрепляем файл (если нужно)
        file_id = None
        if auto_attach_file:
            # Создаём директорию для файлов
            entity_dir = ENTITY_FILES_DIR / str(entity.id)
            entity_dir.mkdir(parents=True, exist_ok=True)

            # Генерируем уникальное имя файла
            safe_filename = re.sub(r'[^\w\-\.]', '_', filename)
            unique_name = f"{uuid.uuid4().hex[:8]}_{safe_filename}"
            file_path = entity_dir / unique_name

            # Сохраняем файл
            with open(file_path, 'wb') as f:
                f.write(content)

            # Определяем MIME-тип
            content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

            # Создаём запись EntityFile
            entity_file = EntityFile(
                entity_id=entity.id,
                org_id=org.id,
                file_type=EntityFileType.resume,
                file_name=filename,
                file_path=str(file_path),
                file_size=len(content),
                mime_type=content_type,
                description="Резюме (автоматически загружено при парсинге)",
                uploaded_by=current_user.id
            )
            db.add(entity_file)
            await db.flush()
            file_id = entity_file.id

        await db.commit()
        await db.refresh(entity)

        # Формируем response
        entity_response = {
            "id": entity.id,
            "type": entity.type.value if hasattr(entity.type, 'value') else entity.type,
            "name": entity.name,
            "status": entity.status.value if hasattr(entity.status, 'value') else entity.status,
            "phone": entity.phone,
            "email": entity.email,
            "telegram_usernames": entity.telegram_usernames or [],
            "emails": entity.emails or [],
            "phones": entity.phones or [],
            "company": entity.company,
            "position": entity.position,
            "tags": entity.tags or [],
            "extra_data": entity.extra_data or {},
            "created_by": entity.created_by,
            "department_id": entity.department_id,
            "department_name": department_name,
            "created_at": entity.created_at.isoformat() if entity.created_at else None,
            "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
            "chats_count": 0,
            "calls_count": 0,
            "expected_salary_min": entity.expected_salary_min,
            "expected_salary_max": entity.expected_salary_max,
            "expected_salary_currency": entity.expected_salary_currency or 'RUB'
        }

        parsed_response = ParsedResumeResponse(
            name=parsed.name,
            phone=parsed.phone,
            email=parsed.email,
            telegram=parsed.telegram,
            position=parsed.position,
            company=parsed.company,
            experience_years=parsed.experience_years,
            expected_salary_min=parsed.expected_salary_min,
            expected_salary_max=parsed.expected_salary_max,
            expected_salary_currency=parsed.expected_salary_currency,
            skills=parsed.skills or [],
            education=parsed.education or [],
            experience=parsed.experience or [],
            languages=parsed.languages or [],
            location=parsed.location,
            about=parsed.about,
            links=parsed.links or [],
            parse_confidence=parsed.parse_confidence,
            parse_warnings=parsed.parse_warnings or []
        )

        logger.info(
            f"ENTITY_FROM_RESUME: success | entity_id={entity.id} | "
            f"name='{entity.name}' | confidence={parsed.parse_confidence} | "
            f"file_attached={file_id is not None} | user_id={current_user.id} | org_id={org.id}"
        )

        # Broadcast entity.created event
        await broadcast_entity_created(org.id, entity_response)

        return EntityFromResumeResponse(
            entity=entity_response,
            parsed_data=parsed_response,
            file_id=file_id
        )

    except ValueError as e:
        logger.warning(
            f"ENTITY_FROM_RESUME: failed | filename='{filename}' | "
            f"error='{str(e)}' | user_id={current_user.id}"
        )
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(
            f"ENTITY_FROM_RESUME: error | filename='{filename}' | "
            f"error='{str(e)}' | user_id={current_user.id}"
        )
        await db.rollback()
        raise HTTPException(500, f"Ошибка создания карточки из резюме: {str(e)}")


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

    This endpoint analyzes the candidate's profile (skills, salary expectations,
    position) and returns a list of matching vacancies sorted by match score.

    Args:
        entity_id: ID of the candidate entity
        limit: Maximum number of recommendations (1-20)

    Returns:
        List of VacancyRecommendationResponse objects sorted by match_score descending
    """
    from ..services.vacancy_recommender import vacancy_recommender

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
        raise HTTPException(400, "Рекомендации доступны только для кандидатов")

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

    Creates a new application with stage 'applied' and source 'auto_recommendation'.

    Args:
        entity_id: ID of the candidate entity
        vacancy_id: ID of the target vacancy

    Returns:
        Created application details or error if already applied
    """
    from ..services.vacancy_recommender import vacancy_recommender
    from ..models.database import Vacancy

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
        raise HTTPException(400, "Только кандидаты могут подавать заявки")

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
        raise HTTPException(400, "Кандидат уже подавал заявку на эту вакансию")

    return {
        "id": application.id,
        "vacancy_id": application.vacancy_id,
        "entity_id": application.entity_id,
        "stage": application.stage.value,
        "source": application.source,
        "applied_at": application.applied_at.isoformat() if application.applied_at else None,
        "message": "Заявка успешно создана"
    }


# === SIMILAR CANDIDATES & DUPLICATES ===


class SimilarCandidateResponse(BaseModel):
    """Ответ с информацией о похожем кандидате."""
    entity_id: int
    entity_name: str
    similarity_score: int  # 0-100
    common_skills: List[str] = []
    similar_experience: bool = False
    similar_salary: bool = False
    similar_location: bool = False
    match_reasons: List[str] = []

    class Config:
        from_attributes = True


class DuplicateCandidateResponse(BaseModel):
    """Ответ с информацией о возможном дубликате."""
    entity_id: int
    entity_name: str
    confidence: int  # 0-100
    match_reasons: List[str] = []
    matched_fields: dict = {}  # {field: [value1, value2]}

    class Config:
        from_attributes = True


class MergeEntitiesRequest(BaseModel):
    """Запрос на объединение сущностей."""
    source_entity_id: int  # Будет удалена
    keep_source_data: bool = False  # Приоритет данных source


class MergeEntitiesResponse(BaseModel):
    """Ответ после объединения сущностей."""
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
    Получить список похожих кандидатов.

    Поиск ведется по:
    - Навыкам (skills в extra_data) - 50% веса
    - Опыту работы - 20% веса
    - Зарплатным ожиданиям - 15% веса
    - Локации - 15% веса

    Args:
        entity_id: ID кандидата
        limit: Максимальное количество результатов (1-50)

    Returns:
        Список похожих кандидатов, отсортированных по убыванию similarity_score
    """
    from ..services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Получаем сущность
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    if entity.type != EntityType.candidate:
        raise HTTPException(400, "Поиск похожих доступен только для кандидатов")

    # Поиск похожих
    similar = await similarity_service.find_similar(
        db=db,
        entity=entity,
        limit=limit,
        org_id=org.id
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
    Получить список возможных дубликатов.

    Проверяется:
    - Имя (с учетом транслитерации рус/eng)
    - Email
    - Телефон
    - Навыки + компания

    Args:
        entity_id: ID сущности

    Returns:
        Список возможных дубликатов с вероятностью совпадения
    """
    from ..services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Получаем сущность
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Поиск дубликатов
    duplicates = await similarity_service.detect_duplicates(
        db=db,
        entity=entity,
        org_id=org.id
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
    Объединить два дубликата.

    Целевая сущность (entity_id) остается, исходная (source_entity_id) удаляется.
    Все связанные данные (чаты, звонки, анализы) переносятся на целевую сущность.

    При объединении:
    - Контактные данные (телефоны, email, telegram) объединяются
    - Теги объединяются
    - extra_data объединяется (приоритет определяется параметром keep_source_data)
    - Навыки всегда объединяются
    - Зарплатные ожидания расширяются (берется минимум из min и максимум из max)

    Args:
        entity_id: ID целевой сущности (останется)
        request: Параметры объединения
            - source_entity_id: ID исходной сущности (будет удалена)
            - keep_source_data: True - данные source имеют приоритет при конфликтах

    Returns:
        Результат операции объединения
    """
    from ..services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Проверяем права (только admin/owner могут объединять)
    org_role = await get_user_org_role(current_user, org.id, db)
    if org_role not in [OrgRole.admin, OrgRole.owner]:
        raise HTTPException(403, "Только администраторы могут объединять дубликаты")

    if entity_id == request.source_entity_id:
        raise HTTPException(400, "Нельзя объединить сущность саму с собой")

    # Получаем целевую сущность
    target_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    target_entity = target_result.scalar_one_or_none()

    if not target_entity:
        raise HTTPException(404, "Целевая сущность не найдена")

    # Получаем исходную сущность
    source_result = await db.execute(
        select(Entity).where(Entity.id == request.source_entity_id, Entity.org_id == org.id)
    )
    source_entity = source_result.scalar_one_or_none()

    if not source_entity:
        raise HTTPException(404, "Исходная сущность не найдена")

    # Объединяем
    try:
        merged = await similarity_service.merge_entities(
            db=db,
            source_entity=source_entity,
            target_entity=target_entity,
            keep_source_data=request.keep_source_data
        )

        # Broadcast обновление
        await broadcast_entity_updated(org.id, merged.id)
        await broadcast_entity_deleted(org.id, request.source_entity_id)

        return MergeEntitiesResponse(
            success=True,
            message=f"Сущности успешно объединены. {source_entity.name} была удалена.",
            merged_entity_id=merged.id,
            deleted_entity_id=request.source_entity_id
        )
    except Exception as e:
        logger.error(f"Error merging entities: {e}")
        raise HTTPException(500, f"Ошибка при объединении: {str(e)}")


@router.get("/{entity_id}/compare/{other_entity_id}", response_model=SimilarCandidateResponse)
async def compare_candidates(
    entity_id: int,
    other_entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Сравнить двух кандидатов.

    Args:
        entity_id: ID первого кандидата
        other_entity_id: ID второго кандидата

    Returns:
        Результат сравнения с оценкой сходства
    """
    from ..services.similarity import similarity_service

    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    if entity_id == other_entity_id:
        raise HTTPException(400, "Нельзя сравнить сущность саму с собой")

    # Получаем первую сущность
    result1 = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity1 = result1.scalar_one_or_none()

    if not entity1:
        raise HTTPException(404, "Первая сущность не найдена")

    # Получаем вторую сущность
    result2 = await db.execute(
        select(Entity).where(Entity.id == other_entity_id, Entity.org_id == org.id)
    )
    entity2 = result2.scalar_one_or_none()

    if not entity2:
        raise HTTPException(404, "Вторая сущность не найдена")

    # Сравниваем
    comparison = similarity_service.calculate_similarity(entity1, entity2)

    return SimilarCandidateResponse(
        entity_id=comparison.entity_id,
        entity_name=comparison.entity_name,
        similarity_score=comparison.similarity_score,
        common_skills=comparison.common_skills,
        similar_experience=comparison.similar_experience,
        similar_salary=comparison.similar_salary,
        similar_location=comparison.similar_location,
        match_reasons=comparison.match_reasons
    )


# === Entity Chats & Calls API ===
# These endpoints provide easy access to chats and calls linked to an entity

@router.get("/{entity_id}/chats")
async def get_entity_chats(
    entity_id: int,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all chats linked to an entity (candidate/contact).

    Returns a list of chats with basic info (id, title, type, messages count, last activity).
    Useful for viewing all communication history with a specific contact.
    """
    from sqlalchemy.orm import selectinload
    from ..services.permissions import PermissionService

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

    # Get chats linked to this entity
    chats_query = (
        select(Chat)
        .options(selectinload(Chat.owner))
        .where(
            Chat.entity_id == entity_id,
            Chat.org_id == org.id,
            Chat.deleted_at.is_(None)
        )
        .order_by(Chat.last_activity.desc())
        .offset(offset)
        .limit(limit)
    )

    result = await db.execute(chats_query)
    chats = result.scalars().all()

    if not chats:
        return []

    # Get chat IDs for batch queries
    chat_ids = [chat.id for chat in chats]

    # Batch query: Get message counts
    msg_counts_result = await db.execute(
        select(Message.chat_id, func.count(Message.id))
        .where(Message.chat_id.in_(chat_ids))
        .group_by(Message.chat_id)
    )
    msg_counts = {row[0]: row[1] for row in msg_counts_result.fetchall()}

    # Build response
    response = []
    for chat in chats:
        is_mine = chat.owner_id == current_user.id

        response.append({
            "id": chat.id,
            "telegram_chat_id": chat.telegram_chat_id,
            "title": chat.title,
            "custom_name": chat.custom_name,
            "chat_type": chat.chat_type.value if chat.chat_type else "hr",
            "owner_id": chat.owner_id,
            "owner_name": chat.owner.name if chat.owner else None,
            "is_active": chat.is_active,
            "messages_count": msg_counts.get(chat.id, 0),
            "last_activity": chat.last_activity.isoformat() if chat.last_activity else None,
            "created_at": chat.created_at.isoformat() if chat.created_at else None,
            "is_mine": is_mine,
        })

    return response


@router.get("/{entity_id}/calls")
async def get_entity_calls(
    entity_id: int,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all call recordings linked to an entity (candidate/contact).

    Returns a list of calls with basic info (id, title, status, duration, created_at).
    Useful for viewing all call history with a specific contact.
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

    # Get calls linked to this entity
    calls_query = (
        select(CallRecording)
        .where(
            CallRecording.entity_id == entity_id,
            CallRecording.org_id == org.id
        )
        .order_by(CallRecording.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    result = await db.execute(calls_query)
    calls = result.scalars().all()

    if not calls:
        return []

    # Get owner IDs for batch query
    owner_ids = list(set(call.owner_id for call in calls if call.owner_id))

    # Batch query: Get owner names
    owner_names_map = {}
    if owner_ids:
        owner_result = await db.execute(
            select(User.id, User.name).where(User.id.in_(owner_ids))
        )
        owner_names_map = {row[0]: row[1] for row in owner_result.fetchall()}

    # Build response
    response = []
    for call in calls:
        is_mine = call.owner_id == current_user.id

        response.append({
            "id": call.id,
            "title": call.title,
            "source_type": call.source_type.value if call.source_type else None,
            "status": call.status.value if call.status else None,
            "duration_seconds": call.duration_seconds,
            "owner_id": call.owner_id,
            "owner_name": owner_names_map.get(call.owner_id) if call.owner_id else None,
            "summary": call.summary[:200] + "..." if call.summary and len(call.summary) > 200 else call.summary,
            "created_at": call.created_at.isoformat() if call.created_at else None,
            "processed_at": call.processed_at.isoformat() if call.processed_at else None,
            "is_mine": is_mine,
        })

    return response


@router.post("/{entity_id}/link-call/{call_id}")
async def link_call_to_entity(
    entity_id: int,
    call_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Link a call recording to an entity (candidate/contact).

    This allows associating call recordings with specific contacts,
    making it easier to find all calls related to a candidate.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Verify entity exists and belongs to same org
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check edit permissions - requires edit or full access
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        raise HTTPException(403, "No edit permission for this entity")

    # Get and update call (must belong to same org)
    call_result = await db.execute(
        select(CallRecording).where(CallRecording.id == call_id, CallRecording.org_id == org.id)
    )
    call = call_result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    call.entity_id = entity_id
    await db.commit()
    return {"success": True, "entity_id": entity_id, "call_id": call_id}


@router.delete("/{entity_id}/unlink-call/{call_id}")
async def unlink_call_from_entity(
    entity_id: int,
    call_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Unlink a call recording from an entity (candidate/contact).

    Removes the association between a call and a contact without deleting either.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Verify entity exists and user has edit access
    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    # Check edit permissions - requires edit or full access
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.edit)
    if not has_access:
        raise HTTPException(403, "No edit permission for this entity")

    call_result = await db.execute(
        select(CallRecording).where(
            CallRecording.id == call_id,
            CallRecording.entity_id == entity_id,
            CallRecording.org_id == org.id
        )
    )
    call = call_result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found or not linked to this entity")

    call.entity_id = None
    await db.commit()
    return {"success": True}
