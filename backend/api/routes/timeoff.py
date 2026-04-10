"""Time-off / vacation request endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..models.database import TimeOffRequest, User, OrgMember
from ..database import get_db
from ..services.auth import get_current_user

router = APIRouter()


class TimeOffOut(BaseModel):
    id: int
    user_id: int
    user_name: str | None = None
    type: str
    status: str
    date_from: datetime
    date_to: datetime
    reason: str | None = None
    reviewed_by: int | None = None
    reviewer_name: str | None = None
    reviewed_at: datetime | None = None
    reject_reason: str | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class TimeOffCreate(BaseModel):
    type: str = "vacation"
    date_from: datetime
    date_to: datetime
    reason: str | None = None


@router.get("")
async def list_timeoff(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List time-off requests for the org."""
    org_result = await db.execute(
        select(OrgMember.org_id).where(OrgMember.user_id == current_user.id).limit(1)
    )
    org_id = org_result.scalar_one_or_none()
    if not org_id:
        raise HTTPException(404, "No organization")

    query = select(TimeOffRequest).where(TimeOffRequest.org_id == org_id).order_by(TimeOffRequest.created_at.desc())
    if status:
        query = query.where(TimeOffRequest.status == status)

    result = await db.execute(query)
    requests = result.scalars().all()

    # Enrich with user names
    user_ids = set()
    for r in requests:
        user_ids.add(r.user_id)
        if r.reviewed_by:
            user_ids.add(r.reviewed_by)

    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u.name for u in users_result.scalars().all()}

    return [
        TimeOffOut(
            id=r.id,
            user_id=r.user_id,
            user_name=users_map.get(r.user_id),
            type=r.type if isinstance(r.type, str) else r.type.value,
            status=r.status if isinstance(r.status, str) else r.status.value,
            date_from=r.date_from,
            date_to=r.date_to,
            reason=r.reason,
            reviewed_by=r.reviewed_by,
            reviewer_name=users_map.get(r.reviewed_by) if r.reviewed_by else None,
            reviewed_at=r.reviewed_at,
            reject_reason=r.reject_reason,
            created_at=r.created_at,
        )
        for r in requests
    ]


@router.get("/calendar")
async def timeoff_calendar(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return approved/pending timeoffs for calendar view."""
    org_result = await db.execute(
        select(OrgMember.org_id).where(OrgMember.user_id == current_user.id).limit(1)
    )
    org_id = org_result.scalar_one_or_none()
    if not org_id:
        raise HTTPException(404, "No organization")

    query = (
        select(TimeOffRequest)
        .where(TimeOffRequest.org_id == org_id)
        .where(TimeOffRequest.status.in_(["pending", "approved"]))
        .order_by(TimeOffRequest.date_from)
    )
    result = await db.execute(query)
    requests = result.scalars().all()

    user_ids = {r.user_id for r in requests}
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u.name for u in users_result.scalars().all()}

    return [
        {
            "id": r.id,
            "user_name": users_map.get(r.user_id, "?"),
            "date_from": r.date_from.isoformat(),
            "date_to": r.date_to.isoformat(),
            "type": r.type if isinstance(r.type, str) else r.type.value,
            "status": r.status if isinstance(r.status, str) else r.status.value,
        }
        for r in requests
    ]


@router.post("/{request_id}/approve")
async def approve_timeoff(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve a time-off request."""
    req = await db.get(TimeOffRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")

    req.status = "approved"
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.utcnow()
    await db.commit()

    # Send Telegram notification
    try:
        from ..bot import send_telegram_notification
        await send_telegram_notification(
            req.user_id,
            f"\u2705 <b>\u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u0430!</b>\n\n"
            f"\U0001f4c5 {req.date_from.strftime('%d.%m')} \u2014 {req.date_to.strftime('%d.%m')}\n"
            f"\u041e\u0434\u043e\u0431\u0440\u0438\u043b: {current_user.name}",
        )
    except Exception:
        pass  # Don't fail the API call if notification fails

    return {"status": "approved"}


@router.post("/{request_id}/reject")
async def reject_timeoff(
    request_id: int,
    reason: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject a time-off request."""
    req = await db.get(TimeOffRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")

    req.status = "rejected"
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.utcnow()
    req.reject_reason = reason
    await db.commit()

    # Send Telegram notification
    try:
        from ..bot import send_telegram_notification
        reason_text = f"\n\u041f\u0440\u0438\u0447\u0438\u043d\u0430: {reason}" if reason else ""
        await send_telegram_notification(
            req.user_id,
            f"\u274c <b>\u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430</b>\n\n"
            f"\U0001f4c5 {req.date_from.strftime('%d.%m')} \u2014 {req.date_to.strftime('%d.%m')}\n"
            f"\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u043b: {current_user.name}{reason_text}",
        )
    except Exception:
        pass

    return {"status": "rejected"}
