from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from ..database import get_db
from ..models.database import User, UserRole, Chat, CriteriaPreset, ChatCriteria
from ..models.schemas import (
    CriteriaPresetCreate, CriteriaPresetResponse,
    ChatCriteriaUpdate, ChatCriteriaResponse
)
from ..services.auth import get_current_user

router = APIRouter()


# ============ PRESETS ============

@router.get("/presets", response_model=List[CriteriaPresetResponse])
async def get_presets(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Global presets + user's own presets
    query = select(CriteriaPreset).where(
        or_(
            CriteriaPreset.is_global == True,
            CriteriaPreset.created_by == user.id
        )
    ).order_by(CriteriaPreset.category, CriteriaPreset.name)

    result = await db.execute(query)
    presets = result.scalars().all()

    return [
        CriteriaPresetResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            criteria=p.criteria,
            category=p.category,
            is_global=p.is_global,
            created_by=p.created_by,
            created_at=p.created_at,
        ) for p in presets
    ]


@router.post("/presets", response_model=CriteriaPresetResponse, status_code=201)
async def create_preset(
    data: CriteriaPresetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Only superadmin can create global presets
    is_global = data.is_global and user.role == UserRole.SUPERADMIN

    preset = CriteriaPreset(
        name=data.name,
        description=data.description,
        criteria=[c.model_dump() for c in data.criteria],
        category=data.category,
        is_global=is_global,
        created_by=user.id,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)

    return CriteriaPresetResponse(
        id=preset.id,
        name=preset.name,
        description=preset.description,
        criteria=preset.criteria,
        category=preset.category,
        is_global=preset.is_global,
        created_by=preset.created_by,
        created_at=preset.created_at,
    )


@router.delete("/presets/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(CriteriaPreset).where(CriteriaPreset.id == preset_id))
    preset = result.scalar_one_or_none()

    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    # Only owner or superadmin can delete
    if preset.created_by != user.id and user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(preset)
    await db.commit()


# ============ CHAT CRITERIA ============

@router.get("/chats/{chat_id}", response_model=ChatCriteriaResponse)
async def get_chat_criteria(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Check access
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if user.role != UserRole.SUPERADMIN and chat.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(ChatCriteria).where(ChatCriteria.chat_id == chat_id))
    criteria = result.scalar_one_or_none()

    if not criteria:
        # Return empty criteria
        return ChatCriteriaResponse(
            id=0,
            chat_id=chat_id,
            criteria=[],
            updated_at=chat.created_at,
        )

    return ChatCriteriaResponse(
        id=criteria.id,
        chat_id=criteria.chat_id,
        criteria=criteria.criteria,
        updated_at=criteria.updated_at,
    )


@router.put("/chats/{chat_id}", response_model=ChatCriteriaResponse)
async def update_chat_criteria(
    chat_id: int,
    data: ChatCriteriaUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Check access
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if user.role != UserRole.SUPERADMIN and chat.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(ChatCriteria).where(ChatCriteria.chat_id == chat_id))
    criteria = result.scalar_one_or_none()

    criteria_data = [c.model_dump() for c in data.criteria]

    if criteria:
        criteria.criteria = criteria_data
    else:
        criteria = ChatCriteria(chat_id=chat_id, criteria=criteria_data)
        db.add(criteria)

    await db.commit()
    await db.refresh(criteria)

    return ChatCriteriaResponse(
        id=criteria.id,
        chat_id=criteria.chat_id,
        criteria=criteria.criteria,
        updated_at=criteria.updated_at,
    )
