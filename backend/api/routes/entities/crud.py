"""
CRUD operations for entities (create, read, update, delete).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import asyncio
import logging

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
from ...services.shadow_filter import get_isolated_creator_ids

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

    # SUPERADMIN sees everything across all organizations (with shadow content isolation)
    if current_user.role == UserRole.superadmin:
        query = select(Entity)
        # Apply shadow user content isolation
        isolated_ids = await get_isolated_creator_ids(current_user, db)
        if isolated_ids:
            query = query.where(~Entity.created_by.in_(isolated_ids))
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

    # Теневая база: архивные кандидаты скрыты из активного списка
    query = query.where(Entity.is_archived.is_not(True))

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
                # Поиск по JSON-массивам через @> (Python-оператор and на ClauseElement
                # тут ронял запрос TypeError; @> сам корректно обрабатывает NULL/пустые).
                Entity.emails.op('@>')(func.jsonb_build_array(identifier_term)),
                Entity.phones.op('@>')(func.jsonb_build_array(identifier_term)),
                Entity.telegram_usernames.op('@>')(func.jsonb_build_array(normalized_username))
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

    # Теневая дедупликация: сверяем нового активного кандидата с архивом.
    # При совпадении помечаем профиль флагом — фронт покажет баннер «Проверить».
    hidden_duplicate_id = None
    if entity.type == EntityType.candidate:
        try:
            from ...services.similarity import detect_archived_duplicate
            hidden_duplicate_id = await detect_archived_duplicate(db, entity)
            if hidden_duplicate_id:
                extra = dict(entity.extra_data or {})
                extra["hidden_duplicate_id"] = hidden_duplicate_id
                entity.extra_data = extra
                await db.commit()
                await db.refresh(entity)
        except Exception as e:
            logger.warning(f"shadow-dedup detect failed for new entity {entity.id}: {e}")

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
        "expected_salary_currency": entity.expected_salary_currency or 'RUB',
        "has_hidden_duplicate": bool(hidden_duplicate_id),
        "hidden_duplicate_id": hidden_duplicate_id,
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

    # Ленивый self-heal авто-меток HR: при открытии карточки пересчитываем
    # закреплённых рекрутеров. Ловит заявки, созданные путями без явного вызова
    # синка (формы, CSV-импорт, рекоммендер, magic-button). Diff-guard внутри:
    # пишет (и коммитит) ТОЛЬКО при реальном изменении — обычный GET остаётся
    # read-only. После коммита entity перечитается с уже свежим extra_data.
    try:
        from ...services.hr_tags import sync_for_entity
        await sync_for_entity(db, entity_id)
    except Exception:
        logging.getLogger("hr-analyzer.entities").warning(
            "HR-tags self-heal failed for entity %s", entity_id, exc_info=True
        )

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
        # Ownership info for frontend permissions
        "owner_id": entity.created_by,
        "is_mine": entity.created_by == current_user.id,
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

    # extra_data: MERGE, не заменять — иначе частичный апдейт (напр. форма правки
    # шлёт только salary/city/...) затрёт notes, merged_from, timeline_reactions,
    # resume_demos и пр. Присланные ключи перекрывают существующие, остальное
    # сохраняется.
    if 'extra_data' in update_data:
        _merged_extra = dict(entity.extra_data or {})
        _merged_extra.update(update_data.pop('extra_data') or {})
        entity.extra_data = _merged_extra

    for key, value in update_data.items():
        setattr(entity, key, value)

    entity.updated_at = datetime.utcnow()
    # Increment version for optimistic locking
    entity.version = (entity.version or 1) + 1

    # Synchronize Entity.status -> VacancyApplication.stage if status changed
    if 'status' in update_data and data.status in STATUS_SYNC_MAP:
        new_stage = STATUS_SYNC_MAP[data.status]
        # Find active application for this entity
        apps = (await db.execute(
            select(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(
                VacancyApplication.entity_id == entity_id,
                Vacancy.status != VacancyStatus.closed
            )
        )).scalars().all()
        # Синхронизируем этап ТОЛЬКО когда отклик ровно один — иначе непонятно,
        # в какой вакансии менять этап, и можно затереть чужую воронку.
        if len(apps) == 1 and apps[0].stage != new_stage:
            apps[0].stage = new_stage
            apps[0].last_stage_change_at = datetime.utcnow()
            logger.info(f"PUT /entities/{entity_id}: Synchronized status {data.status} -> application {apps[0].id} stage {new_stage}")

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


class NoteCreate(BaseModel):
    text: str
    stage: Optional[str] = None
    stage_label: Optional[str] = None


class NoteUpdate(BaseModel):
    text: str


def _note_org_check(entity, current_user, org):
    """Общая проверка: org-scope доступа к entity для notes-эндпоинтов."""
    if current_user.role != UserRole.superadmin:
        if not org or entity.org_id != org.id:
            raise HTTPException(404, "Entity not found")


def _note_can_modify(note: dict, current_user) -> bool:
    """Edit/delete: только автор коммента или админ/owner/superadmin."""
    if current_user.role == UserRole.superadmin:
        return True
    # Owner/admin org-роли проверяются на уровне аутентификации; здесь —
    # просто сверяем author_id с текущим пользователем.
    author_id = note.get("author_id")
    return author_id is not None and int(author_id) == int(current_user.id)


@router.post("/{entity_id}/notes")
async def add_entity_note(
    entity_id: int,
    data: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Добавить комментарий-заметку кандидату.

    Доступно любому пользователю в той же организации, что и entity —
    зеркалит видимость в общем kanban'e /all-candidates (где рекрутёр
    видит всех кандидатов оргa). Комментарий не модифицирует данные
    кандидата, а только дополняет workflow.
    """
    import uuid
    from datetime import timezone as _tz
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org and current_user.role != UserRole.superadmin:
        raise HTTPException(403, "No organization access")

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")
    _note_org_check(entity, current_user, org)

    text_clean = (data.text or "").strip()
    if not text_clean:
        raise HTTPException(400, "Comment text cannot be empty")
    if len(text_clean) > 5000:
        raise HTTPException(400, "Comment too long (max 5000)")

    extra = dict(entity.extra_data or {})
    notes = list(extra.get("notes") or [])
    note = {
        "id": str(uuid.uuid4()),
        "text": text_clean,
        "date": datetime.now(_tz.utc).isoformat(),
        "stage": data.stage,
        "stage_label": data.stage_label,
        "author_id": current_user.id,
        "author_name": current_user.name,
    }
    notes.append(note)
    extra["notes"] = notes
    entity.extra_data = extra
    # Сначала ГАРАНТИРОВАННО коммитим сам комментарий — его сохранность не должна
    # зависеть от уведомлений об @-упоминаниях (иначе при сбое/медленном notify
    # коммент «появлялся только после F5»).
    await db.commit()
    await db.refresh(entity)

    # @-упоминания — ОТДЕЛЬНОЙ транзакцией: достаём data-uid из HTML и шлём
    # упомянутым уведомление «как у анкет». Падение здесь уже не трогает коммент.
    try:
        from ...services.hr_notifications import notify_comment_mentions
        await notify_comment_mentions(
            db, text=text_clean, author=current_user, entity=entity
        )
        await db.commit()
    except Exception:
        await db.rollback()

    return {"success": True, "note": note, "total_notes": len(notes)}


