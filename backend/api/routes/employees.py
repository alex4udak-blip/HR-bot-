"""
Employee Personal Cabinet, Leave Counter, and Auto-Reminders routes.

Endpoints:
- CRUD for employees (admin/HRD)
- /me endpoint for employee self-service
- Leave balance & leave requests
- Auto-reminders for probation/anniversary dates
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, List

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.database import get_db
from api.models.database import (
    Employee, LeaveRequest, User, Organization, Department,
    OrgMember, OrgRole, Notification,
)
from api.services.auth import get_current_user, get_user_org

logger = logging.getLogger("hr-analyzer.employees")

router = APIRouter()


# ─── Pydantic schemas ───────────────────────────────────────

class EmployeeCreate(BaseModel):
    user_id: int
    entity_id: Optional[int] = None
    department_id: Optional[int] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    practice_start_date: Optional[datetime] = None
    department_start_date: Optional[datetime] = None
    nda_signed: bool = False
    contract_signed: bool = False
    extra_data: Optional[dict] = None


class EmployeeUpdate(BaseModel):
    department_id: Optional[int] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    practice_start_date: Optional[datetime] = None
    department_start_date: Optional[datetime] = None
    nda_signed: Optional[bool] = None
    nda_signed_at: Optional[datetime] = None
    contract_signed: Optional[bool] = None
    contract_signed_at: Optional[datetime] = None
    vacation_days_total: Optional[int] = None
    vacation_days_used: Optional[int] = None
    sick_days_total: Optional[int] = None
    sick_days_used: Optional[int] = None
    family_leave_days_total: Optional[int] = None
    family_leave_days_used: Optional[int] = None
    extra_data: Optional[dict] = None


class EmployeeResponse(BaseModel):
    id: int
    user_id: int
    org_id: int
    entity_id: Optional[int] = None
    department_id: Optional[int] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    practice_start_date: Optional[datetime] = None
    department_start_date: Optional[datetime] = None
    probation_end_date: Optional[datetime] = None
    one_year_date: Optional[datetime] = None
    vacation_days_total: int = 0
    vacation_days_used: int = 0
    sick_days_total: int = 10
    sick_days_used: int = 0
    family_leave_days_total: int = 3
    family_leave_days_used: int = 0
    nda_signed: bool = False
    nda_signed_at: Optional[datetime] = None
    contract_signed: bool = False
    contract_signed_at: Optional[datetime] = None
    is_active: bool = True
    dismissed_at: Optional[datetime] = None
    dismissal_reason: Optional[str] = None
    extra_data: Optional[dict] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Joined fields
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    department_name: Optional[str] = None

    model_config = {"from_attributes": True}


class LeaveBalanceResponse(BaseModel):
    vacation_total: int
    vacation_used: int
    vacation_remaining: int
    sick_total: int
    sick_used: int
    sick_remaining: int
    family_leave_total: int
    family_leave_used: int
    family_leave_remaining: int


class LeaveRequestCreate(BaseModel):
    type: str  # vacation, sick, family_leave, bereavement
    start_date: datetime
    end_date: datetime
    days: int
    reason: Optional[str] = None


class LeaveRequestResponse(BaseModel):
    id: int
    employee_id: int
    type: str
    start_date: datetime
    end_date: datetime
    days: int
    reason: Optional[str] = None
    status: str
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    # Joined
    employee_name: Optional[str] = None

    model_config = {"from_attributes": True}


class ReminderItem(BaseModel):
    employee_id: int
    employee_name: str
    type: str  # probation_ending, one_year_anniversary
    date: datetime
    days_remaining: int


# ─── Helpers ─────────────────────────────────────────────────

def _auto_calculate_dates(emp: Employee):
    """Auto-calculate probation_end_date and one_year_date from department_start_date."""
    if emp.department_start_date:
        emp.probation_end_date = emp.department_start_date + relativedelta(months=3)
        emp.one_year_date = emp.department_start_date + relativedelta(years=1)
    else:
        emp.probation_end_date = None
        emp.one_year_date = None


def _calculate_vacation_days(department_start_date: Optional[datetime]) -> int:
    """Calculate accumulated vacation days: 2 per month from department_start_date, max 24/year."""
    if not department_start_date:
        return 0
    now = datetime.utcnow()
    if now < department_start_date:
        return 0
    delta = relativedelta(now, department_start_date)
    total_months = delta.years * 12 + delta.months
    # Within current year cycle: max 24 per year
    months_in_current_year = total_months % 12
    full_years = total_months // 12
    current_year_days = min(months_in_current_year * 2, 24)
    # Add 24 for each full year (unused carry-over simplified)
    return full_years * 24 + current_year_days


async def _is_admin_or_owner(user: User, org_id: int, db: AsyncSession) -> bool:
    """Check if user is superadmin or org owner/admin."""
    if user.role and user.role.value == "superadmin":
        return True
    result = await db.execute(
        select(OrgMember).where(
            OrgMember.user_id == user.id,
            OrgMember.org_id == org_id,
            OrgMember.role.in_([OrgRole.owner, OrgRole.admin]),
        )
    )
    return result.scalar_one_or_none() is not None


def _employee_to_response(emp: Employee) -> EmployeeResponse:
    """Convert Employee ORM object to response, including joined fields."""
    return EmployeeResponse(
        id=emp.id,
        user_id=emp.user_id,
        org_id=emp.org_id,
        entity_id=emp.entity_id,
        department_id=emp.department_id,
        position=emp.position,
        phone=emp.phone,
        telegram_username=emp.telegram_username,
        practice_start_date=emp.practice_start_date,
        department_start_date=emp.department_start_date,
        probation_end_date=emp.probation_end_date,
        one_year_date=emp.one_year_date,
        vacation_days_total=emp.vacation_days_total or 0,
        vacation_days_used=emp.vacation_days_used or 0,
        sick_days_total=emp.sick_days_total or 10,
        sick_days_used=emp.sick_days_used or 0,
        family_leave_days_total=emp.family_leave_days_total or 3,
        family_leave_days_used=emp.family_leave_days_used or 0,
        nda_signed=emp.nda_signed or False,
        nda_signed_at=emp.nda_signed_at,
        contract_signed=emp.contract_signed or False,
        contract_signed_at=emp.contract_signed_at,
        is_active=emp.is_active if emp.is_active is not None else True,
        dismissed_at=emp.dismissed_at,
        dismissal_reason=emp.dismissal_reason,
        extra_data=emp.extra_data,
        created_at=emp.created_at,
        updated_at=emp.updated_at,
        user_name=emp.user.name if emp.user else None,
        user_email=emp.user.email if emp.user else None,
        department_name=emp.department.name if emp.department else None,
    )


# ─── Employee CRUD ───────────────────────────────────────────

@router.get("", response_model=List[EmployeeResponse])
async def list_employees(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all employees (admin/HRD only)."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    query = (
        select(Employee)
        .options(selectinload(Employee.user), selectinload(Employee.department))
        .where(Employee.org_id == org.id)
    )
    if active_only:
        query = query.where(Employee.is_active == True)
    query = query.order_by(Employee.created_at.desc())

    result = await db.execute(query)
    employees = list(result.scalars().all())

    # Update vacation days dynamically
    responses = []
    for emp in employees:
        emp.vacation_days_total = _calculate_vacation_days(emp.department_start_date)
        responses.append(_employee_to_response(emp))
    return responses


@router.get("/me", response_model=EmployeeResponse)
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's employee profile."""
    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.user), selectinload(Employee.department))
        .where(Employee.user_id == current_user.id)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee profile not found")

    emp.vacation_days_total = _calculate_vacation_days(emp.department_start_date)
    return _employee_to_response(emp)


