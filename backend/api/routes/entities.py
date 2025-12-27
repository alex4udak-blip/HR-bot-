from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Literal
from datetime import datetime
from pydantic import BaseModel
import re

from ..database import get_db
from ..models.database import (
    Entity, EntityType, EntityStatus, EntityTransfer,
    Chat, CallRecording, AnalysisHistory, User, Organization,
    SharedAccess, ResourceType, UserRole, AccessLevel, OrgRole,
    Department, DepartmentMember, DeptRole
)
from ..services.auth import get_current_user, get_user_org, get_user_org_role, can_share_to
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


class ShareRequest(BaseModel):
    shared_with_id: int
    access_level: AccessLevel = AccessLevel.view
    note: Optional[str] = None
    expires_at: Optional[datetime] = None
    auto_share_related: bool = True  # Auto-share related chats and calls


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
        lead_dept_ids = [dm.department_id for dm in dept_memberships if dm.role == DeptRole.lead]

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
            # Org owner see all
            user_role = await get_user_org_role(current_user, org.id, db)
            if user_role == OrgRole.owner:
                query = select(Entity).where(Entity.org_id == org.id)
            else:
                # Own entities + shared with me + entities in user's departments
                conditions = [
                    Entity.created_by == current_user.id,
                    Entity.id.in_(shared_ids_query)
                ]
                # Department members can view all entities in their departments
                if user_dept_ids:
                    conditions.append(Entity.department_id.in_(user_dept_ids))

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
    # Superadmin and org owner see all counts, others see only accessible counts
    user_role = await get_user_org_role(current_user, org.id, db) if org else None

    if current_user.role == UserRole.superadmin or user_role == OrgRole.owner:
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

        # Get departments where user is lead
        lead_dept_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == current_user.id,
                DepartmentMember.role == DeptRole.lead
            )
        )
        lead_dept_ids = [r for r in lead_dept_result.scalars().all()]

        # Get user IDs in departments where current user is lead
        dept_member_ids = set()
        if lead_dept_ids:
            dept_members_result = await db.execute(
                select(DepartmentMember.user_id).where(
                    DepartmentMember.department_id.in_(lead_dept_ids)
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
            # Transfer tracking
            "is_transferred": entity.is_transferred or False,
            "transferred_to_id": entity.transferred_to_id,
            "transferred_to_name": transferred_to_names.get(entity.transferred_to_id) if entity.transferred_to_id else None,
            "transferred_at": entity.transferred_at.isoformat() if entity.transferred_at else None
        })

    return response


