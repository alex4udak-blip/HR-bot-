"""
CRUD operations for entities (create, read, update, delete).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime
import asyncio

from .common import (
    logger, get_db, Entity, EntityType, EntityStatus, EntityTransfer,
    Chat, CallRecording, AnalysisHistory, User, SharedAccess, ResourceType,
    UserRole, AccessLevel, Department, DepartmentMember, DeptRole,
    Vacancy, VacancyApplication, VacancyStatus, STATUS_SYNC_MAP,
    get_current_user, get_user_org, has_full_database_access,
    broadcast_entity_created, broadcast_entity_updated, broadcast_entity_deleted,
    scoring_cache, OwnershipFilter,
    EntityCreate, EntityUpdate, StatusUpdate,
    normalize_and_validate_identifiers, check_entity_access,
    regenerate_entity_profile_background
)

router = APIRouter()


@router.get("/")
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
    from .common import normalize_telegram_username

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


@router.post("/", status_code=201)
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


@router.put("/{entity_id}")
async def update_entity(
    entity_id: int,
    data: EntityUpdate,
    background_tasks: BackgroundTasks,
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

    # Synchronize Entity.status -> VacancyApplication.stage if status changed
    if 'status' in update_data and data.status in STATUS_SYNC_MAP:
        new_stage = STATUS_SYNC_MAP[data.status]
        # Find active application for this entity
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
            logger.info(f"PUT /entities/{entity_id}: Synchronized status {data.status} -> application {application.id} stage {new_stage}")

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
    scoring_relevant_fields = {
        'tags', 'extra_data', 'expected_salary_min', 'expected_salary_max',
        'expected_salary_currency', 'position', 'ai_summary'
    }
    if any(field in update_data for field in scoring_relevant_fields):
        await scoring_cache.invalidate_entity_scores(entity.id)
        logger.info(f"Invalidated scoring cache for entity {entity.id} due to scoring-relevant field change")

    # Regenerate AI profile in background if profile-relevant fields changed
    profile_relevant_fields = {
        'name', 'position', 'company', 'tags', 'extra_data',
        'expected_salary_min', 'expected_salary_max', 'expected_salary_currency'
    }
    if any(field in update_data for field in profile_relevant_fields):
        # Only regenerate if entity already has an AI profile
        if entity.extra_data and entity.extra_data.get('ai_profile'):
            background_tasks.add_task(
                asyncio.create_task,
                regenerate_entity_profile_background(entity.id, org.id)
            )
            logger.info(f"Scheduled AI profile regeneration for entity {entity.id}")

    # Broadcast entity.updated event
    await broadcast_entity_updated(org.id, response_data)

    return response_data


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

    # SECURITY: Check edit permissions before allowing status update
    can_edit = False
    if current_user.role == UserRole.superadmin:
        can_edit = True
    else:
        # Full access users can edit
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

    # Update status
    old_status = entity.status
    entity.status = data.status

    # Synchronize Entity.status -> VacancyApplication.stage
    if data.status in STATUS_SYNC_MAP:
        new_stage = STATUS_SYNC_MAP[data.status]
        # Find active application for this entity
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


# Stats endpoints

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