@router.get("/leave-requests", response_model=List[LeaveRequestResponse])
async def list_all_leave_requests(
    status_filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all pending leave requests (admin/HRD)."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    query = (
        select(LeaveRequest)
        .join(Employee, LeaveRequest.employee_id == Employee.id)
        .options(selectinload(LeaveRequest.employee).selectinload(Employee.user))
        .where(Employee.org_id == org.id)
    )
    if status_filter:
        query = query.where(LeaveRequest.status == status_filter)
    else:
        query = query.where(LeaveRequest.status == "pending")
    query = query.order_by(LeaveRequest.created_at.desc())

    result = await db.execute(query)
    requests = list(result.scalars().all())

    return [
        LeaveRequestResponse(
            id=lr.id,
            employee_id=lr.employee_id,
            type=lr.type,
            start_date=lr.start_date,
            end_date=lr.end_date,
            days=lr.days,
            reason=lr.reason,
            status=lr.status,
            approved_by=lr.approved_by,
            approved_at=lr.approved_at,
            created_at=lr.created_at,
            employee_name=lr.employee.user.name if lr.employee and lr.employee.user else None,
        )
        for lr in requests
    ]


@router.get("/reminders", response_model=List[ReminderItem])
async def get_reminders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get upcoming reminders: probation ends within 14 days, 1 year within 14 days."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    now = datetime.utcnow()
    in_14_days = now + timedelta(days=14)

    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.user))
        .where(
            Employee.org_id == org.id,
            Employee.is_active == True,
            or_(
                and_(
                    Employee.probation_end_date != None,
                    Employee.probation_end_date >= now,
                    Employee.probation_end_date <= in_14_days,
                ),
                and_(
                    Employee.one_year_date != None,
                    Employee.one_year_date >= now,
                    Employee.one_year_date <= in_14_days,
                ),
            ),
        )
    )
    employees = list(result.scalars().all())

    reminders: List[ReminderItem] = []
    for emp in employees:
        name = emp.user.name if emp.user else f"Employee #{emp.id}"
        if emp.probation_end_date and now <= emp.probation_end_date <= in_14_days:
            reminders.append(ReminderItem(
                employee_id=emp.id,
                employee_name=name,
                type="probation_ending",
                date=emp.probation_end_date,
                days_remaining=(emp.probation_end_date - now).days,
            ))
        if emp.one_year_date and now <= emp.one_year_date <= in_14_days:
            reminders.append(ReminderItem(
                employee_id=emp.id,
                employee_name=name,
                type="one_year_anniversary",
                date=emp.one_year_date,
                days_remaining=(emp.one_year_date - now).days,
            ))

    reminders.sort(key=lambda r: r.days_remaining)
    return reminders


