"""
Корзина кандидатов: список удалённых и возврат (20.10.2026, services/entity_trash.py).

Смотреть и возвращать — админам HR (владелец, админ орга, суперадмин): им же
доступно и удаление чужих карточек. Подключается РАНЬШЕ crud: иначе
GET /entities/{entity_id} перехватил бы /entities/trash.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import (
    logger, get_db, User, UserRole, get_current_user, get_user_org, has_full_database_access,
)
from ...models.database import DeletedEntity

router = APIRouter()

# Сколько показывать в журнале: вернуть можно 7 дней, но кто и когда удалял —
# полезно видеть и дольше.
JOURNAL_DAYS = 90


async def _admin_org(db: AsyncSession, user: User):
    org = await get_user_org(user, db)
    if user.role == UserRole.superadmin:
        return org
    if not org or not await has_full_database_access(user, org.id, db):
        raise HTTPException(403, "Корзина доступна только админам HR")
    return org


def _row(r: DeletedEntity, now: datetime) -> dict:
    from ...services.entity_trash import snapshot_summary
    return {
        "id": r.id,
        "entity_id": r.entity_id,
        "name": r.entity_name,
        "deleted_by_name": r.deleted_by_name,
        "deleted_at": r.deleted_at.isoformat() if r.deleted_at else None,
        "restorable_until": r.purge_after.isoformat() if r.purge_after else None,
        "restorable": bool(r.snapshot) and r.restored_at is None and r.purge_after > now,
        "restored_at": r.restored_at.isoformat() if r.restored_at else None,
        "restored_by_name": r.restored_by_name,
        "purged_at": r.purged_at.isoformat() if r.purged_at else None,
        "summary": snapshot_summary(r.snapshot),
    }


@router.get("/trash")
async def list_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Удалённые кандидаты: кого можно вернуть и журнал «кто, кого, когда»."""
    from ...services.entity_trash import purge_expired

    current_user = await db.merge(current_user)
    org = await _admin_org(db, current_user)
    if await purge_expired(db):
        await db.commit()
    now = datetime.utcnow()
    q = select(DeletedEntity).where(DeletedEntity.deleted_at > now - timedelta(days=JOURNAL_DAYS))
    if org is not None and current_user.role != UserRole.superadmin:
        q = q.where(DeletedEntity.org_id == org.id)
    elif org is not None:
        q = q.where(or_(DeletedEntity.org_id == org.id, DeletedEntity.org_id.is_(None)))
    rows = (await db.execute(q.order_by(DeletedEntity.deleted_at.desc()))).scalars().all()
    return {"items": [_row(r, now) for r in rows]}


@router.post("/trash/{trash_id}/restore")
async def restore_trash(
    trash_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Вернуть кандидата как был: воронки, история, файлы, метки, анкеты."""
    from ...services.entity_trash import RestoreError, restore_from_trash

    current_user = await db.merge(current_user)
    org = await _admin_org(db, current_user)
    record = (await db.execute(
        select(DeletedEntity).where(DeletedEntity.id == trash_id).with_for_update()
    )).scalar_one_or_none()
    if record is None or (
        current_user.role != UserRole.superadmin and org is not None and record.org_id != org.id
    ):
        raise HTTPException(404, "Запись корзины не найдена")
    if record.purge_after <= datetime.utcnow() and not record.restored_at:
        raise HTTPException(410, "Срок хранения в корзине истёк — вернуть уже нельзя")
    try:
        skipped = await restore_from_trash(db, record, current_user)
    except RestoreError as e:
        await db.rollback()
        raise HTTPException(409, str(e))
    await db.commit()
    logger.info(
        "ENTITY_RESTORE: entity=%s «%s» by user=%s (%s), не вернулось: %s",
        record.entity_id, record.entity_name, current_user.id, current_user.name, skipped or "—",
    )
    return {"success": True, "entity_id": record.entity_id, "skipped": skipped}
