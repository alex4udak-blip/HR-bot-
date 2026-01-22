"""
HR Analytics Dashboard

Provides endpoints for dashboard overview statistics:
- Key metrics (vacancies, candidates, hiring rate)
- Trends over time
- Quick stats
"""

from datetime import datetime, timedelta, date
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case, distinct
from pydantic import BaseModel

from ...database import get_db
from ...models.database import (
    User, UserRole, Vacancy, VacancyStatus, VacancyApplication,
    ApplicationStage, Entity, EntityStatus, Department
)
from ...services.auth import get_current_user, get_user_org
from ...utils.logging import get_logger

logger = get_logger("analytics-dashboard")

router = APIRouter()


# Schemas
class DashboardOverview(BaseModel):
    # Vacancies
    vacancies_total: int
    vacancies_open: int
    vacancies_draft: int
    vacancies_closed_this_month: int

    # Candidates
    candidates_total: int
    candidates_new_this_month: int
    candidates_in_pipeline: int

    # Applications
    applications_total: int
    applications_this_month: int

    # Hiring
    hires_this_month: int
    hires_this_quarter: int
    avg_time_to_hire_days: Optional[float]

    # Rejection
    rejections_this_month: int


class TrendDataPoint(BaseModel):
    date: str
    value: int


class DashboardTrends(BaseModel):
    applications_trend: List[TrendDataPoint]
    hires_trend: List[TrendDataPoint]
    vacancies_trend: List[TrendDataPoint]


class VacancyQuickStat(BaseModel):
    id: int
    title: str
    department_name: Optional[str]
    status: str
    applications_count: int
    days_open: int
    avg_score: Optional[float]


class TopPerformerStat(BaseModel):
    user_id: int
    user_name: str
    hires_count: int
    applications_processed: int


