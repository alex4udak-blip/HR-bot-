from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct, and_

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message, AnalysisHistory
from ..models.schemas import StatsResponse
from ..services.auth import get_current_user

router = APIRouter()


@router.get("", response_model=StatsResponse)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Base query filter for non-superadmins
    is_superadmin = user.role == UserRole.SUPERADMIN

    # Total chats
    chats_query = select(func.count(Chat.id))
    if not is_superadmin:
        chats_query = chats_query.where(Chat.owner_id == user.id)
    total_chats = (await db.execute(chats_query)).scalar() or 0

    # Active chats (with messages in last 7 days)
    week_ago = datetime.utcnow() - timedelta(days=7)
    if is_superadmin:
        active_chats_query = select(func.count(distinct(Message.chat_db_id))).where(
            Message.created_at >= week_ago
        )
    else:
        active_chats_query = (
            select(func.count(distinct(Message.chat_db_id)))
            .select_from(Message)
            .join(Chat, Chat.id == Message.chat_db_id)
            .where(and_(Message.created_at >= week_ago, Chat.owner_id == user.id))
        )
    active_chats = (await db.execute(active_chats_query)).scalar() or 0

    # Total messages
    if is_superadmin:
        total_messages = (await db.execute(select(func.count(Message.id)))).scalar() or 0
    else:
        total_messages = (await db.execute(
            select(func.count(Message.id))
            .select_from(Message)
            .join(Chat, Chat.id == Message.chat_db_id)
            .where(Chat.owner_id == user.id)
        )).scalar() or 0

    # Messages today
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if is_superadmin:
        messages_today_query = select(func.count(Message.id)).where(Message.created_at >= today)
    else:
        messages_today_query = (
            select(func.count(Message.id))
            .select_from(Message)
            .join(Chat, Chat.id == Message.chat_db_id)
            .where(and_(Message.created_at >= today, Chat.owner_id == user.id))
        )
    messages_today = (await db.execute(messages_today_query)).scalar() or 0

    # Messages this week
    if is_superadmin:
        messages_week_query = select(func.count(Message.id)).where(Message.created_at >= week_ago)
    else:
        messages_week_query = (
            select(func.count(Message.id))
            .select_from(Message)
            .join(Chat, Chat.id == Message.chat_db_id)
            .where(and_(Message.created_at >= week_ago, Chat.owner_id == user.id))
        )
    messages_this_week = (await db.execute(messages_week_query)).scalar() or 0

    # Total unique users (participants in chats)
    if is_superadmin:
        total_users = (await db.execute(
            select(func.count(distinct(Message.user_id)))
        )).scalar() or 0
    else:
        total_users = (await db.execute(
            select(func.count(distinct(Message.user_id)))
            .select_from(Message)
            .join(Chat, Chat.id == Message.chat_db_id)
            .where(Chat.owner_id == user.id)
        )).scalar() or 0

    # Total analyses
    if is_superadmin:
        total_analyses = (await db.execute(
            select(func.count(AnalysisHistory.id))
        )).scalar() or 0
    else:
        total_analyses = (await db.execute(
            select(func.count(AnalysisHistory.id)).where(AnalysisHistory.user_id == user.id)
        )).scalar() or 0

    # Chats by day (last 7 days)
    chats_by_day = []
    for i in range(7):
        day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6-i)
        next_day = day + timedelta(days=1)

        if is_superadmin:
            count_query = select(func.count(Message.id)).where(
                and_(Message.created_at >= day, Message.created_at < next_day)
            )
        else:
            count_query = (
                select(func.count(Message.id))
                .select_from(Message)
                .join(Chat, Chat.id == Message.chat_db_id)
                .where(and_(
                    Message.created_at >= day,
                    Message.created_at < next_day,
                    Chat.owner_id == user.id
                ))
            )

        count = (await db.execute(count_query)).scalar() or 0
        chats_by_day.append({
            "date": day.strftime("%Y-%m-%d"),
            "day": day.strftime("%a"),
            "count": count,
        })

    # Messages by type
    if is_superadmin:
        type_query = select(
            Message.message_type,
            func.count(Message.id).label("count")
        ).group_by(Message.message_type)
    else:
        type_query = (
            select(
                Message.message_type,
                func.count(Message.id).label("count")
            )
            .select_from(Message)
            .join(Chat, Chat.id == Message.chat_db_id)
            .where(Chat.owner_id == user.id)
            .group_by(Message.message_type)
        )

    type_result = await db.execute(type_query)
    messages_by_type = {row.message_type: row.count for row in type_result.all()}

    return StatsResponse(
        total_chats=total_chats,
        total_messages=total_messages,
        total_users=total_users,
        total_analyses=total_analyses,
        active_chats=active_chats,
        messages_today=messages_today,
        messages_this_week=messages_this_week,
        chats_by_day=chats_by_day,
        messages_by_type=messages_by_type,
    )
