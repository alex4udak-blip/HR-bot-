"""«Взять в штат»: перевод кандидата (Entity) в сотрудника Factorial (Employee).

Кандидат — Entity без аккаунта; Employee требует user_id. Эндпоинт провизионит
User (переиспользует по email или создаёт с одноразовым паролем — как
quick_add_member), гарантирует OrgMember, создаёт Employee(entity_id=кандидат) и
переводит карточку кандидата в статус transferred («Перешёл в отдел»).
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
    temporary_password: Optional[str] = None


async def _is_admin_or_owner(user: User, org, db: AsyncSession) -> bool:
    if user.role == UserRole.superadmin:
        return True
    r = await db.execute(
        select(OrgMember.role).where(OrgMember.org_id == org.id, OrgMember.user_id == user.id)
    )
    return r.scalar_one_or_none() in (OrgRole.owner, OrgRole.admin)


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
    if not await _is_admin_or_owner(current_user, org, db):
        raise HTTPException(status_code=403, detail="Только для HR-админа")

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
    temp_password: Optional[str] = None
    if not user:
        temp_password = secrets.token_urlsafe(8)
        user = User(
            name=ent.name, email=email, password_hash=hash_password(temp_password),
            role=UserRole.member, is_active=True, telegram_username=tg,
        )
        db.add(user)
        await db.flush()

    om = (await db.execute(
        select(OrgMember).where(OrgMember.org_id == org.id, OrgMember.user_id == user.id)
    )).scalar_one_or_none()
    if not om:
        db.add(OrgMember(org_id=org.id, user_id=user.id, role=OrgRole.member))

    if (await db.execute(
        select(Employee).where(Employee.user_id == user.id)
    )).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Этот человек уже оформлен в штат")

    emp = Employee(
        user_id=user.id, org_id=org.id, entity_id=ent.id,
        department_id=data.department_id, position=data.position or ent.position,
        phone=ent.phone, telegram_username=tg,
        department_start_date=data.department_start_date or datetime.utcnow(),
    )
    from ..employees import _auto_calculate_dates
    _auto_calculate_dates(emp)

    db.add(emp)
    ent.status = EntityStatus.transferred
    await db.commit()
    await db.refresh(emp)

    return HireResponse(employee_id=emp.id, user_existed=user_existed, temporary_password=temp_password)
