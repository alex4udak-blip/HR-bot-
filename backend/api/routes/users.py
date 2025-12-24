from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from ..database import get_db
from ..models.database import (
    User, UserRole, Chat, DepartmentMember, DeptRole, OrgMember, SharedAccess,
    AnalysisHistory, AIConversation, Entity, EntityAIConversation, EntityAnalysis,
    EntityTransfer, CallRecording, Invitation, CriteriaPreset, ReportSubscription
)
from ..models.schemas import UserCreate, UserUpdate, UserResponse
from ..services.auth import get_superadmin, get_current_user, hash_password
from ..services.password_policy import validate_password

router = APIRouter()


@router.get("", response_model=List[UserResponse])
async def get_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    current_user = await db.merge(current_user)

    # SUPERADMIN sees all users
    if current_user.role == UserRole.SUPERADMIN:
        result = await db.execute(select(User).order_by(User.created_at.desc()))
        users = result.scalars().all()
    # ADMIN/SUB_ADMIN sees:
    # - All users in their department
    # - Only ADMIN/SUB_ADMIN from other departments (not MEMBER)
    elif current_user.role in (UserRole.ADMIN, UserRole.SUB_ADMIN):
        # Get current user's department
        dept_member_result = await db.execute(
            select(DepartmentMember).where(DepartmentMember.user_id == current_user.id)
        )
        dept_member = dept_member_result.scalar_one_or_none()

        if not dept_member:
            # Admin without department - should not happen but handle gracefully
            return []

        # Get all users from same department
        same_dept_result = await db.execute(
            select(User)
            .join(DepartmentMember, DepartmentMember.user_id == User.id)
            .where(DepartmentMember.department_id == dept_member.department_id)
            .order_by(User.created_at.desc())
        )
        same_dept_users = set(same_dept_result.scalars().all())

        # Get ADMIN/SUB_ADMIN from other departments
        other_admins_result = await db.execute(
            select(User)
            .join(DepartmentMember, DepartmentMember.user_id == User.id)
            .where(
                DepartmentMember.department_id != dept_member.department_id,
                User.role.in_([UserRole.ADMIN, UserRole.SUB_ADMIN])
            )
            .order_by(User.created_at.desc())
        )
        other_admins = set(other_admins_result.scalars().all())

        # Combine and deduplicate
        users = list(same_dept_users | other_admins)
        users.sort(key=lambda u: u.created_at, reverse=True)
    else:
        # Regular users without role - should not happen
        return []

    # Get chat counts for all users
    chat_counts = {}
    if users:
        user_ids = [u.id for u in users]
        count_result = await db.execute(
            select(Chat.owner_id, func.count(Chat.id))
            .where(Chat.owner_id.in_(user_ids))
            .group_by(Chat.owner_id)
        )
        for owner_id, count in count_result.all():
            chat_counts[owner_id] = count

    return [
        UserResponse(
            id=u.id, email=u.email, name=u.name, role=u.role.value,
            telegram_id=u.telegram_id, telegram_username=u.telegram_username,
            is_active=u.is_active, created_at=u.created_at,
            chats_count=chat_counts.get(u.id, 0)
        ) for u in users
    ]


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin)
):
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email exists")

    if data.telegram_id:
        result = await db.execute(select(User).where(User.telegram_id == data.telegram_id))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Telegram ID exists")

    # Validate password
    is_valid, error_message = validate_password(data.password, data.email)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_message)

    # Map role string to enum
    if data.role == "superadmin":
        user_role = UserRole.SUPERADMIN
    elif data.role == "sub_admin":
        user_role = UserRole.SUB_ADMIN
    else:
        user_role = UserRole.ADMIN

    # Validate department_id for ADMIN and SUB_ADMIN
    if user_role in (UserRole.ADMIN, UserRole.SUB_ADMIN):
        if not data.department_id:
            raise HTTPException(status_code=400, detail="Admin must be assigned to a department")

        # Verify department exists
        from ..models.database import Department
        dept_result = await db.execute(select(Department).where(Department.id == data.department_id))
        if not dept_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Department not found")

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        name=data.name,
        role=user_role,
        telegram_id=data.telegram_id,
        telegram_username=data.telegram_username,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Add user to department if specified
    if data.department_id:
        # Determine department role based on user role
        if user_role == UserRole.ADMIN:
            dept_role = DeptRole.lead
        elif user_role == UserRole.SUB_ADMIN:
            dept_role = DeptRole.sub_admin
        else:
            dept_role = DeptRole.member

        dept_member = DepartmentMember(
            department_id=data.department_id,
            user_id=user.id,
            role=dept_role
        )
        db.add(dept_member)
        await db.commit()

    return UserResponse(
        id=user.id, email=user.email, name=user.name, role=user.role.value,
        telegram_id=user.telegram_id, telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at, chats_count=0
    )


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superadmin)
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Map role string to enum if role is being updated
    new_role = None
    if data.role:
        if data.role == "superadmin":
            new_role = UserRole.SUPERADMIN
        elif data.role == "sub_admin":
            new_role = UserRole.SUB_ADMIN
        else:
            new_role = UserRole.ADMIN

        # Validate department_id for ADMIN and SUB_ADMIN
        if new_role in (UserRole.ADMIN, UserRole.SUB_ADMIN):
            # Check if user has a department
            dept_member_result = await db.execute(
                select(DepartmentMember).where(DepartmentMember.user_id == user_id)
            )
            existing_dept_member = dept_member_result.scalar_one_or_none()

            # If no existing department and no new department provided, raise error
            if not existing_dept_member and not data.department_id:
                raise HTTPException(status_code=400, detail="Admin must be assigned to a department")

    # Verify new department exists if provided
    if data.department_id:
        from ..models.database import Department
        dept_result = await db.execute(select(Department).where(Department.id == data.department_id))
        if not dept_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Department not found")

    if data.email:
        user.email = data.email
    if data.name:
        user.name = data.name
    if new_role:
        user.role = new_role
    if data.telegram_id is not None:
        user.telegram_id = data.telegram_id
    if data.telegram_username is not None:
        user.telegram_username = data.telegram_username
    if data.is_active is not None:
        user.is_active = data.is_active

    # Update department membership if department_id is provided
    if data.department_id:
        # Check if user already has department membership
        dept_member_result = await db.execute(
            select(DepartmentMember).where(DepartmentMember.user_id == user_id)
        )
        existing_dept_member = dept_member_result.scalar_one_or_none()

        # Determine department role based on user role
        if user.role == UserRole.ADMIN:
            dept_role = DeptRole.lead
        elif user.role == UserRole.SUB_ADMIN:
            dept_role = DeptRole.sub_admin
        else:
            dept_role = DeptRole.member

        if existing_dept_member:
            # Update existing membership
            existing_dept_member.department_id = data.department_id
            existing_dept_member.role = dept_role
        else:
            # Create new membership
            dept_member = DepartmentMember(
                department_id=data.department_id,
                user_id=user.id,
                role=dept_role
            )
            db.add(dept_member)

    await db.commit()
    await db.refresh(user)

    # Get chat count
    count_result = await db.execute(
        select(func.count(Chat.id)).where(Chat.owner_id == user.id)
    )
    chats_count = count_result.scalar() or 0

    return UserResponse(
        id=user.id, email=user.email, name=user.name, role=user.role.value,
        telegram_id=user.telegram_id, telegram_username=user.telegram_username,
        is_active=user.is_active, created_at=user.created_at,
        chats_count=chats_count
    )


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superadmin)
):
    current = await db.merge(current)
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Delete/nullify all related records first
    from sqlalchemy import update, text
    import logging
    logger = logging.getLogger("hr-analyzer.users")

    try:
        # Delete records where user is required (NOT NULL)
        await db.execute(delete(DepartmentMember).where(DepartmentMember.user_id == user_id))
        await db.execute(delete(OrgMember).where(OrgMember.user_id == user_id))
        await db.execute(delete(SharedAccess).where(SharedAccess.shared_with_id == user_id))
        await db.execute(delete(SharedAccess).where(SharedAccess.shared_by_id == user_id))
        await db.execute(delete(AnalysisHistory).where(AnalysisHistory.user_id == user_id))
        await db.execute(delete(AIConversation).where(AIConversation.user_id == user_id))
        await db.execute(delete(EntityAIConversation).where(EntityAIConversation.user_id == user_id))
        await db.execute(delete(EntityAnalysis).where(EntityAnalysis.user_id == user_id))
        await db.execute(delete(ReportSubscription).where(ReportSubscription.user_id == user_id))

        # Nullify optional foreign keys
        await db.execute(update(Chat).where(Chat.owner_id == user_id).values(owner_id=None))
        await db.execute(update(CallRecording).where(CallRecording.owner_id == user_id).values(owner_id=None))
        await db.execute(update(Entity).where(Entity.created_by == user_id).values(created_by=None))
        await db.execute(update(Entity).where(Entity.transferred_to_id == user_id).values(transferred_to_id=None))
        await db.execute(update(EntityTransfer).where(EntityTransfer.from_user_id == user_id).values(from_user_id=None))
        await db.execute(update(EntityTransfer).where(EntityTransfer.to_user_id == user_id).values(to_user_id=None))
        await db.execute(update(OrgMember).where(OrgMember.invited_by == user_id).values(invited_by=None))
        await db.execute(update(Invitation).where(Invitation.invited_by_id == user_id).values(invited_by_id=None))
        await db.execute(update(Invitation).where(Invitation.used_by_id == user_id).values(used_by_id=None))
        await db.execute(update(CriteriaPreset).where(CriteriaPreset.created_by == user_id).values(created_by=None))

        # Try to find any remaining references using raw SQL
        # This catches any FK we might have missed
        await db.execute(text("""
            UPDATE messages SET sender_telegram_id = NULL WHERE sender_telegram_id IN (
                SELECT telegram_id FROM users WHERE id = :user_id
            )
        """), {"user_id": user_id})

        await db.delete(user)
        await db.commit()
        logger.info(f"Successfully deleted user {user_id}")
    except Exception as e:
        logger.error(f"Error deleting user {user_id}: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
