"""
Vacancy sharing endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime
from pydantic import BaseModel

from .common import (
    logger, get_db, Vacancy, VacancyApplication,
    User, OrgMember,
    SharedAccess, ResourceType, AccessLevel,
    check_vacancy_access, can_share_vacancy, get_shared_vacancy_ids,
    func
)
from ...services.auth import get_user_org

router = APIRouter()


# === Pydantic Schemas for Sharing ===

class VacancyShareRequest(BaseModel):
    """Request schema for sharing a vacancy."""
    shared_with_id: int
    access_level: AccessLevel = AccessLevel.view
    note: Optional[str] = None
    expires_at: Optional[datetime] = None


class VacancyShareResponse(BaseModel):
    """Response schema for vacancy share operations."""
    id: int
    vacancy_id: int
    vacancy_title: str
    shared_by_id: int
    shared_by_name: str
    shared_with_id: int
    shared_with_name: str
    access_level: AccessLevel
    note: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/{vacancy_id}/share")
async def share_vacancy(
    vacancy_id: int,
    request: VacancyShareRequest,
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Share a vacancy with another user.

    Only users who can share the vacancy (admin, owner, creator, lead, or users with full access)
    can share it with others.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = result.scalar_one_or_none()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check if user can share
    if not await can_share_vacancy(vacancy, current_user, org, db):
        raise HTTPException(
            status_code=403,
            detail="U vas net prav dlya predostavleniya dostupa k etoj vakansii"
        )

    # Check if target user exists and is in the same org
    target_result = await db.execute(
        select(User).join(OrgMember).where(
            User.id == request.shared_with_id,
            OrgMember.org_id == org.id,
            User.is_active == True
        )
    )
    target_user = target_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=404,
            detail="Pol'zovatel' ne najden ili ne yavlyaetsya chlenom organizacii"
        )

    # Can't share with yourself
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nel'zya podelit'sya s samim soboj")

    # Check if share already exists
    existing = await db.execute(
        select(SharedAccess).where(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id,
            SharedAccess.shared_with_id == request.shared_with_id
        )
    )
    existing_share = existing.scalar_one_or_none()

    if existing_share:
        # Update existing share
        existing_share.access_level = request.access_level
        existing_share.note = request.note
        existing_share.expires_at = request.expires_at
        existing_share.shared_by_id = current_user.id
        await db.commit()
        await db.refresh(existing_share)
        share = existing_share
    else:
        # Create new share
        share = SharedAccess(
            resource_type=ResourceType.vacancy,
            resource_id=vacancy_id,
            vacancy_id=vacancy_id,
            shared_by_id=current_user.id,
            shared_with_id=request.shared_with_id,
            access_level=request.access_level,
            note=request.note,
            expires_at=request.expires_at
        )
        db.add(share)
        await db.commit()
        await db.refresh(share)

    logger.info(
        f"User {current_user.id} shared vacancy {vacancy_id} with user {request.shared_with_id} "
        f"(level: {request.access_level.value})"
    )

    return VacancyShareResponse(
        id=share.id,
        vacancy_id=vacancy_id,
        vacancy_title=vacancy.title,
        shared_by_id=current_user.id,
        shared_by_name=current_user.name,
        shared_with_id=target_user.id,
        shared_with_name=target_user.name,
        access_level=share.access_level,
        note=share.note,
        expires_at=share.expires_at,
        created_at=share.created_at
    )


@router.get("/{vacancy_id}/shares")
async def get_vacancy_shares(
    vacancy_id: int,
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all shares for a vacancy.

    Only users who can share the vacancy can see its shares.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = result.scalar_one_or_none()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check if user can share (which also means they can view shares)
    if not await can_share_vacancy(vacancy, current_user, org, db):
        raise HTTPException(
            status_code=403,
            detail="U vas net prav dlya prosmotra dostupa k etoj vakansii"
        )

    # Get all shares
    shares_result = await db.execute(
        select(SharedAccess, User)
        .join(User, User.id == SharedAccess.shared_with_id)
        .where(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id
        )
        .order_by(SharedAccess.created_at.desc())
    )

    shares = []
    for share, user in shares_result.all():
        # Get shared_by user name
        shared_by_result = await db.execute(
            select(User.name).where(User.id == share.shared_by_id)
        )
        shared_by_name = shared_by_result.scalar() or "Unknown"

        shares.append({
            "id": share.id,
            "vacancy_id": vacancy_id,
            "vacancy_title": vacancy.title,
            "shared_by_id": share.shared_by_id,
            "shared_by_name": shared_by_name,
            "shared_with_id": user.id,
            "shared_with_name": user.name,
            "shared_with_email": user.email,
            "access_level": share.access_level.value,
            "note": share.note,
            "expires_at": share.expires_at.isoformat() if share.expires_at else None,
            "created_at": share.created_at.isoformat() if share.created_at else None
        })

    return {"shares": shares, "total": len(shares)}


@router.delete("/{vacancy_id}/share/{share_id}")
async def revoke_vacancy_share(
    vacancy_id: int,
    share_id: int,
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Revoke a share for a vacancy.

    Only users who can share the vacancy can revoke shares.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get vacancy
    result = await db.execute(
        select(Vacancy).where(Vacancy.id == vacancy_id, Vacancy.org_id == org.id)
    )
    vacancy = result.scalar_one_or_none()
    if not vacancy:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    # Check if user can share
    if not await can_share_vacancy(vacancy, current_user, org, db):
        raise HTTPException(
            status_code=403,
            detail="U vas net prav dlya otzyva dostupa k etoj vakansii"
        )

    # Get share
    share_result = await db.execute(
        select(SharedAccess).where(
            SharedAccess.id == share_id,
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == vacancy_id
        )
    )
    share = share_result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    # Delete share
    await db.delete(share)
    await db.commit()

    logger.info(
        f"User {current_user.id} revoked share {share_id} for vacancy {vacancy_id}"
    )

    return {"message": "Dostup otozvan", "share_id": share_id}


@router.get("/shared-with-me")
async def get_vacancies_shared_with_me(
    current_user: User = Depends(check_vacancy_access),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all vacancies that have been shared with the current user.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get shared vacancy IDs
    shared_ids = await get_shared_vacancy_ids(current_user.id, db)

    if not shared_ids:
        return {"vacancies": [], "total": 0}

    # Get vacancies with their share info
    result = await db.execute(
        select(Vacancy, SharedAccess)
        .join(SharedAccess, and_(
            SharedAccess.resource_type == ResourceType.vacancy,
            SharedAccess.resource_id == Vacancy.id,
            SharedAccess.shared_with_id == current_user.id
        ))
        .where(
            Vacancy.id.in_(shared_ids),
            Vacancy.org_id == org.id
        )
        .order_by(SharedAccess.created_at.desc())
    )

    vacancies = []
    for vacancy, share in result.all():
        # Get shared_by user name
        shared_by_result = await db.execute(
            select(User.name).where(User.id == share.shared_by_id)
        )
        shared_by_name = shared_by_result.scalar() or "Unknown"

        # Get applications count
        apps_count_result = await db.execute(
            select(func.count(VacancyApplication.id))
            .where(VacancyApplication.vacancy_id == vacancy.id)
        )
        apps_count = apps_count_result.scalar() or 0

        vacancies.append({
            "id": vacancy.id,
            "title": vacancy.title,
            "description": vacancy.description,
            "status": vacancy.status.value,
            "department_id": vacancy.department_id,
            "applications_count": apps_count,
            "share": {
                "id": share.id,
                "shared_by_id": share.shared_by_id,
                "shared_by_name": shared_by_name,
                "access_level": share.access_level.value,
                "note": share.note,
                "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                "created_at": share.created_at.isoformat() if share.created_at else None
            }
        })

    return {"vacancies": vacancies, "total": len(vacancies)}