@router.get("/{employee_id}", response_model=EmployeeResponse)
async def get_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get employee detail."""
    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.user), selectinload(Employee.department))
        .where(Employee.id == employee_id)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Access check: admin or self
    org = await get_user_org(current_user, db)
    if emp.user_id != current_user.id:
        if not org or not await _is_admin_or_owner(current_user, emp.org_id, db):
            raise HTTPException(status_code=403, detail="Access denied")

    emp.vacation_days_total = _calculate_vacation_days(emp.department_start_date)
    return _employee_to_response(emp)


@router.post("", response_model=EmployeeResponse)
async def create_employee(
    data: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create employee record (from practice list to staff)."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    # Check user exists
    user_result = await db.execute(select(User).where(User.id == data.user_id))
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check duplicate
    existing = await db.execute(select(Employee).where(Employee.user_id == data.user_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Employee record already exists for this user")

    emp = Employee(
        user_id=data.user_id,
        org_id=org.id,
        entity_id=data.entity_id,
        department_id=data.department_id,
        position=data.position,
        phone=data.phone,
        telegram_username=data.telegram_username,
        practice_start_date=data.practice_start_date,
        department_start_date=data.department_start_date,
        nda_signed=data.nda_signed,
        contract_signed=data.contract_signed,
        extra_data=data.extra_data or {},
    )
    _auto_calculate_dates(emp)
    emp.vacation_days_total = _calculate_vacation_days(emp.department_start_date)

    db.add(emp)
    await db.commit()
    await db.refresh(emp, attribute_names=["user", "department"])

    return _employee_to_response(emp)


@router.put("/{employee_id}", response_model=EmployeeResponse)
async def update_employee(
    employee_id: int,
    data: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update employee record."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")

    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.user), selectinload(Employee.department))
        .where(Employee.id == employee_id, Employee.org_id == org.id)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(emp, field, value)

    # Recalculate dates if department_start_date changed
    if "department_start_date" in update_data:
        _auto_calculate_dates(emp)

    emp.vacation_days_total = _calculate_vacation_days(emp.department_start_date)
    emp.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(emp, attribute_names=["user", "department"])
    return _employee_to_response(emp)


@router.delete("/{employee_id}")
async def dismiss_employee(
    employee_id: int,
    reason: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dismiss (soft-delete) an employee."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    result = await db.execute(
        select(Employee).where(Employee.id == employee_id, Employee.org_id == org.id)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp.is_active = False
    emp.dismissed_at = datetime.utcnow()
    emp.dismissal_reason = reason
    await db.commit()

    return {"ok": True, "detail": "Employee dismissed"}


# ─── Leave balance & requests ────────────────────────────────

@router.get("/{employee_id}/leave-balance", response_model=LeaveBalanceResponse)
async def get_leave_balance(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get leave balance for an employee."""
    result = await db.execute(select(Employee).where(Employee.id == employee_id))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Access: self or admin
    if emp.user_id != current_user.id:
        org = await get_user_org(current_user, db)
        if not org or not await _is_admin_or_owner(current_user, emp.org_id, db):
            raise HTTPException(status_code=403, detail="Access denied")

    vac_total = _calculate_vacation_days(emp.department_start_date)
    vac_used = emp.vacation_days_used or 0
    sick_total = emp.sick_days_total or 10
    sick_used = emp.sick_days_used or 0
    fl_total = emp.family_leave_days_total or 3
    fl_used = emp.family_leave_days_used or 0

    return LeaveBalanceResponse(
        vacation_total=vac_total,
        vacation_used=vac_used,
        vacation_remaining=max(0, vac_total - vac_used),
        sick_total=sick_total,
        sick_used=sick_used,
        sick_remaining=max(0, sick_total - sick_used),
        family_leave_total=fl_total,
        family_leave_used=fl_used,
        family_leave_remaining=max(0, fl_total - fl_used),
    )