class TimelineReactionRequest(BaseModel):
    entry_key: str
    emoji: str


@router.post("/{entity_id}/timeline-reaction")
async def toggle_timeline_reaction(
    entity_id: int,
    data: TimelineReactionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Тоггл эмодзи-реакции на запись таймлайна (лог карточки).

    entry_key — стабильный ключ записи (id заметки / history-id события / 'created').
    Реакции хранятся в extra_data.timeline_reactions[entry_key] = [{emoji, user_id,
    user_name, date}]. Повторный клик тем же эмодзи снимает реакцию (toggle).
    Доступно любому в той же организации (как и заметки).
    """
    from datetime import timezone as _tz
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org and current_user.role != UserRole.superadmin:
        raise HTTPException(403, "No organization access")

    result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")
    _note_org_check(entity, current_user, org)

    key = (data.entry_key or "").strip()
    emoji = (data.emoji or "").strip()
    if not key or not emoji:
        raise HTTPException(400, "entry_key and emoji are required")
    if len(emoji) > 16:
        raise HTTPException(400, "emoji too long")

    extra = dict(entity.extra_data or {})
    reactions = dict(extra.get("timeline_reactions") or {})
    entry = list(reactions.get(key) or [])
    # toggle: снять, если я уже ставил ЭТОТ эмодзи; иначе добавить
    idx = next(
        (
            i for i, r in enumerate(entry)
            if isinstance(r, dict)
            and r.get("user_id") == current_user.id
            and r.get("emoji") == emoji
        ),
        -1,
    )
    if idx >= 0:
        entry.pop(idx)
    else:
        entry.append({
            "emoji": emoji,
            "user_id": current_user.id,
            "user_name": current_user.name,
            "date": datetime.now(_tz.utc).isoformat(),
        })
    if entry:
        reactions[key] = entry
    else:
        reactions.pop(key, None)
    extra["timeline_reactions"] = reactions
    entity.extra_data = extra
    await db.commit()
    return {"success": True, "entry_key": key, "reactions": entry}


def _find_note_index(notes: list, note_id: str) -> int:
    """Ищем по id; для legacy-комментов без id допускаем поиск по date."""
    for i, n in enumerate(notes):
        if isinstance(n, dict):
            if n.get("id") == note_id:
                return i
            # legacy fallback: id-формат "date:<iso>" (фронт может прислать)
            if note_id.startswith("date:") and n.get("date") == note_id[5:]:
                return i
    return -1


@router.patch("/{entity_id}/notes/{note_id}")
async def update_entity_note(
    entity_id: int,
    note_id: str,
    data: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Редактировать комментарий — только автор или superadmin."""
    from datetime import timezone as _tz
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)

    result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")
    _note_org_check(entity, current_user, org)

    text_clean = (data.text or "").strip()
    if not text_clean:
        raise HTTPException(400, "Comment text cannot be empty")
    if len(text_clean) > 5000:
        raise HTTPException(400, "Comment too long (max 5000)")

    extra = dict(entity.extra_data or {})
    notes = list(extra.get("notes") or [])
    idx = _find_note_index(notes, note_id)
    if idx < 0:
        raise HTTPException(404, "Comment not found")

    note = dict(notes[idx])
    if not _note_can_modify(note, current_user):
        raise HTTPException(403, "You can only edit your own comments")

    note["text"] = text_clean
    note["edited_at"] = datetime.now(_tz.utc).isoformat()
    notes[idx] = note
    extra["notes"] = notes
    entity.extra_data = extra
    await db.commit()
    await db.refresh(entity)
    return {"success": True, "note": note}


