"""
HR notification service — creates in-app notifications for candidate pipeline events.

Usage:
    from ..services.hr_notifications import notify_new_candidate, notify_stage_change, ...

All functions are fire-and-forget safe: they catch exceptions internally
so that a notification failure never breaks the main operation.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import (
    Notification,
    VacancyApplication,
    ApplicationStage,
    Entity,
    User,
    Vacancy,
    OrgMember,
    OrgRole,
)

logger = logging.getLogger("hr-analyzer.notifications")

# Human-readable stage names (Russian)
STAGE_LABELS = {
    ApplicationStage.applied: "Новый",
    ApplicationStage.screening: "Скрининг",
    ApplicationStage.phone_screen: "Практика",
    ApplicationStage.interview: "Тех-практика",
    ApplicationStage.assessment: "ИС",
    ApplicationStage.offer: "Оффер",
    ApplicationStage.hired: "Принят",
    ApplicationStage.rejected: "Отказ",
    ApplicationStage.withdrawn: "Отозван",
}


def _stage_label(stage: ApplicationStage) -> str:
    return STAGE_LABELS.get(stage, stage.value)


async def _get_org_admins_and_owners(db: AsyncSession, org_id: int) -> list[int]:
    """Return user IDs of org owners and admins."""
    result = await db.execute(
        select(OrgMember.user_id).where(
            OrgMember.org_id == org_id,
            OrgMember.role.in_([OrgRole.owner, OrgRole.admin]),
        )
    )
    return [row[0] for row in result.all()]


async def _create_notification(
    db: AsyncSession,
    user_id: int,
    type: str,
    title: str,
    message: Optional[str] = None,
    link: Optional[str] = None,
) -> None:
    """Insert a single Notification row."""
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        link=link,
    )
    db.add(notif)


# ---------------------------------------------------------------------------
# 1. New candidate added to a vacancy
# ---------------------------------------------------------------------------

async def notify_new_candidate(
    db: AsyncSession,
    entity: Entity,
    vacancy: Vacancy,
    added_by_user: User,
) -> None:
    """Notify relevant users when a new candidate is added to a vacancy.

    Recipients: vacancy creator + org admins/owners (excluding the actor).
    """
    try:
        link = f"/vacancies/{vacancy.id}"
        title = "Новый кандидат"
        message = (
            f"{entity.name} добавлен(а) в вакансию «{vacancy.title}» "
            f"пользователем {added_by_user.name}"
        )

        recipient_ids: set[int] = set()

        # Vacancy creator
        if vacancy.created_by:
            recipient_ids.add(vacancy.created_by)

        # Hiring manager
        if vacancy.hiring_manager_id:
            recipient_ids.add(vacancy.hiring_manager_id)

        # Org admins/owners
        if vacancy.org_id:
            admin_ids = await _get_org_admins_and_owners(db, vacancy.org_id)
            recipient_ids.update(admin_ids)

        # Don't notify the person who performed the action
        recipient_ids.discard(added_by_user.id)

        for uid in recipient_ids:
            await _create_notification(db, uid, "new_candidate", title, message, link)

        if recipient_ids:
            await db.commit()
            logger.info(
                f"notify_new_candidate: entity={entity.id} vacancy={vacancy.id} "
                f"notified {len(recipient_ids)} users"
            )
    except Exception:
        logger.exception("notify_new_candidate failed")
        await db.rollback()


# ---------------------------------------------------------------------------
# 2. Candidate stage change
# ---------------------------------------------------------------------------

async def notify_stage_change(
    db: AsyncSession,
    application: VacancyApplication,
    entity: Entity,
    from_stage: ApplicationStage,
    to_stage: ApplicationStage,
    changed_by_user: User,
) -> None:
    """Notify relevant users when a candidate moves between pipeline stages.

    Recipients: application creator + vacancy creator/hiring manager (excluding actor).
    """
    try:
        # Load vacancy
        vac_result = await db.execute(
            select(Vacancy).where(Vacancy.id == application.vacancy_id)
        )
        vacancy = vac_result.scalar_one_or_none()
        vacancy_title = vacancy.title if vacancy else "?"

        link = f"/vacancies/{application.vacancy_id}"
        title = "Смена этапа"
        message = (
            f"{entity.name}: {_stage_label(from_stage)} → {_stage_label(to_stage)} "
            f"(вакансия «{vacancy_title}»)"
        )

        recipient_ids: set[int] = set()

        # Application creator
        if application.created_by:
            recipient_ids.add(application.created_by)

        if vacancy:
            if vacancy.created_by:
                recipient_ids.add(vacancy.created_by)
            if vacancy.hiring_manager_id:
                recipient_ids.add(vacancy.hiring_manager_id)

        recipient_ids.discard(changed_by_user.id)

        for uid in recipient_ids:
            await _create_notification(db, uid, "stage_change", title, message, link)

        if recipient_ids:
            await db.commit()
            logger.info(
                f"notify_stage_change: app={application.id} "
                f"{from_stage.value}->{to_stage.value} notified {len(recipient_ids)} users"
            )
    except Exception:
        logger.exception("notify_stage_change failed")
        await db.rollback()


# ---------------------------------------------------------------------------
# 3. Interview scheduled
# ---------------------------------------------------------------------------

async def notify_interview_scheduled(
    db: AsyncSession,
    application: VacancyApplication,
    entity: Entity,
    interview_date: datetime,
    scheduled_by_user: User,
) -> None:
    """Notify the recruiter when an interview date is set for a candidate."""
    try:
        vac_result = await db.execute(
            select(Vacancy).where(Vacancy.id == application.vacancy_id)
        )
        vacancy = vac_result.scalar_one_or_none()
        vacancy_title = vacancy.title if vacancy else "?"

        link = f"/vacancies/{application.vacancy_id}"
        formatted_date = interview_date.strftime("%d.%m.%Y %H:%M")
        title = "Собеседование назначено"
        message = (
            f"Собеседование с {entity.name} назначено на {formatted_date} "
            f"(вакансия «{vacancy_title}»)"
        )

        recipient_ids: set[int] = set()

        if application.created_by:
            recipient_ids.add(application.created_by)

        if vacancy:
            if vacancy.created_by:
                recipient_ids.add(vacancy.created_by)
            if vacancy.hiring_manager_id:
                recipient_ids.add(vacancy.hiring_manager_id)

        recipient_ids.discard(scheduled_by_user.id)

        for uid in recipient_ids:
            await _create_notification(
                db, uid, "interview_scheduled", title, message, link
            )

        if recipient_ids:
            await db.commit()
            logger.info(
                f"notify_interview_scheduled: app={application.id} "
                f"date={formatted_date} notified {len(recipient_ids)} users"
            )
    except Exception:
        logger.exception("notify_interview_scheduled failed")
        await db.rollback()


# ---------------------------------------------------------------------------
# 4. Practice stage started
# ---------------------------------------------------------------------------

async def notify_practice_started(
    db: AsyncSession,
    application: VacancyApplication,
    entity: Entity,
    started_by_user: User,
) -> None:
    """Notify org admins and recruiters when a candidate moves to practice stage."""
    try:
        vac_result = await db.execute(
            select(Vacancy).where(Vacancy.id == application.vacancy_id)
        )
        vacancy = vac_result.scalar_one_or_none()
        vacancy_title = vacancy.title if vacancy else "?"

        link = f"/vacancies/{application.vacancy_id}"
        title = "Практика начата"
        message = (
            f"{entity.name} переведён(а) на этап «Практика» "
            f"(вакансия «{vacancy_title}»)"
        )

        recipient_ids: set[int] = set()

        # Org admins/owners
        org_id = vacancy.org_id if vacancy else None
        if org_id:
            admin_ids = await _get_org_admins_and_owners(db, org_id)
            recipient_ids.update(admin_ids)

        # Application creator (recruiter)
        if application.created_by:
            recipient_ids.add(application.created_by)

        if vacancy:
            if vacancy.created_by:
                recipient_ids.add(vacancy.created_by)
            if vacancy.hiring_manager_id:
                recipient_ids.add(vacancy.hiring_manager_id)

        recipient_ids.discard(started_by_user.id)

        for uid in recipient_ids:
            await _create_notification(
                db, uid, "practice_started", title, message, link
            )

        if recipient_ids:
            await db.commit()
            logger.info(
                f"notify_practice_started: app={application.id} "
                f"notified {len(recipient_ids)} users"
            )
    except Exception:
        logger.exception("notify_practice_started failed")
        await db.rollback()


# ---------------------------------------------------------------------------
# 5. Probation period ending (scheduled check)
# ---------------------------------------------------------------------------

async def notify_probation_ending(
    db: AsyncSession,
    application: VacancyApplication,
    entity: Entity,
    end_date: datetime,
) -> None:
    """Send a reminder notification that a probation period is ending soon."""
    try:
        vac_result = await db.execute(
            select(Vacancy).where(Vacancy.id == application.vacancy_id)
        )
        vacancy = vac_result.scalar_one_or_none()
        vacancy_title = vacancy.title if vacancy else "?"

        link = f"/vacancies/{application.vacancy_id}"
        formatted_date = end_date.strftime("%d.%m.%Y")
        title = "Испытательный срок заканчивается"
        message = (
            f"У {entity.name} заканчивается испытательный срок {formatted_date} "
            f"(вакансия «{vacancy_title}»)"
        )

        recipient_ids: set[int] = set()

        org_id = vacancy.org_id if vacancy else None
        if org_id:
            admin_ids = await _get_org_admins_and_owners(db, org_id)
            recipient_ids.update(admin_ids)

        if application.created_by:
            recipient_ids.add(application.created_by)

        if vacancy:
            if vacancy.hiring_manager_id:
                recipient_ids.add(vacancy.hiring_manager_id)

        for uid in recipient_ids:
            await _create_notification(
                db, uid, "probation_ending", title, message, link
            )

        if recipient_ids:
            await db.commit()
            logger.info(
                f"notify_probation_ending: app={application.id} "
                f"end_date={formatted_date} notified {len(recipient_ids)} users"
            )
    except Exception:
        logger.exception("notify_probation_ending failed")
        await db.rollback()


# ---------------------------------------------------------------------------
# Scheduled task: check all probation endings within 7 days
# ---------------------------------------------------------------------------

async def check_probation_endings(db: AsyncSession) -> int:
    """Find candidates in 'hired' stage whose probation ends within 7 days.

    Probation end date is stored in entity.extra_data["probation_end_date"]
    (ISO format string).  We only send a notification once per application
    by checking for an existing notification with the same type + link.

    Returns the number of new notifications created.
    """
    now = datetime.utcnow()
    seven_days = now + timedelta(days=7)
    count = 0

    try:
        # Get all hired applications
        result = await db.execute(
            select(VacancyApplication, Entity)
            .join(Entity, VacancyApplication.entity_id == Entity.id)
            .where(VacancyApplication.stage == ApplicationStage.hired)
        )
        rows = result.all()

        for application, entity in rows:
            # Check if probation_end_date is set in extra_data
            extra = entity.extra_data or {}
            probation_end_str = extra.get("probation_end_date")
            if not probation_end_str:
                continue

            try:
                probation_end = datetime.fromisoformat(probation_end_str)
            except (ValueError, TypeError):
                continue

            # Only notify if ending within 7 days and not already passed
            if not (now <= probation_end <= seven_days):
                continue

            # Check if we already sent a notification for this
            link = f"/vacancies/{application.vacancy_id}"
            existing = await db.execute(
                select(Notification.id).where(
                    Notification.type == "probation_ending",
                    Notification.link == link,
                    Notification.message.contains(entity.name),
                ).limit(1)
            )
            if existing.scalar_one_or_none() is not None:
                continue

            await notify_probation_ending(db, application, entity, probation_end)
            count += 1

        logger.info(f"check_probation_endings: created {count} notification(s)")
        return count

    except Exception:
        logger.exception("check_probation_endings failed")
        await db.rollback()
        return 0
