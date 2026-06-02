"""HR org-chart units — изолировано от рекрутинговых departments/прав."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.models.database import OrgUnit, Employee, User, Organization
from .organizations import get_current_org, require_org_admin

router = APIRouter()


class OrgUnitCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = None


class OrgUnitUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    parent_id: Optional[int] = None


class AssignEmployee(BaseModel):
    org_unit_id: Optional[int] = None


class EmployeeMini(BaseModel):
    id: int
    user_name: Optional[str] = None
    position: Optional[str] = None


class OrgUnitNode(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = None
    sort_order: int = 0
    employees: List[EmployeeMini] = []


class OrgChartResponse(BaseModel):
    units: List[OrgUnitNode]
    unassigned: List[EmployeeMini]


@router.get("", response_model=OrgChartResponse)
async def get_org_chart(org: Organization = Depends(get_current_org), db: AsyncSession = Depends(get_db)):
    units = (await db.execute(
        select(OrgUnit).where(OrgUnit.org_id == org.id).order_by(OrgUnit.sort_order, OrgUnit.id)
    )).scalars().all()
    rows = (await db.execute(
        select(Employee, User).join(User, Employee.user_id == User.id)
        .where(Employee.org_id == org.id, Employee.is_active == True)  # noqa: E712
    )).all()
    by_unit: dict = {}
    unassigned: List[EmployeeMini] = []
    for emp, user in rows:
        mini = EmployeeMini(id=emp.id, user_name=user.name, position=emp.position)
        if emp.org_unit_id:
            by_unit.setdefault(emp.org_unit_id, []).append(mini)
        else:
            unassigned.append(mini)
    nodes = [
        OrgUnitNode(id=u.id, name=u.name, parent_id=u.parent_id, color=u.color,
                    sort_order=u.sort_order or 0, employees=by_unit.get(u.id, []))
        for u in units
    ]
    return OrgChartResponse(units=nodes, unassigned=unassigned)


@router.post("", response_model=OrgUnitNode)
async def create_unit(data: OrgUnitCreate, auth: tuple = Depends(require_org_admin), db: AsyncSession = Depends(get_db)):
    user, org, role = auth
    if data.parent_id is not None:
        parent = (await db.execute(
            select(OrgUnit).where(OrgUnit.id == data.parent_id, OrgUnit.org_id == org.id)
        )).scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent unit not found")
    unit = OrgUnit(org_id=org.id, name=data.name, parent_id=data.parent_id, color=data.color, sort_order=0)
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    return OrgUnitNode(id=unit.id, name=unit.name, parent_id=unit.parent_id, color=unit.color,
                       sort_order=unit.sort_order or 0, employees=[])


@router.patch("/{unit_id}", response_model=OrgUnitNode)
async def update_unit(unit_id: int, data: OrgUnitUpdate, auth: tuple = Depends(require_org_admin), db: AsyncSession = Depends(get_db)):
    user, org, role = auth
    unit = (await db.execute(
        select(OrgUnit).where(OrgUnit.id == unit_id, OrgUnit.org_id == org.id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    if data.name is not None:
        unit.name = data.name
    if data.color is not None:
        unit.color = data.color
    if data.sort_order is not None:
        unit.sort_order = data.sort_order
    # reparent (drag отдела) с защитой от циклов; отличаем "parent=null" от "поле отсутствует"
    fset = getattr(data, 'model_fields_set', None)
    if fset is None:
        fset = getattr(data, '__fields_set__', set())
    if 'parent_id' in fset:
        new_parent = data.parent_id
        if new_parent == unit_id:
            raise HTTPException(status_code=400, detail="Unit cannot be its own parent")
        if new_parent is not None:
            all_units = {u.id: u.parent_id for u in (await db.execute(
                select(OrgUnit).where(OrgUnit.org_id == org.id)
            )).scalars().all()}
            if new_parent not in all_units:
                raise HTTPException(status_code=404, detail="Parent unit not found")
            cur = new_parent
            seen = set()
            while cur is not None and cur not in seen:
                if cur == unit_id:
                    raise HTTPException(status_code=400, detail="Cannot move a unit under its own descendant")
                seen.add(cur)
                cur = all_units.get(cur)
        unit.parent_id = new_parent
    await db.commit()
    await db.refresh(unit)
    return OrgUnitNode(id=unit.id, name=unit.name, parent_id=unit.parent_id, color=unit.color,
                       sort_order=unit.sort_order or 0, employees=[])


@router.delete("/{unit_id}")
async def delete_unit(unit_id: int, auth: tuple = Depends(require_org_admin), db: AsyncSession = Depends(get_db)):
    user, org, role = auth
    unit = (await db.execute(
        select(OrgUnit).where(OrgUnit.id == unit_id, OrgUnit.org_id == org.id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    # детей поднимаем на уровень вверх (на parent удаляемого)
    children = (await db.execute(select(OrgUnit).where(OrgUnit.parent_id == unit_id))).scalars().all()
    for c in children:
        c.parent_id = unit.parent_id
    # сотрудников — в «не распределены»
    emps = (await db.execute(select(Employee).where(Employee.org_unit_id == unit_id))).scalars().all()
    for e in emps:
        e.org_unit_id = None
    await db.delete(unit)
    await db.commit()
    return {"success": True}


@router.put("/assign/{employee_id}")
async def assign_employee(employee_id: int, data: AssignEmployee, auth: tuple = Depends(require_org_admin), db: AsyncSession = Depends(get_db)):
    user, org, role = auth
    emp = (await db.execute(
        select(Employee).where(Employee.id == employee_id, Employee.org_id == org.id)
    )).scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if data.org_unit_id is not None:
        unit = (await db.execute(
            select(OrgUnit).where(OrgUnit.id == data.org_unit_id, OrgUnit.org_id == org.id)
        )).scalar_one_or_none()
        if not unit:
            raise HTTPException(status_code=404, detail="Org unit not found")
    emp.org_unit_id = data.org_unit_id
    await db.commit()
    return {"success": True, "employee_id": employee_id, "org_unit_id": data.org_unit_id}