@router.delete("/{entity_id}/notes/{note_id}")
async def delete_entity_note(
    entity_id: int,
    note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Удалить комментарий — только автор или superadmin."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)

    result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")
    _note_org_check(entity, current_user, org)

    extra = dict(entity.extra_data or {})
    notes = list(extra.get("notes") or [])
    idx = _find_note_index(notes, note_id)
    if idx < 0:
        raise HTTPException(404, "Comment not found")

    if not _note_can_modify(notes[idx], current_user):
        raise HTTPException(403, "You can only delete your own comments")

    notes.pop(idx)
    extra["notes"] = notes
    entity.extra_data = extra
    await db.commit()
    return {"success": True, "total_notes": len(notes)}


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
        apps = (await db.execute(
            select(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(
                VacancyApplication.entity_id == entity_id,
                Vacancy.status != VacancyStatus.closed
            )
        )).scalars().all()
        # Только при единственном отклике (см. PUT /entities) — иначе не трогаем.
        if len(apps) == 1 and apps[0].stage != new_stage:
            apps[0].stage = new_stage
            apps[0].last_stage_change_at = datetime.utcnow()
            logger.info(f"Synchronized entity {entity_id} status {data.status} to application {apps[0].id} stage {new_stage}")

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

    # If deleting a prometheus-exported entity, add email to exclusion list
    # so that auto-sync won't re-create this contact and status shows "Обучается"
    extra = dict(entity.extra_data or {})
    if extra.get("prometheus_exported") or extra.get("prometheus_intern_id"):
        entity_email = (entity.email or "").strip().lower()
        if entity_email and org:
            org_settings = dict(org.settings or {})
            exclusions = org_settings.get("prometheus_export_exclusions", [])
            if entity_email not in exclusions:
                exclusions.append(entity_email)
                org_settings["prometheus_export_exclusions"] = exclusions
                org.settings = org_settings

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
        .where(Entity.org_id == org.id, Entity.is_archived.is_not(True))
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

    query = select(Entity.status, func.count(Entity.id)).where(
        Entity.org_id == org.id, Entity.is_archived.is_not(True)
    )
    if type:
        query = query.where(Entity.type == type)
    query = query.group_by(Entity.status)

    result = await db.execute(query)
    stats = {row[0].value: row[1] for row in result.all()}
    return stats


# ============================================================
# Теневая база (архив): список для суперадмина + действия архивации
# ============================================================

@router.get("/archive/list")
async def list_archived_candidates(
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Теневая база: список архивных кандидатов. Только суперадмин."""
    current_user = await db.merge(current_user)
    if current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Архив доступен только суперадмину")

    base = select(Entity).where(
        Entity.is_archived.is_(True),
        Entity.type == EntityType.candidate,
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        base = base.where(or_(
            Entity.name.ilike(like),
            Entity.email.ilike(like),
            Entity.phone.ilike(like),
            Entity.position.ilike(like),
        ))

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar() or 0

    rows = await db.execute(
        base.order_by(Entity.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    items = []
    for e in rows.scalars().all():
        extra = e.extra_data or {}
        items.append({
            "id": e.id,
            "name": e.name,
            "email": e.email,
            "phone": e.phone,
            "position": e.position,
            "company": e.company,
            "status": e.status.value if e.status else None,
            "tags": e.tags or [],
            "photo_url": extra.get("photo_url"),
            "source": extra.get("source"),
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.post("/{entity_id}/archive")
async def archive_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """«В архив»: убрать кандидата в теневую базу (скрыть из активных списков).
    Доступно тому, кто имеет доступ к карточке."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org and current_user.role != UserRole.superadmin:
        raise HTTPException(403, "No organization access")

    result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    has_access = await check_entity_access(entity, current_user, entity.org_id, db, required_level=None)
    if not has_access:
        raise HTTPException(403, "No access to this candidate")

    entity.is_archived = True
    await db.commit()
    # Кандидат исчезает из активных списков — уведомляем клиентов
    await broadcast_entity_deleted(entity.org_id, entity.id)
    return {"success": True, "is_archived": True}


@router.post("/{entity_id}/unarchive")
async def unarchive_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Вернуть кандидата из архива в активную базу. Только суперадмин."""
    current_user = await db.merge(current_user)
    if current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Только суперадмин может возвращать из архива")

    result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    entity.is_archived = False
    await db.commit()
    await broadcast_entity_updated(entity.org_id, entity.id)
    return {"success": True, "is_archived": False}


@router.post("/archive/rescan")
async def rescan_active_duplicates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Разовый прогон детекта по ВСЕМ активным кандидатам против всех остальных
    (активные + архив). Детект-на-создании покрывает только новых; этот прогон
    помечает уже существующих. Проставляет extra_data.hidden_duplicate_id обоим
    профилям пары — на карточках появится баннер «Проверить». Только суперадмин.
    """
    current_user = await db.merge(current_user)
    if current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Только для суперадмина")
    org = await get_user_org(current_user, db)

    from ...services.similarity import (
        normalize_email, normalize_phone, normalize_telegram,
        is_matchable_telegram, looks_like_person_name, normalize_source_url,
    )

    # 1) ВСЕ кандидаты org (активные + архив) — грузим заранее, чтобы посчитать
    # частоту telegram-значений и отсеять мусорные ярлыки источника
    # («telegram», «hh_b2b», «hh_news_hr»), из-за которых десятки РАЗНЫХ людей
    # матчатся друг с другом в один ложный кластер.
    all_q = select(
        Entity.id, Entity.name, Entity.email, Entity.phone,
        Entity.telegram_usernames, Entity.extra_data,
    ).where(Entity.type == EntityType.candidate)
    if org is not None:
        all_q = all_q.where(Entity.org_id == org.id)
    all_rows = (await db.execute(all_q)).all()

    tg_freq: dict = {}
    for _cid, _cn, _ce, _cp, ctg, _cx in all_rows:
        for t in (ctg or []):
            k = normalize_telegram(t)
            if k:
                tg_freq[k] = tg_freq.get(k, 0) + 1

    def _keys(name, email, phone, tg, extra):
        ks = []
        # ФИО как ключ — только если это похоже на имя человека, а не на должность
        # («Flutter Developer, Минск, 25 лет») и не placeholder.
        if looks_like_person_name(name):
            ks.append("n:" + " ".join((name or "").strip().lower().split()))
        ne = normalize_email(email or "")
        if ne:
            ks.append("e:" + ne)
        d = normalize_phone(phone or "")
        if len(d) >= 10:
            ks.append("p:" + d[-10:])
        for t in (tg or []):
            if is_matchable_telegram(t, tg_freq):
                ks.append("t:" + normalize_telegram(t))
        # source_url резюме (hh) — стабильный ключ: ловит один и тот же профиль,
        # добавленный дважды, когда контакты скрыты и имя — заглушка-должность.
        ex = extra if isinstance(extra, dict) else {}
        sk = normalize_source_url(ex.get("source_url") or ex.get("source_key") or "")
        if sk:
            ks.append("s:" + sk)
        return ks

    key_ids: dict = {}
    names: dict = {}
    for cid, cname, cemail, cphone, ctg, cx in all_rows:
        names[cid] = cname
        for k in _keys(cname, cemail, cphone, ctg, cx):
            key_ids.setdefault(k, []).append(cid)
    # key_ids может оказаться пустым — это нормально: ниже всё равно снимем
    # устаревшие авто-флаги (reconcile), поэтому раннего выхода нет.

    # 2) Активные кандидаты — каждому ищем дубль (активный или архивный), кроме self
    act_q = select(Entity).where(
        Entity.is_archived.is_not(True), Entity.type == EntityType.candidate
    )
    if org is not None:
        act_q = act_q.where(Entity.org_id == org.id)
    actives = (await db.execute(act_q)).scalars().all()

    matches = []
    scanned = 0
    changed = 0
    cleared = 0
    for e in actives:
        scanned += 1
        extra = e.extra_data if isinstance(e.extra_data, dict) else {}
        dismissed = set()
        for x in (extra.get("dismissed_duplicate_ids") or []):
            try:
                dismissed.add(int(x))
            except (TypeError, ValueError):
                pass

        dup_id = None
        for k in _keys(e.name, e.email, e.phone, e.telegram_usernames, e.extra_data):
            for cand in key_ids.get(k, []):
                if cand != e.id and cand not in dismissed:
                    dup_id = cand
                    break
            if dup_id is not None:
                break

        cur = extra.get("hidden_duplicate_id")
        if dup_id is not None:
            matches.append({
                "id": e.id,
                "name": e.name,
                "duplicate_id": dup_id,
                "duplicate_name": names.get(dup_id),
            })
            if cur != dup_id:
                new_extra = dict(extra)
                new_extra["hidden_duplicate_id"] = dup_id
                e.extra_data = new_extra
                changed += 1
        elif cur is not None:
            # Реального дубля больше нет (напр. ушло ложное совпадение по мусорному
            # telegram) — снимаем устаревший авто-флаг, чтобы баннер исчез.
            new_extra = dict(extra)
            new_extra.pop("hidden_duplicate_id", None)
            e.extra_data = new_extra
            cleared += 1

    if changed or cleared:
        await db.commit()
    return {
        "scanned": scanned,
        "flagged": len(matches),
        "newly_flagged": changed,
        "cleared": cleared,
        "matches": matches,
    }


@router.post("/archive/find-duplicates")
async def find_archive_duplicates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Найти дубликаты ВНУТРИ архива: группы архивных кандидатов, совпадающих
    по email / телефону (10 цифр) / telegram. Возвращает группы из ≥2 профилей.
    Только суперадмин."""
    current_user = await db.merge(current_user)
    if current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Только для суперадмина")
    org = await get_user_org(current_user, db)

    from ...services.similarity import (
        normalize_email, normalize_phone, normalize_telegram, is_matchable_telegram,
        normalize_source_url,
    )

    q = select(
        Entity.id, Entity.name, Entity.email, Entity.phone,
        Entity.telegram_usernames, Entity.position, Entity.extra_data,
    ).where(Entity.is_archived.is_(True), Entity.type == EntityType.candidate)
    if org is not None:
        q = q.where(Entity.org_id == org.id)
    rows = (await db.execute(q)).all()

    # Частота telegram-значений: мусорные ярлыки источника («telegram», «hh_b2b»)
    # и прочие «общие» хэндлы НЕ матчим — иначе разные люди слипаются в одну группу.
    tg_freq: dict = {}
    for _r in rows:
        for t in (_r[4] or []):
            k = normalize_telegram(t)
            if k:
                tg_freq[k] = tg_freq.get(k, 0) + 1

    # Union-find: связываем профили, делящие хотя бы один идентификатор
    parent: dict = {}

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    info: dict = {}
    key_to_id: dict = {}
    for rid, name, email, phone, tg, position, extra in rows:
        parent.setdefault(rid, rid)
        info[rid] = {
            "id": rid, "name": name, "email": email, "phone": phone,
            "telegram": (tg[0] if tg else None), "position": position,
        }
        keys = []
        ne = normalize_email(email or "")
        if ne:
            keys.append("e:" + ne)
        d = normalize_phone(phone or "")
        if len(d) >= 10:
            keys.append("p:" + d[-10:])
        for t in (tg or []):
            if is_matchable_telegram(t, tg_freq):
                keys.append("t:" + normalize_telegram(t))
        # source_url резюме (hh) — стабильный ключ (без волатильных query hh)
        ex = extra if isinstance(extra, dict) else {}
        sk = normalize_source_url(ex.get("source_url") or ex.get("source_key") or "")
        if sk:
            keys.append("s:" + sk)
        for k in keys:
            if k in key_to_id:
                union(key_to_id[k], rid)
            else:
                key_to_id[k] = rid

    groups_map: dict = {}
    for rid in info:
        groups_map.setdefault(find(rid), []).append(info[rid])
    groups = [m for m in groups_map.values() if len(m) >= 2]
    groups.sort(key=lambda m: -len(m))

    # Помечаем участников групп флагом hidden_duplicate_id → при открытии карточки
    # архивного появится баннер сравнения (как у активных). Каждый указывает на
    # «соседа» по группе (первый — на второго, остальные — на первого).
    member_ids = [m["id"] for g in groups for m in g]
    if member_ids:
        ents = (await db.execute(
            select(Entity).where(Entity.id.in_(member_ids))
        )).scalars().all()
        by_id = {e.id: e for e in ents}
        changed = False
        for g in groups:
            ids = [m["id"] for m in g]
            for idx, mid in enumerate(ids):
                sibling = ids[1] if idx == 0 else ids[0]
                ent = by_id.get(mid)
                if ent is None:
                    continue
                extra = ent.extra_data if isinstance(ent.extra_data, dict) else {}
                dismissed = set()
                for x in (extra.get("dismissed_duplicate_ids") or []):
                    try:
                        dismissed.add(int(x))
                    except (TypeError, ValueError):
                        pass
                if sibling in dismissed or extra.get("hidden_duplicate_id") == sibling:
                    continue
                ne = dict(extra)
                ne["hidden_duplicate_id"] = sibling
                ent.extra_data = ne
                changed = True
        if changed:
            await db.commit()

    return {
        "groups": groups,
        "total_groups": len(groups),
        "total_dupes": sum(len(g) for g in groups),
    }


class _MergeArchivedRequest(BaseModel):
    source_id: int


@router.post("/{entity_id}/merge-archived")
async def merge_archived_duplicate(
    entity_id: int,
    body: _MergeArchivedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Объединить два АРХИВНЫХ профиля: source_id вливается в survivor (entity_id),
    survivor остаётся в архиве. Только суперадмин."""
    current_user = await db.merge(current_user)
    if current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Только для суперадмина")

    survivor = (await db.execute(select(Entity).where(Entity.id == entity_id))).scalar_one_or_none()
    source = (await db.execute(select(Entity).where(Entity.id == body.source_id))).scalar_one_or_none()
    if not survivor or not survivor.is_archived:
        raise HTTPException(404, "Кандидат-приёмник не в архиве")
    if not source or not source.is_archived:
        raise HTTPException(404, "Кандидат-источник не в архиве")
    if survivor.id == source.id:
        raise HTTPException(400, "Нельзя объединить профиль сам с собой")

    from ...services.similarity import similarity_service
    await similarity_service.merge_entities(db=db, source_entity=source, target_entity=survivor)
    return {"success": True, "survivor_id": survivor.id}


@router.post("/{entity_id}/detect-duplicate")
async def detect_duplicate_now(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Живой поиск дубля для кандидата (вызывается при ОТКРЫТИИ карточки) —
    ловит уже существующих дублей без ручного прогона. Помечает обе стороны
    (detect ставит обратную ссылку), возвращает id найденного дубля или null."""
    current_user = await db.merge(current_user)
    result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")
    has_access = await check_entity_access(entity, current_user, entity.org_id, db, required_level=None)
    if not has_access:
        raise HTTPException(403, "No access to this candidate")

    from ...services.similarity import detect_archived_duplicate
    dup_id = await detect_archived_duplicate(db, entity)
    if dup_id:
        extra = dict(entity.extra_data) if isinstance(entity.extra_data, dict) else {}
        if extra.get("hidden_duplicate_id") != dup_id:
            extra["hidden_duplicate_id"] = dup_id
            entity.extra_data = extra
        await db.commit()
    return {"duplicate_id": dup_id}