@router.get("/overview", response_model=DashboardOverview)
async def get_dashboard_overview(
    department_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get dashboard overview statistics."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    try:
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        quarter_start = now.replace(month=((now.month - 1) // 3) * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)

        # Base filters
        vacancy_filter = [Vacancy.org_id == org.id]
        entity_filter = [Entity.org_id == org.id]

        if department_id:
            vacancy_filter.append(Vacancy.department_id == department_id)
            entity_filter.append(Entity.department_id == department_id)

        # Vacancies stats
        vacancies_result = await db.execute(
            select(
                func.count(Vacancy.id).label("total"),
                func.sum(case((Vacancy.status == VacancyStatus.open, 1), else_=0)).label("open"),
                func.sum(case((Vacancy.status == VacancyStatus.draft, 1), else_=0)).label("draft"),
                func.sum(case(
                    (and_(Vacancy.status == VacancyStatus.closed, Vacancy.updated_at >= month_start), 1),
                    else_=0
                )).label("closed_this_month"),
            ).where(*vacancy_filter)
        )
        vac_row = vacancies_result.first()

        # Candidates stats - use string values for status comparison
        pipeline_statuses = ['new', 'screening', 'practice', 'tech_practice', 'is_interview', 'offer']
        candidates_result = await db.execute(
            select(
                func.count(Entity.id).label("total"),
                func.sum(case((Entity.created_at >= month_start, 1), else_=0)).label("new_this_month"),
                func.sum(case(
                    (Entity.status.in_(pipeline_statuses), 1),
                    else_=0
                )).label("in_pipeline"),
            ).where(
                *entity_filter,
                Entity.type == "candidate"
            )
        )
        cand_row = candidates_result.first()

        # Applications stats
        apps_result = await db.execute(
            select(
                func.count(VacancyApplication.id).label("total"),
                func.sum(case((VacancyApplication.applied_at >= month_start, 1), else_=0)).label("this_month"),
            ).select_from(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(Vacancy.org_id == org.id)
        )
        apps_row = apps_result.first()

        # Hires stats - use string value for stage comparison
        hires_result = await db.execute(
            select(
                func.sum(case((VacancyApplication.last_stage_change_at >= month_start, 1), else_=0)).label("this_month"),
                func.sum(case((VacancyApplication.last_stage_change_at >= quarter_start, 1), else_=0)).label("this_quarter"),
            ).select_from(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(
                Vacancy.org_id == org.id,
                VacancyApplication.stage == 'hired'
            )
        )
        hires_row = hires_result.first()

        # Rejections this month
        rejections_result = await db.execute(
            select(func.count(VacancyApplication.id))
            .select_from(VacancyApplication)
            .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
            .where(
                Vacancy.org_id == org.id,
                VacancyApplication.stage == 'rejected',
                VacancyApplication.last_stage_change_at >= month_start
            )
        )
        rejections_count = rejections_result.scalar() or 0

        # Average time to hire (for hires this quarter)
        avg_time_to_hire = None
        try:
            time_to_hire_result = await db.execute(
                select(
                    func.avg(
                        func.extract('epoch', VacancyApplication.last_stage_change_at - VacancyApplication.applied_at) / 86400
                    )
                ).select_from(VacancyApplication)
                .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
                .where(
                    Vacancy.org_id == org.id,
                    VacancyApplication.stage == 'hired',
                    VacancyApplication.last_stage_change_at >= quarter_start
                )
            )
            avg_time_to_hire = time_to_hire_result.scalar()
        except Exception as e:
            logger.warning(f"Failed to calculate avg time to hire: {e}")

        return DashboardOverview(
            vacancies_total=int(vac_row.total or 0),
            vacancies_open=int(vac_row.open or 0),
            vacancies_draft=int(vac_row.draft or 0),
            vacancies_closed_this_month=int(vac_row.closed_this_month or 0),
            candidates_total=int(cand_row.total or 0),
            candidates_new_this_month=int(cand_row.new_this_month or 0),
            candidates_in_pipeline=int(cand_row.in_pipeline or 0),
            applications_total=int(apps_row.total or 0) if apps_row else 0,
            applications_this_month=int(apps_row.this_month or 0) if apps_row else 0,
            hires_this_month=int(hires_row.this_month or 0) if hires_row else 0,
            hires_this_quarter=int(hires_row.this_quarter or 0) if hires_row else 0,
            avg_time_to_hire_days=round(avg_time_to_hire, 1) if avg_time_to_hire else None,
            rejections_this_month=int(rejections_count),
        )
    except Exception as e:
        logger.error(f"Dashboard overview error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load analytics: {str(e)}")


@router.get("/trends", response_model=DashboardTrends)
async def get_dashboard_trends(
    days: int = Query(30, ge=7, le=90),
    department_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get trend data for dashboard charts."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    now = datetime.utcnow()
    start_date = (now - timedelta(days=days)).date()

    # Applications trend by date
    apps_query = (
        select(
            func.date(VacancyApplication.applied_at).label("date"),
            func.count(VacancyApplication.id).label("count")
        )
        .select_from(VacancyApplication)
        .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
        .where(
            Vacancy.org_id == org.id,
            VacancyApplication.applied_at >= start_date
        )
        .group_by(func.date(VacancyApplication.applied_at))
        .order_by(func.date(VacancyApplication.applied_at))
    )
    if department_id:
        apps_query = apps_query.where(Vacancy.department_id == department_id)

    apps_result = await db.execute(apps_query)
    applications_trend = [
        TrendDataPoint(date=str(row.date), value=row.count)
        for row in apps_result
    ]

    # Hires trend by date
    hires_query = (
        select(
            func.date(VacancyApplication.last_stage_change_at).label("date"),
            func.count(VacancyApplication.id).label("count")
        )
        .select_from(VacancyApplication)
        .join(Vacancy, VacancyApplication.vacancy_id == Vacancy.id)
        .where(
            Vacancy.org_id == org.id,
            VacancyApplication.stage == ApplicationStage.hired,
            VacancyApplication.last_stage_change_at >= start_date
        )
        .group_by(func.date(VacancyApplication.last_stage_change_at))
        .order_by(func.date(VacancyApplication.last_stage_change_at))
    )
    if department_id:
        hires_query = hires_query.where(Vacancy.department_id == department_id)

    hires_result = await db.execute(hires_query)
    hires_trend = [
        TrendDataPoint(date=str(row.date), value=row.count)
        for row in hires_result
    ]

    # Vacancies opened trend
    vacancies_query = (
        select(
            func.date(Vacancy.published_at).label("date"),
            func.count(Vacancy.id).label("count")
        )
        .where(
            Vacancy.org_id == org.id,
            Vacancy.published_at >= start_date,
            Vacancy.published_at.isnot(None)
        )
        .group_by(func.date(Vacancy.published_at))
        .order_by(func.date(Vacancy.published_at))
    )
    if department_id:
        vacancies_query = vacancies_query.where(Vacancy.department_id == department_id)

    vacancies_result = await db.execute(vacancies_query)
    vacancies_trend = [
        TrendDataPoint(date=str(row.date), value=row.count)
        for row in vacancies_result
    ]

    return DashboardTrends(
        applications_trend=applications_trend,
        hires_trend=hires_trend,
        vacancies_trend=vacancies_trend,
    )


@router.get("/top-vacancies", response_model=List[VacancyQuickStat])
async def get_top_vacancies(
    limit: int = Query(5, ge=1, le=20),
    status: Optional[VacancyStatus] = VacancyStatus.open,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get top vacancies by application count."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Subquery for application count
    app_counts = (
        select(
            VacancyApplication.vacancy_id,
            func.count(VacancyApplication.id).label("app_count"),
            func.avg(
                case(
                    (VacancyApplication.compatibility_score.isnot(None),
                     func.cast(VacancyApplication.compatibility_score['overall_score'].astext, Float)),
                    else_=None
                )
            ).label("avg_score")
        )
        .group_by(VacancyApplication.vacancy_id)
        .subquery()
    )

    from sqlalchemy import Float

    query = (
        select(
            Vacancy.id,
            Vacancy.title,
            Vacancy.status,
            Vacancy.published_at,
            Department.name.label("department_name"),
            func.coalesce(app_counts.c.app_count, 0).label("applications_count"),
            app_counts.c.avg_score,
        )
        .outerjoin(app_counts, Vacancy.id == app_counts.c.vacancy_id)
        .outerjoin(Department, Vacancy.department_id == Department.id)
        .where(Vacancy.org_id == org.id)
    )

    if status:
        query = query.where(Vacancy.status == status)

    query = query.order_by(func.coalesce(app_counts.c.app_count, 0).desc()).limit(limit)

    result = await db.execute(query)
    vacancies = []

    for row in result:
        days_open = 0
        if row.published_at:
            days_open = (datetime.utcnow() - row.published_at).days

        vacancies.append(VacancyQuickStat(
            id=row.id,
            title=row.title,
            department_name=row.department_name,
            status=row.status.value,
            applications_count=row.applications_count,
            days_open=days_open,
            avg_score=round(row.avg_score, 1) if row.avg_score else None,
        ))

    return vacancies


@router.get("/departments-summary", response_model=List[Dict[str, Any]])
async def get_departments_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get hiring summary by department."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Get stats by department
    result = await db.execute(
        select(
            Department.id,
            Department.name,
            func.count(distinct(Vacancy.id)).label("vacancies"),
            func.count(distinct(
                case((Vacancy.status == VacancyStatus.open, Vacancy.id), else_=None)
            )).label("open_vacancies"),
            func.count(distinct(VacancyApplication.id)).label("applications"),
            func.count(distinct(
                case((VacancyApplication.stage == ApplicationStage.hired, VacancyApplication.id), else_=None)
            )).label("hires"),
        )
        .select_from(Department)
        .outerjoin(Vacancy, and_(
            Department.id == Vacancy.department_id,
            Vacancy.org_id == org.id
        ))
        .outerjoin(VacancyApplication, Vacancy.id == VacancyApplication.vacancy_id)
        .where(Department.org_id == org.id)
        .group_by(Department.id, Department.name)
        .order_by(Department.name)
    )

    departments = []
    for row in result:
        departments.append({
            "id": row.id,
            "name": row.name,
            "vacancies": row.vacancies or 0,
            "open_vacancies": row.open_vacancies or 0,
            "applications": row.applications or 0,
            "hires": row.hires or 0,
        })

    return departments
