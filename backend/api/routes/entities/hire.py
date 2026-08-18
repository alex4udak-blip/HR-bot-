"""«Взять в штат»: перевод кандидата (Entity) в сотрудника Factorial (Employee).

Кандидат — Entity без аккаунта; Employee требует user_id. Эндпоинт провизионит
User (переиспользует по email или создаёт заготовку), гарантирует OrgMember,
создаёт Employee(entity_id=кандидат) и переводит карточку кандидата в статус
transferred («Перешёл в отдел»).

Пароль здесь НЕ выдаётся (решение с Марией, 2026-07-27): сотрудник начнёт
пользоваться Factorial только после испытательного срока (~3 мес), а гонять
временный пароль в момент оформления бессмысленно — он всё равно устареет. Новый
User заводится с недоступным случайным паролем-заглушкой; реальный временный
пароль генерируется ПОЗЖЕ, в Factorial, кнопкой на карточке сотрудника
(POST /factorial/employees/{id}/reset-password), когда доступ действительно нужен.
"""
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models.database import (
    Entity, EntityStatus, Employee, User, UserRole, OrgMember, OrgRole,
)
from ...services.auth import get_current_user, get_user_org, hash_password

router = APIRouter()

HIREABLE_STATUSES = {EntityStatus.hired, EntityStatus.probation}


class HireRequest(BaseModel):
    department_id: Optional[int] = None
    email: str
    position: Optional[str] = None
    department_start_date: Optional[datetime] = None


class HireResponse(BaseModel):
    employee_id: int
    user_existed: bool


def _first_tg(ent: Entity) -> Optional[str]:
    tg = ent.telegram_usernames
    if isinstance(tg, list) and tg:
        return str(tg[0])
    if isinstance(tg, str) and tg.strip():
        return tg.strip()
    return None


@router.post("/{entity_id}/hire", response_model=HireResponse)
async def hire_entity(
    entity_id: int,
    data: HireRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Оформить кандидата в штат: создать/переиспользовать аккаунт + Employee, перевести в transferred."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="Нет организации")
    # Оформлять в штат могут ВСЕ участники орга — и админы, и рекрутёры (hr/member).
    # Достаточно членства в организации (get_user_org уже это гарантирует).

    ent = (await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(status_code=404, detail="Кандидат не найден")
    if ent.status not in HIREABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Кандидат не на стадии «Оффер принят» или «Практика»")

    email = (data.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Нужен email для аккаунта")

    tg = _first_tg(ent)

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    user_existed = user is not None
    if not user:
        # Пароль-заглушка: длинный случайный, НИКОМУ не показывается и нигде не
        # сохраняется. Войти по нему нельзя — доступ выдаётся позже через
        # reset-password в Factorial. Так аккаунт существует (Employee.user_id
        # обязателен), но «мёртвый» логин не висит рабочим паролем.
        user = User(
            name=ent.name, email=email, password_hash=hash_password(secrets.token_urlsafe(32)),
            role=UserRole.member, is_active=True, telegram_username=tg,
        )
        db.add(user)
        await db.flush()

    om = (await db.execute(
        select(OrgMember).where(OrgMember.org_id == org.id, OrgMember.user_id == user.id)
    )).scalar_one_or_none()
    if not om:
        db.add(OrgMember(org_id=org.id, user_id=user.id, role=OrgRole.member))

    existing_emp = (await db.execute(
        select(Employee).where(Employee.user_id == user.id)
    )).scalar_one_or_none()
    if existing_emp and existing_emp.is_active:
        # Активный сотрудник с этим email уже есть. Если он привязан к ДРУГОМУ
        # кандидату — HR ошибся с почтой (дубль): называем, к кому она относится.
        if existing_emp.entity_id and existing_emp.entity_id != ent.id:
            other_name = (await db.execute(
                select(Entity.name).where(Entity.id == existing_emp.entity_id)
            )).scalar_one_or_none()
            raise HTTPException(
                status_code=409,
                detail=f"Email {email} уже занят другим сотрудником ({other_name or 'другой кандидат'}). Проверьте почту.",
            )
        raise HTTPException(status_code=409, detail="Этот человек уже оформлен в штат")

    from ..employees import _auto_calculate_dates
    if existing_emp:
        # Был уволен (soft-delete: is_active=False, dismissed_at). Переоформляем ту
        # же запись — реактивация, а не 409 и не дубль-сотрудник.
        emp = existing_emp
        emp.is_active = True
        emp.dismissed_at = None
        emp.dismissal_reason = None
        emp.entity_id = ent.id
        emp.department_id = data.department_id
        emp.position = data.position or ent.position
        emp.phone = ent.phone
        emp.telegram_username = tg
        emp.department_start_date = data.department_start_date or datetime.utcnow()
        _auto_calculate_dates(emp)
    else:
        emp = Employee(
            user_id=user.id, org_id=org.id, entity_id=ent.id,
            department_id=data.department_id, position=data.position or ent.position,
            phone=ent.phone, telegram_username=tg,
            department_start_date=data.department_start_date or datetime.utcnow(),
        )
        _auto_calculate_dates(emp)
        db.add(emp)

    # Отражаем оформление в САМОЙ карточке кандидата, а не только в записи
    # сотрудника: доска «Статусы» и карточка читают Entity, поэтому без этого
    # «Отдел» и «Должность» после найма оставались пустыми, хотя HR их указал.
    ent.status = EntityStatus.transferred
    if data.department_id:
        ent.department_id = data.department_id
    if data.position:
        ent.position = data.position
    await db.commit()
    await db.refresh(emp)

    return HireResponse(employee_id=emp.id, user_existed=user_existed)


class StaffStatusResponse(BaseModel):
    employee_id: Optional[int] = None
    is_active: Optional[bool] = None  # None — не оформлен; True — в штате; False — уволен


@router.get("/{entity_id}/staff-status", response_model=StaffStatusResponse)
async def entity_staff_status(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Статус оформления кандидата в штат — для бейджа на карточке: есть ли
    связанный Employee и активен ли он («В штате» vs «Уволен»)."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        return StaffStatusResponse()
    emp = (await db.execute(
        select(Employee)
        .where(Employee.entity_id == entity_id, Employee.org_id == org.id)
        .order_by(Employee.id.desc())
    )).scalars().first()
    if not emp:
        return StaffStatusResponse()
    return StaffStatusResponse(employee_id=emp.id, is_active=emp.is_active)