@router.post("")
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
        department_id=data.department_id
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
        "calls_count": 0
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
    user_role = await get_user_org_role(current_user, org.id, db)

    # Superadmin and org owner see all chats/calls
    if current_user.role == UserRole.superadmin or user_role == OrgRole.owner:
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

        # Get departments where user is lead
        lead_dept_result = await db.execute(
            select(DepartmentMember.department_id).where(
                DepartmentMember.user_id == current_user.id,
                DepartmentMember.role == DeptRole.lead
            )
        )
        lead_dept_ids = [r for r in lead_dept_result.scalars().all()]

        # Get user IDs in departments where current user is lead
        dept_member_ids = set()
        if lead_dept_ids:
            dept_members_result = await db.execute(
                select(DepartmentMember.user_id).where(
                    DepartmentMember.department_id.in_(lead_dept_ids)
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

    transfers_result = await db.execute(
        select(EntityTransfer).where(EntityTransfer.entity_id == entity_id).order_by(EntityTransfer.created_at.desc())
    )
    analyses_result = await db.execute(
        select(AnalysisHistory).where(AnalysisHistory.entity_id == entity_id).order_by(AnalysisHistory.created_at.desc())
    )
    transfers = transfers_result.scalars().all()
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
        # Transfer tracking
        "is_transferred": entity.is_transferred or False,
        "transferred_to_id": entity.transferred_to_id,
        "transferred_to_name": transferred_to_name,
        "transferred_at": entity.transferred_at.isoformat() if entity.transferred_at else None,
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

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
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
        user_role = await get_user_org_role(current_user, org.id, db)
        if user_role == OrgRole.owner:
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

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(entity, key, value)

    entity.updated_at = datetime.utcnow()
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
        "updated_at": entity.updated_at.isoformat() if entity.updated_at else None
    }

    # Broadcast entity.updated event
    await broadcast_entity_updated(org.id, response_data)

    return response_data


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

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
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
        user_role = await get_user_org_role(current_user, org.id, db)
        if user_role == OrgRole.owner:
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

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
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
    if current_user.role == UserRole.superadmin or from_user_role == OrgRole.owner:
        # SUPERADMIN and OWNER can transfer to anyone
        can_transfer = True
    else:
        # Check department-based permissions
        has_sub_admin = any(dm.role == DeptRole.sub_admin for dm in from_dept_memberships)

        if has_sub_admin or from_user_role == OrgRole.admin:
            # SUB_ADMIN and ADMIN can transfer to:
            # 1. Anyone in their own department
            # 2. Admins/sub_admins of other departments
            if any(dept_id in from_dept_ids for dept_id in to_dept_ids):
                # Same department
                can_transfer = True
            else:
                # Check if target is admin/sub_admin of any department
                is_target_admin = any(dm.role in [DeptRole.sub_admin, DeptRole.lead] for dm in to_dept_memberships)
                if is_target_admin or to_user_role == OrgRole.admin:
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
    transfer = EntityTransfer(
        entity_id=entity_id,
        from_user_id=current_user.id,
        to_user_id=data.to_user_id,
        from_department_id=from_dept_id,
        to_department_id=data.to_department_id,
        comment=data.comment
    )
    db.add(transfer)

    await db.commit()

    # TODO: Send notification to recipient via Telegram

    return {
        "success": True,
        "transfer_id": transfer.id,
        "original_entity_id": entity.id,
        "copy_entity_id": entity_copy.id,
        "transferred_chats": len(chats),
        "transferred_calls": len(calls)
    }


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
        user_role = await get_user_org_role(current_user, org.id, db)
        if user_role == OrgRole.owner:
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
        # Find all chats linked to this entity
        chats_result = await db.execute(
            select(Chat).where(Chat.entity_id == entity_id, Chat.org_id == org.id)
        )
        chats = chats_result.scalars().all()

        for chat in chats:
            # Check if already shared
            existing_chat_share_result = await db.execute(
                select(SharedAccess).where(
                    SharedAccess.resource_type == ResourceType.chat,
                    SharedAccess.resource_id == chat.id,
                    SharedAccess.shared_with_id == data.shared_with_id
                )
            )
            existing_chat_share = existing_chat_share_result.scalar_one_or_none()

            if existing_chat_share:
                # Update existing
                existing_chat_share.access_level = data.access_level
                existing_chat_share.expires_at = data.expires_at
                existing_chat_share.shared_by_id = current_user.id
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

        # Find all calls linked to this entity
        calls_result = await db.execute(
            select(CallRecording).where(CallRecording.entity_id == entity_id, CallRecording.org_id == org.id)
        )
        calls = calls_result.scalars().all()

        for call in calls:
            # Check if already shared
            existing_call_share_result = await db.execute(
                select(SharedAccess).where(
                    SharedAccess.resource_type == ResourceType.call,
                    SharedAccess.resource_id == call.id,
                    SharedAccess.shared_with_id == data.shared_with_id
                )
            )
            existing_call_share = existing_call_share_result.scalar_one_or_none()

            if existing_call_share:
                # Update existing
                existing_call_share.access_level = data.access_level
                existing_call_share.expires_at = data.expires_at
                existing_call_share.shared_by_id = current_user.id
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