@router.post("/{employee_id}/leave-request", response_model=LeaveRequestResponse)
async def create_leave_request(
    employee_id: int,
    data: LeaveRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Request leave (employee self-service)."""
    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.user))
        .where(Employee.id == employee_id)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Only self or admin can create
    if emp.user_id != current_user.id:
        org = await get_user_org(current_user, db)
        if not org or not await _is_admin_or_owner(current_user, emp.org_id, db):
            raise HTTPException(status_code=403, detail="Access denied")

    # Validate type
    if data.type not in ("vacation", "sick", "family_leave", "bereavement"):
        raise HTTPException(status_code=400, detail="Invalid leave type")

    lr = LeaveRequest(
        employee_id=employee_id,
        type=data.type,
        start_date=data.start_date,
        end_date=data.end_date,
        days=data.days,
        reason=data.reason,
        status="pending",
    )
    db.add(lr)
    await db.commit()
    await db.refresh(lr)

    return LeaveRequestResponse(
        id=lr.id,
        employee_id=lr.employee_id,
        type=lr.type,
        start_date=lr.start_date,
        end_date=lr.end_date,
        days=lr.days,
        reason=lr.reason,
        status=lr.status,
        approved_by=lr.approved_by,
        approved_at=lr.approved_at,
        created_at=lr.created_at,
        employee_name=emp.user.name if emp.user else None,
    )


@router.put("/leave-requests/{request_id}/approve")
async def approve_leave_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve a leave request (admin/HRD)."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    result = await db.execute(
        select(LeaveRequest)
        .join(Employee)
        .where(LeaveRequest.id == request_id, Employee.org_id == org.id)
    )
    lr = result.scalar_one_or_none()
    if not lr:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if lr.status != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")

    lr.status = "approved"
    lr.approved_by = current_user.id
    lr.approved_at = datetime.utcnow()

    # Update employee leave counters
    emp_result = await db.execute(select(Employee).where(Employee.id == lr.employee_id))
    emp = emp_result.scalar_one_or_none()
    if emp:
        if lr.type == "vacation":
            emp.vacation_days_used = (emp.vacation_days_used or 0) + lr.days
        elif lr.type == "sick":
            emp.sick_days_used = (emp.sick_days_used or 0) + lr.days
        elif lr.type == "family_leave":
            emp.family_leave_days_used = (emp.family_leave_days_used or 0) + lr.days

    await db.commit()
    return {"ok": True, "detail": "Leave request approved"}


@router.put("/leave-requests/{request_id}/reject")
async def reject_leave_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject a leave request (admin/HRD)."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="No organization")
    if not await _is_admin_or_owner(current_user, org.id, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    result = await db.execute(
        select(LeaveRequest)
        .join(Employee)
        .where(LeaveRequest.id == request_id, Employee.org_id == org.id)
    )
    lr = result.scalar_one_or_none()
    if not lr:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if lr.status != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")

    lr.status = "rejected"
    lr.approved_by = current_user.id
    lr.approved_at = datetime.utcnow()
    await db.commit()

    return {"ok": True, "detail": "Leave request rejected"}
