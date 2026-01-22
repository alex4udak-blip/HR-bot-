"""
Entity transfer operations - transfer entity ownership between users/departments.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta

from .common import (
    logger, get_db, Entity, EntityTransfer, Chat, CallRecording, User,
    UserRole, AccessLevel, Department, DepartmentMember, DeptRole,
    get_current_user, get_user_org, get_user_org_role,
    TransferCreate, check_entity_access
)

router = APIRouter()


@router.post("/{entity_id}/transfer")
async def transfer_entity(
    entity_id: int,
    data: TransferCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Transfer contact to another user/department with copy mechanism.
    Creates a frozen copy for the old owner and transfers the original to the new owner.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Use SELECT FOR UPDATE to prevent race conditions during transfer
    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.org_id == org.id)
        .with_for_update()
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # Don't allow transfer of already transferred entities (frozen copies)
    if entity.is_transferred:
        raise HTTPException(400, "Cannot transfer a frozen copy. Transfer the original entity instead.")

    # Check transfer permissions - requires full access or ownership
    has_access = await check_entity_access(entity, current_user, org.id, db, required_level=AccessLevel.full)
    if not has_access:
        raise HTTPException(403, "No transfer permission for this entity")

    # Validate target user exists and is in the same org
    to_user_result = await db.execute(
        select(User).where(User.id == data.to_user_id)
    )
    to_user = to_user_result.scalar_one_or_none()
    if not to_user:
        raise HTTPException(404, "Target user not found")

    # Check if target user has access to this org
    from_user_role = await get_user_org_role(current_user, org.id, db)
    to_user_role = await get_user_org_role(to_user, org.id, db)
    if to_user_role is None and to_user.role != UserRole.superadmin:
        raise HTTPException(400, "Target user is not a member of this organization")

    # Check transfer permissions based on roles and departments
    # Get current user's department memberships
    from_dept_memberships = await db.execute(
        select(DepartmentMember).where(DepartmentMember.user_id == current_user.id)
    )
    from_dept_memberships = list(from_dept_memberships.scalars().all())
    from_dept_ids = [dm.department_id for dm in from_dept_memberships]

    # Get target user's department memberships
    to_dept_memberships = await db.execute(
        select(DepartmentMember).where(DepartmentMember.user_id == data.to_user_id)
    )
    to_dept_memberships = list(to_dept_memberships.scalars().all())
    to_dept_ids = [dm.department_id for dm in to_dept_memberships]

    # Check transfer permissions based on roles
    can_transfer = False
    if current_user.role == UserRole.superadmin or from_user_role == "owner":
        # SUPERADMIN and OWNER can transfer to anyone
        can_transfer = True
    else:
        # Check department-based permissions
        has_sub_admin = any(dm.role == DeptRole.sub_admin for dm in from_dept_memberships)

        if has_sub_admin or from_user_role == "admin":
            # SUB_ADMIN and ADMIN can transfer to:
            # 1. Anyone in their own department
            # 2. Admins/sub_admins of other departments
            if any(dept_id in from_dept_ids for dept_id in to_dept_ids):
                # Same department
                can_transfer = True
            else:
                # Check if target is admin/sub_admin of any department
                is_target_admin = any(dm.role in (DeptRole.sub_admin, DeptRole.lead) for dm in to_dept_memberships)
                if is_target_admin or to_user_role == "admin":
                    can_transfer = True
        else:
            # MEMBER can only transfer within their own department
            if any(dept_id in from_dept_ids for dept_id in to_dept_ids):
                can_transfer = True

    if not can_transfer:
        raise HTTPException(403, "You don't have permission to transfer to this user based on your role and department")

    # Get current user's department (first one if multiple)
    from_dept_id = from_dept_ids[0] if from_dept_ids else None

    # Validate to_department_id if provided
    if data.to_department_id:
        dept_result = await db.execute(
            select(Department).where(Department.id == data.to_department_id, Department.org_id == org.id)
        )
        if not dept_result.scalar_one_or_none():
            raise HTTPException(400, "Invalid target department")

    # === STEP 1: Create a frozen copy for the old owner ===
    old_owner_id = entity.created_by
    new_owner_name = to_user.name if to_user else "Unknown"

    # Create copy with all data except relationships
    entity_copy = Entity(
        org_id=entity.org_id,
        department_id=entity.department_id,
        type=entity.type,
        name=f"{entity.name} [Transferred -> {new_owner_name}]",
        status=entity.status,
        phone=entity.phone,
        email=entity.email,
        telegram_user_id=entity.telegram_user_id,
        company=entity.company,
        position=entity.position,
        tags=entity.tags.copy() if entity.tags else [],
        extra_data=entity.extra_data.copy() if entity.extra_data else {},
        created_by=old_owner_id,  # Keep old owner
        created_at=entity.created_at,
        updated_at=datetime.utcnow(),
        # Mark as transferred
        is_transferred=True,
        transferred_to_id=data.to_user_id,
        transferred_at=datetime.utcnow()
    )
    db.add(entity_copy)
    await db.flush()  # Get the ID of the copy

    # === STEP 2: Copy all chats to the frozen copy ===
    # SECURITY: Use FOR UPDATE to prevent race condition where new chats
    # are added while transfer is in progress
    chats_result = await db.execute(
        select(Chat)
        .where(Chat.entity_id == entity_id)
        .with_for_update()
    )
    chats = list(chats_result.scalars().all())

    # === STEP 3: Copy all calls to the frozen copy ===
    # SECURITY: Use FOR UPDATE to prevent race condition where new calls
    # are added while transfer is in progress
    calls_result = await db.execute(
        select(CallRecording)
        .where(CallRecording.entity_id == entity_id)
        .with_for_update()
    )
    calls = list(calls_result.scalars().all())

    # Link chats and calls to the copy (read-only reference)
    # Note: We don't duplicate chats/calls, we just create references
    # The copy will reference the same chats/calls for historical context

    # === STEP 4: Update original entity - transfer to new owner ===
    entity.created_by = data.to_user_id
    if data.to_department_id:
        entity.department_id = data.to_department_id
    entity.updated_at = datetime.utcnow()

    # === STEP 5: Transfer all chats and calls to new owner ===
    for chat in chats:
        chat.owner_id = data.to_user_id

    for call in calls:
        call.owner_id = data.to_user_id

    # === STEP 6: Create transfer record ===
    transfer = EntityTransfer(
        entity_id=entity_id,
        from_user_id=current_user.id,
        to_user_id=data.to_user_id,
        from_department_id=from_dept_id,
        to_department_id=data.to_department_id,
        comment=data.comment,
        copy_entity_id=entity_copy.id,
        cancel_deadline=datetime.utcnow() + timedelta(hours=1)
    )
    db.add(transfer)

    await db.commit()

    return {
        "success": True,
        "transfer_id": transfer.id,
        "original_entity_id": entity.id,
        "copy_entity_id": entity_copy.id,
        "transferred_chats": len(chats),
        "transferred_calls": len(calls),
        "cancel_deadline": transfer.cancel_deadline.isoformat() if transfer.cancel_deadline else None
    }


@router.post("/transfers/{transfer_id}/cancel")
async def cancel_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Cancel a transfer within the allowed time window (1 hour).
    Reverts the entity, chats and calls back to original owner.
    """
    current_user = await db.merge(current_user)

    # Get transfer record with row lock to prevent concurrent cancellations
    result = await db.execute(
        select(EntityTransfer)
        .where(EntityTransfer.id == transfer_id)
        .with_for_update()
    )
    transfer = result.scalar_one_or_none()

    if not transfer:
        raise HTTPException(404, "Transfer not found")

    # Check if user is involved in the transfer or is superadmin
    # Both sender (from_user) and recipient (to_user) can cancel within the time window
    is_sender = transfer.from_user_id == current_user.id
    is_recipient = transfer.to_user_id == current_user.id
    is_superadmin = current_user.role == UserRole.superadmin

    if not (is_sender or is_recipient or is_superadmin):
        raise HTTPException(403, "Only the sender, recipient, or superadmin can cancel this transfer")

    # Check if already cancelled
    if transfer.cancelled_at:
        raise HTTPException(400, "Transfer already cancelled")

    # Check if within cancellation window
    if transfer.cancel_deadline and datetime.utcnow() > transfer.cancel_deadline:
        raise HTTPException(400, "Cancellation window expired (1 hour)")

    # Get the original entity with row lock to prevent race conditions
    entity_result = await db.execute(
        select(Entity)
        .where(Entity.id == transfer.entity_id)
        .with_for_update()
    )
    entity = entity_result.scalar_one_or_none()

    if not entity:
        raise HTTPException(404, "Entity not found")

    # === STEP 1: Revert entity ownership ===
    entity.created_by = transfer.from_user_id
    if transfer.from_department_id:
        entity.department_id = transfer.from_department_id
    entity.updated_at = datetime.utcnow()

    # === STEP 2: Revert all chats ownership ===
    # SECURITY: Use FOR UPDATE to prevent race condition
    chats_result = await db.execute(
        select(Chat)
        .where(Chat.entity_id == transfer.entity_id)
        .with_for_update()
    )
    chats = list(chats_result.scalars().all())
    for chat in chats:
        chat.owner_id = transfer.from_user_id

    # === STEP 3: Revert all calls ownership ===
    # SECURITY: Use FOR UPDATE to prevent race condition
    calls_result = await db.execute(
        select(CallRecording)
        .where(CallRecording.entity_id == transfer.entity_id)
        .with_for_update()
    )
    calls = list(calls_result.scalars().all())
    for call in calls:
        call.owner_id = transfer.from_user_id

    # === STEP 4: Delete the frozen copy ===
    if transfer.copy_entity_id:
        copy_result = await db.execute(
            select(Entity).where(Entity.id == transfer.copy_entity_id)
        )
        copy_entity = copy_result.scalar_one_or_none()
        if copy_entity:
            await db.delete(copy_entity)

    # === STEP 5: Mark transfer as cancelled ===
    transfer.cancelled_at = datetime.utcnow()

    await db.commit()

    return {
        "success": True,
        "entity_id": entity.id,
        "reverted_chats": len(chats),
        "reverted_calls": len(calls)
    }


@router.get("/transfers/pending")
async def get_pending_transfers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get transfers that can still be cancelled (made by current user within 1 hour)."""
    current_user = await db.merge(current_user)

    result = await db.execute(
        select(EntityTransfer)
        .options(
            selectinload(EntityTransfer.entity),
            selectinload(EntityTransfer.to_user)
        )
        .where(
            EntityTransfer.from_user_id == current_user.id,
            EntityTransfer.cancelled_at.is_(None),
            EntityTransfer.cancel_deadline > datetime.utcnow()
        )
        .order_by(EntityTransfer.created_at.desc())
    )
    transfers = result.scalars().all()

    return [
        {
            "id": t.id,
            "entity_id": t.entity_id,
            "entity_name": t.entity.name if t.entity else None,
            "to_user_id": t.to_user_id,
            "to_user_name": t.to_user.name if t.to_user else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "cancel_deadline": t.cancel_deadline.isoformat() if t.cancel_deadline else None,
            "time_remaining_seconds": (t.cancel_deadline - datetime.utcnow()).total_seconds() if t.cancel_deadline else 0
        }
        for t in transfers
    ]
