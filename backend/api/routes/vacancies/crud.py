"""
Basic CRUD operations for vacancies.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, or_, text, cast, String
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime

from .common import (
    logger, get_db, Vacancy, VacancyStatus, VacancyApplication,
    User, Department, DepartmentMember, DeptRole, OrgMember, OrgRole,
    VacancyCreate, VacancyUpdate, VacancyResponse,
    check_vacancy_access, has_full_database_access, can_access_vacancy,
    can_edit_vacancy, get_shared_vacancy_ids
)
from ...services.auth import get_current_user, get_user_org
from ...services.cache import scoring_cache
from ...services.hr_notifications import notify_new_request, notify_request_assigned


class AssignRequest(BaseModel):
    user_ids: List[int] = []
    all: bool = False

router = APIRouter()


@router.get("", response_model=List[VacancyResponse])
async def list_vacancies(
    status: Optional[VacancyStatus] = None,
    deleted: bool = False,
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

    # Мягкое удаление: по умолчанию удалённые скрыты; фильтр «Удалённые» — только они.
    if deleted:
        query = query.where(Vacancy.deleted_at.isnot(None))
    else:
        query = query.where(Vacancy.deleted_at.is_(None))

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
        # 5. Vacancies assigned to them (assigned_to JSON contains user_id)
        # 6. Vacancies open for all HR (assigned_to_all == True)
        access_conditions = []

        # Always add created_by and hiring_manager conditions
        access_conditions.append(Vacancy.created_by == current_user.id)
        access_conditions.append(Vacancy.hiring_manager_id == current_user.id)

        if lead_dept_ids:
            access_conditions.append(Vacancy.department_id.in_(lead_dept_ids))
        if shared_vacancy_ids:
            access_conditions.append(Vacancy.id.in_(shared_vacancy_ids))

        # Vacancies marked as visible to all org members
        access_conditions.append(Vacancy.visible_to_all == True)

        # Vacancies assigned to this user (JSON containment via PostgreSQL)
        access_conditions.append(
            text(f"vacancies.assigned_to::jsonb @> '[{int(current_user.id)}]'::jsonb")
        )
        # Vacancies open for all HR recruiters
        access_conditions.append(Vacancy.assigned_to_all == True)

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
    stage_value = cast(VacancyApplication.stage, String)
    stage_counts_result = await db.execute(
        select(
            VacancyApplication.vacancy_id,
            stage_value.label("stage"),
            func.count(VacancyApplication.id)
        )
        .where(VacancyApplication.vacancy_id.in_(vacancy_ids))
        .group_by(VacancyApplication.vacancy_id, stage_value)
    )
    # Build nested dict: {vacancy_id: {stage: count}}
    all_stage_counts = {}
    for row in stage_counts_result.all():
        vac_id, stage, count = row
        if vac_id not in all_stage_counts:
            all_stage_counts[vac_id] = {}
        all_stage_counts[vac_id][str(stage)] = count

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
            visible_to_all=vacancy.visible_to_all or False,
            assigned_to=vacancy.assigned_to or [],
            assigned_to_all=bool(getattr(vacancy, 'assigned_to_all', False)),
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
            stage_counts=stage_counts,
            custom_stages=getattr(vacancy, 'custom_stages', None),
            kanban_card_fields=getattr(vacancy, 'kanban_card_fields', None)
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

    # Создавать заявки/вакансии может только HR-админ (owner/admin/superadmin).
    # Рекрутёр (member) не создаёт — он берёт назначенные ему заявки в работу.
    if not await has_full_database_access(current_user, org, db):
        raise HTTPException(status_code=403, detail="Создавать заявки может только HR-администратор")

    # Build vacancy kwargs — custom_stages/kanban_card_fields are optional (migration may not be applied yet)
    vacancy_kwargs = dict(
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
        visible_to_all=data.visible_to_all,
        department_id=data.department_id,
        hiring_manager_id=data.hiring_manager_id,
        closes_at=data.closes_at,
        created_by=current_user.id,
        published_at=datetime.utcnow() if data.status == VacancyStatus.open else None,
    )
    # custom_stages/kanban_card_fields приходят Pydantic-моделями (CustomStagesSchema),
    # а колонки — JSON. Кладём dict, иначе json.dumps падает на commit -> 500
    # («Object of type CustomStagesSchema is not JSON serializable»).
    if hasattr(Vacancy, 'custom_stages'):
        cs = data.custom_stages
        vacancy_kwargs['custom_stages'] = cs.model_dump() if hasattr(cs, 'model_dump') else cs
    if hasattr(Vacancy, 'kanban_card_fields'):
        kcf = data.kanban_card_fields
        vacancy_kwargs['kanban_card_fields'] = kcf.model_dump() if hasattr(kcf, 'model_dump') else kcf
    vacancy = Vacancy(**vacancy_kwargs)

    db.add(vacancy)
    await db.commit()
    await db.refresh(vacancy)

    logger.info(f"Created vacancy {vacancy.id}: {vacancy.title}")

    # Новая заявка → уведомить HR-админов/owner'ов (кроме создателя). Они
    # распределяют заявки между рекрутёрами. Fire-and-forget (свой commit/rollback).
    await notify_new_request(db, vacancy, current_user)

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
        visible_to_all=vacancy.visible_to_all or False,
        assigned_to=vacancy.assigned_to or [],
        assigned_to_all=bool(getattr(vacancy, 'assigned_to_all', False)),
        department_id=vacancy.department_id,
        hiring_manager_id=vacancy.hiring_manager_id,
        created_by=vacancy.created_by,
        created_by_name=current_user.name,  # Creator is current user
        published_at=vacancy.published_at,
        closes_at=vacancy.closes_at,
        created_at=vacancy.created_at,
        updated_at=vacancy.updated_at,
        applications_count=0,
        stage_counts={},
        custom_stages=vacancy.custom_stages,
        kanban_card_fields=vacancy.kanban_card_fields
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
        visible_to_all=vacancy.visible_to_all or False,
        assigned_to=vacancy.assigned_to or [],
        assigned_to_all=bool(getattr(vacancy, 'assigned_to_all', False)),
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
        stage_counts=stage_counts,
        custom_stages=vacancy.custom_stages,
        kanban_card_fields=vacancy.kanban_card_fields
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

    # Когда рекрутёр закрывает/отменяет свой клон заявки, заявка должна исчезнуть
    # у него из "Заявок": убираем его из assigned_to оригинала и помечаем dismissed_by.
    if data.status in (VacancyStatus.closed, VacancyStatus.cancelled):
        cloned_from = (vacancy.extra_data or {}).get("cloned_from_request_id")
        if isinstance(cloned_from, int):
            original = await db.get(Vacancy, cloned_from)
            if original is not None:
                assigned = list(original.assigned_to or [])
                if current_user.id in assigned:
                    original.assigned_to = [u for u in assigned if u != current_user.id]
                # Покрываем кейс assigned_to_all=True: помечаем что этот рекрутёр
                # уже закончил с заявкой, фронт фильтрует по dismissed_by.
                orig_extra = dict(original.extra_data or {})
                dismissed = list(orig_extra.get("dismissed_by") or [])
                if current_user.id not in dismissed:
                    dismissed.append(current_user.id)
                    orig_extra["dismissed_by"] = dismissed
                    original.extra_data = orig_extra

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

    # Если удаляем КЛОН заявки — «закрываем» оригинал у этого рекрутёра (как при
    # закрытии клона), иначе после удаления рабочей вакансии исходная заявка снова
    # всплывает в «Заявки» (она перестаёт считаться «уже взятой»).
    cloned_from = (vacancy.extra_data or {}).get("cloned_from_request_id")
    if isinstance(cloned_from, int):
        original = await db.get(Vacancy, cloned_from)
        if original is not None:
            assigned = list(original.assigned_to or [])
            if current_user.id in assigned:
                original.assigned_to = [u for u in assigned if u != current_user.id]
            orig_extra = dict(original.extra_data or {})
            dismissed = list(orig_extra.get("dismissed_by") or [])
            if current_user.id not in dismissed:
                dismissed.append(current_user.id)
                orig_extra["dismissed_by"] = dismissed
                original.extra_data = orig_extra

    # Мягкое удаление: вакансия исчезает из всех активных списков (deleted_at IS
    # NULL фильтруется), но видна в фильтре «Удалённые». Восстановимо через update.
    vacancy.deleted_at = datetime.utcnow()
    await db.commit()

    logger.info(f"Soft-deleted vacancy {vacancy_id}")


@router.get("/assignable-users")
async def get_assignable_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Вернуть только реальный HR-персонал для дропдауна 'Назначить рекрутерам'.

    Логика:
    1. Ищем HR-отделы — по названию, содержащему 'hr' или 'рекрут' (case-insensitive).
    2. Если HR-отделы есть → возвращаем их членов с org_role IN ('admin','hr').
    3. Если HR-отделов нет в орге → fallback: все org_role IN ('admin','hr').
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="Organization not found")

    # 1. Находим HR-отделы по названию
    hr_depts_result = await db.execute(
        select(Department.id).where(
            Department.org_id == org.id,
            Department.is_active == True,
            or_(
                Department.name.ilike('%hr%'),
                Department.name.ilike('%рекрут%'),
            ),
        )
    )
    hr_dept_ids = [row[0] for row in hr_depts_result.all()]

    # 2. Базовый фильтр — всегда только HR org_role
    base_conds = [
        OrgMember.org_id == org.id,
        User.is_active == True,
        OrgMember.role.in_([OrgRole.admin, OrgRole.hr]),
    ]

    if hr_dept_ids:
        # Только те HR, кто является членом HR-отдела
        result = await db.execute(
            select(User.id, User.name, OrgMember.role)
            .join(OrgMember, OrgMember.user_id == User.id)
            .join(DepartmentMember, DepartmentMember.user_id == User.id)
            .where(
                *base_conds,
                DepartmentMember.department_id.in_(hr_dept_ids),
            )
            .distinct()
            .order_by(User.name)
        )
        logger.info(f"Filtering recruiters by HR departments: {hr_dept_ids}")
    else:
        # HR-отделов нет — fallback на OrgRole
        result = await db.execute(
            select(User.id, User.name, OrgMember.role)
            .join(OrgMember, OrgMember.user_id == User.id)
            .where(*base_conds)
            .order_by(User.name)
        )
        logger.info("No HR departments found — falling back to OrgRole filter")

    users = result.all()
    logger.info(f"Assignable HR block ({len(users)}): {[(r[1], r[2]) for r in users]}")
    return [{"id": row[0], "name": row[1], "role": row[2]} for row in users]


async def take_vacancy(
    vacancy_id: int,
    force: bool = Query(False, description="Создать клон даже если он уже есть (подтверждение дубля)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_vacancy_access),
):
    """Рекрутёр берёт заявку в работу.

    Создаётся НОВАЯ вакансия — клон заявки, где рекрутёр становится
    creator/hiring_manager, статус 'open'. Оригинал заявки не меняется,
    остаётся доступен другим рекрутёрам.

    Доступно тем, кто в assigned_to или при assigned_to_all=True
    (либо у пользователя полный доступ к БД).
    """
    org = await get_user_org(current_user, db)
    # FOR UPDATE на строке-заявке: сериализует одновременные «Взять в работу».
    # Без этого 3 быстрых клика проходили dedup-SELECT до первого COMMIT и
    # создавали 3 клона. С блокировкой второй и третий запрос ждут, а потом
    # видят уже созданный клон и получают 409.
    source_result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id).with_for_update()
    )
    source = source_result.scalar_one_or_none()
    if not source or (org and source.org_id != org.id):
        raise HTTPException(status_code=404, detail="Vacancy not found")

    has_full_access = await has_full_database_access(current_user, org, db)
    if not has_full_access:
        assigned_to_list = source.assigned_to or []
        is_assigned = current_user.id in assigned_to_list
        is_assigned_all = bool(getattr(source, 'assigned_to_all', False))
        # Создатель заявки тоже может взять её в работу — раньше проверка смотрела
        # только assigned_to/assigned_to_all, и рекрутёр не мог взять СВОЮ заявку.
        is_creator = source.created_by == current_user.id
        if not is_assigned and not is_assigned_all and not is_creator:
            raise HTTPException(status_code=403, detail="You are not assigned to this vacancy")

    # Проверка: рекрутёр уже брал эту заявку. Если force=False — не блокируем
    # жёстко, а возвращаем 409 со структурой, чтобы фронт показал диалог
    # «у вас уже есть такая вакансия, создать дубль?». При force=True
    # сознательно создаём дубликат.
    src_id = int(source.id)
    if not force:
        existing = await db.execute(
            select(Vacancy.id).where(
                Vacancy.created_by == current_user.id,
                # Дублем считаем только АКТИВНЫЙ клон. Закрытый/отменённый/удалённый
                # клон рекрутёр уже не видит в списках — иначе guard блокировал
                # повторное взятие заявки, клона которой по факту нет («первой не видно»).
                Vacancy.deleted_at.is_(None),
                Vacancy.status.notin_([VacancyStatus.closed, VacancyStatus.cancelled]),
                text(
                    f"vacancies.extra_data::jsonb @> '{{\"cloned_from_request_id\": {src_id}}}'::jsonb"
                ),
            )
        )
        if existing.scalar():
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "duplicate_clone",
                    "message": f"У вас уже есть вакансия по заявке «{source.title}». Создать дубликат?",
                },
            )

    cloned_extra = dict(source.extra_data or {})
    cloned_extra['cloned_from_request_id'] = source.id

    # Оригинал-заявку НЕ переводим в 'open': иначе она висела бы открытой
    # вакансией рядом со своим клоном (рабочей копией) — отсюда дубли в списках
    # «Мои вакансии»/«Взять на вакансию». Заявка остаётся в исходном статусе и
    # доступна другим назначенным рекрутёрам; рабочей вакансией становится клон.

    clone_kwargs = dict(
        org_id=source.org_id,
        department_id=source.department_id,
        title=source.title,
        description=source.description,
        requirements=source.requirements,
        responsibilities=source.responsibilities,
        salary_min=source.salary_min,
        salary_max=source.salary_max,
        salary_currency=source.salary_currency,
        location=source.location,
        employment_type=source.employment_type,
        experience_level=source.experience_level,
        status=VacancyStatus.open,
        priority=source.priority,
        tags=list(source.tags or []),
        extra_data=cloned_extra,
        visible_to_all=False,
        hiring_manager_id=current_user.id,
        created_by=current_user.id,
        published_at=datetime.utcnow(),
        closes_at=source.closes_at,
        assigned_to=[],
        assigned_to_all=False,
    )
    if hasattr(Vacancy, 'custom_stages'):
        clone_kwargs['custom_stages'] = source.custom_stages
    if hasattr(Vacancy, 'kanban_card_fields'):
        clone_kwargs['kanban_card_fields'] = source.kanban_card_fields

    clone = Vacancy(**clone_kwargs)
    db.add(clone)
    await db.commit()
    await db.refresh(clone)

    logger.info(f"Request {source.id} taken by user {current_user.id} → cloned vacancy {clone.id}")

    return await get_vacancy(clone.id, db=db, current_user=current_user)


async def assign_vacancy(
    vacancy_id: int,
    data: AssignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Назначить рекрутеров на вакансию.

    data.all = True  → assigned_to_all=True, assigned_to=[]
    data.all = False → assigned_to=user_ids, assigned_to_all=False

    Требует прав редактирования вакансии (can_edit_vacancy).
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="Organization not found")

    vacancy = await db.get(Vacancy, vacancy_id)
    if not vacancy or vacancy.org_id != org.id:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    if not await can_edit_vacancy(vacancy, current_user, org, db):
        raise HTTPException(status_code=403, detail="No permission to edit this vacancy")

    # Запоминаем, кто был назначен ДО — чтобы уведомить только вновь назначенных.
    old_assigned = {int(u) for u in (vacancy.assigned_to or [])}
    old_all = bool(getattr(vacancy, "assigned_to_all", False))

    if data.all:
        vacancy.assigned_to_all = True
        vacancy.assigned_to = []
    else:
        # Проверяем что все user_ids — валидные участники орга
        if data.user_ids:
            check = await db.execute(
                select(User.id)
                .join(OrgMember, OrgMember.user_id == User.id)
                .where(OrgMember.org_id == org.id, User.id.in_(data.user_ids))
            )
            valid_ids = {row[0] for row in check.all()}
            invalid = set(data.user_ids) - valid_ids
            if invalid:
                raise HTTPException(status_code=400, detail=f"Users not in org: {sorted(invalid)}")
        vacancy.assigned_to_all = False
        vacancy.assigned_to = list(dict.fromkeys(data.user_ids))  # unique, preserve order

    # НЕ переводим заявку в open при назначении. Назначенная заявка остаётся
    # ЗАЯВКОЙ для конкретного рекрутёра (pending_review + assigned_to) и висит у
    # него в «Заявки». Рабочей воронкой (open) она становится ТОЛЬКО когда сам
    # рекрутёр нажмёт «Взять в работу» (создаётся клон open под ним). Иначе
    # заявка сразу падала в «выполнение» под создателем — «создал и сам же взял».

    await db.commit()
    await db.refresh(vacancy)
    logger.info(f"Vacancy {vacancy_id} assigned: all={vacancy.assigned_to_all}, ids={vacancy.assigned_to}")

    # Уведомляем ТОЛЬКО вновь назначенных рекрутёров (не дёргаем уже назначенных).
    try:
        if data.all:
            # «Всем рекрутёрам»: уведомляем всю команду орга, если раньше не было
            # assigned_to_all (иначе никто реально не «прибавился»).
            if not old_all:
                res = await db.execute(
                    select(OrgMember.user_id).where(OrgMember.org_id == org.id)
                )
                newly = {int(r[0]) for r in res.all()}
            else:
                newly = set()
        else:
            newly = {int(u) for u in (vacancy.assigned_to or [])} - old_assigned
        if newly:
            await notify_request_assigned(db, vacancy, newly, current_user)
    except Exception:
        logger.exception("assign notify failed for vacancy %s", vacancy_id)

    # Возвращаем сериализованную вакансию через тот же механизм, что get_vacancy
    return await get_vacancy(vacancy_id, db=db, current_user=current_user)
