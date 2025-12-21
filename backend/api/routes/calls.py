from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import aiofiles
import os
import uuid
import logging

from ..database import get_db
from ..models.database import (
    CallRecording, CallSource, CallStatus, Entity, User
)
from ..services.auth import get_current_user

router = APIRouter()
logger = logging.getLogger("hr-analyzer.calls")

# Upload directory for call recordings
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads/calls")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# === Pydantic Schemas ===

class CallCreate(BaseModel):
    entity_id: Optional[int] = None
    source_url: Optional[str] = None
    bot_name: str = "HR Recorder"


class StartBotRequest(BaseModel):
    source_url: str
    bot_name: str = "HR Recorder"
    entity_id: Optional[int] = None


class CallResponse(BaseModel):
    id: int
    entity_id: Optional[int] = None
    owner_id: Optional[int] = None
    source_type: CallSource
    source_url: Optional[str] = None
    bot_name: str
    status: CallStatus
    duration_seconds: Optional[int] = None
    transcript: Optional[str] = None
    summary: Optional[str] = None
    action_items: Optional[List[str]] = None
    key_points: Optional[List[str]] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None
    entity_name: Optional[str] = None

    class Config:
        from_attributes = True


# === Routes ===

@router.get("")
async def list_calls(
    entity_id: Optional[int] = None,
    status: Optional[CallStatus] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List call recordings"""
    query = select(CallRecording)

    if entity_id:
        query = query.where(CallRecording.entity_id == entity_id)
    if status:
        query = query.where(CallRecording.status == status)

    query = query.order_by(CallRecording.created_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    calls = result.scalars().all()

    response = []
    for call in calls:
        entity_name = None
        if call.entity_id:
            entity_result = await db.execute(
                select(Entity.name).where(Entity.id == call.entity_id)
            )
            entity_name = entity_result.scalar()

        response.append({
            "id": call.id,
            "entity_id": call.entity_id,
            "owner_id": call.owner_id,
            "source_type": call.source_type,
            "source_url": call.source_url,
            "bot_name": call.bot_name,
            "status": call.status,
            "duration_seconds": call.duration_seconds,
            "transcript": call.transcript[:500] if call.transcript else None,
            "summary": call.summary,
            "action_items": call.action_items,
            "key_points": call.key_points,
            "error_message": call.error_message,
            "created_at": call.created_at,
            "started_at": call.started_at,
            "ended_at": call.ended_at,
            "processed_at": call.processed_at,
            "entity_name": entity_name
        })

    return response


@router.post("/upload")
async def upload_call(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    entity_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload audio/video file for processing"""
    # Check format
    allowed_extensions = {'.mp3', '.mp4', '.wav', '.m4a', '.webm', '.ogg', '.mpeg'}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(400, f"Unsupported format. Allowed: {allowed_extensions}")

    # Save file
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")

    async with aiofiles.open(file_path, 'wb') as f:
        content = await file.read()
        await f.write(content)

    # Create record
    call = CallRecording(
        entity_id=entity_id,
        owner_id=current_user.id,
        source_type=CallSource.upload,
        status=CallStatus.processing,
        audio_file_path=file_path
    )
    db.add(call)
    await db.commit()
    await db.refresh(call)

    # Start background processing
    from ..services.call_processor import process_call_background
    background_tasks.add_task(process_call_background, call.id)

    logger.info(f"Call {call.id} uploaded and queued for processing")

    return {"id": call.id, "status": call.status.value}


@router.post("/start-bot")
async def start_bot(
    data: StartBotRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Start a bot to record a Meet/Zoom call"""
    # Determine source type by URL
    source_type = CallSource.meet
    if "zoom.us" in data.source_url:
        source_type = CallSource.zoom
    elif "meet.google.com" not in data.source_url:
        raise HTTPException(400, "Unsupported meeting URL. Use Google Meet or Zoom.")

    # Create record
    call = CallRecording(
        entity_id=data.entity_id,
        owner_id=current_user.id,
        source_type=source_type,
        source_url=data.source_url,
        bot_name=data.bot_name,
        status=CallStatus.pending
    )
    db.add(call)
    await db.commit()
    await db.refresh(call)

    # Start the recording bot via Redis queue
    try:
        from ..services.call_recorder import call_recorder
        await call_recorder.start_recording(call.id, data.source_url, data.bot_name)
        logger.info(f"Call {call.id} bot started for {data.source_url}")
    except Exception as e:
        logger.error(f"Failed to start bot for call {call.id}: {e}")
        call.status = CallStatus.failed
        call.error_message = str(e)
        await db.commit()
        raise HTTPException(500, f"Failed to start recording bot: {e}")

    return {"id": call.id, "status": call.status.value}


@router.get("/{call_id}")
async def get_call(
    call_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get call recording details"""
    result = await db.execute(
        select(CallRecording).where(CallRecording.id == call_id)
    )
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    entity_name = None
    if call.entity_id:
        entity_result = await db.execute(
            select(Entity.name).where(Entity.id == call.entity_id)
        )
        entity_name = entity_result.scalar()

    return {
        "id": call.id,
        "entity_id": call.entity_id,
        "owner_id": call.owner_id,
        "source_type": call.source_type,
        "source_url": call.source_url,
        "bot_name": call.bot_name,
        "status": call.status,
        "duration_seconds": call.duration_seconds,
        "audio_file_path": call.audio_file_path,
        "transcript": call.transcript,
        "speakers": call.speakers,
        "summary": call.summary,
        "action_items": call.action_items,
        "key_points": call.key_points,
        "error_message": call.error_message,
        "created_at": call.created_at,
        "started_at": call.started_at,
        "ended_at": call.ended_at,
        "processed_at": call.processed_at,
        "entity_name": entity_name
    }


@router.get("/{call_id}/status")
async def get_call_status(
    call_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get call status (for polling)"""
    result = await db.execute(
        select(
            CallRecording.status,
            CallRecording.duration_seconds,
            CallRecording.error_message
        ).where(CallRecording.id == call_id)
    )
    row = result.one_or_none()

    if not row:
        raise HTTPException(404, "Call not found")

    return {
        "status": row[0].value,
        "duration_seconds": row[1],
        "error_message": row[2]
    }


@router.post("/{call_id}/stop")
async def stop_recording(
    call_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Stop a recording"""
    result = await db.execute(
        select(CallRecording).where(CallRecording.id == call_id)
    )
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    if call.status != CallStatus.recording:
        raise HTTPException(400, "Call is not currently recording")

    # Send stop command
    try:
        from ..services.call_recorder import call_recorder
        await call_recorder.stop_recording(call_id)
        logger.info(f"Stop command sent for call {call_id}")
    except Exception as e:
        logger.error(f"Failed to stop call {call_id}: {e}")
        raise HTTPException(500, f"Failed to stop recording: {e}")

    return {"success": True}


@router.delete("/{call_id}")
async def delete_call(
    call_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a call recording"""
    result = await db.execute(
        select(CallRecording).where(CallRecording.id == call_id)
    )
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    # Delete the audio file if it exists
    if call.audio_file_path and os.path.exists(call.audio_file_path):
        try:
            os.remove(call.audio_file_path)
        except Exception as e:
            logger.warning(f"Failed to delete audio file: {e}")

    await db.delete(call)
    await db.commit()
    return {"success": True}


@router.post("/{call_id}/link-entity/{entity_id}")
async def link_call_to_entity(
    call_id: int,
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Link a call recording to an entity"""
    # Verify entity exists
    entity_result = await db.execute(select(Entity).where(Entity.id == entity_id))
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Entity not found")

    # Get and update call
    call_result = await db.execute(select(CallRecording).where(CallRecording.id == call_id))
    call = call_result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    call.entity_id = entity_id
    await db.commit()
    return {"success": True}


@router.post("/{call_id}/reprocess")
async def reprocess_call(
    call_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Re-process a failed call recording"""
    result = await db.execute(
        select(CallRecording).where(CallRecording.id == call_id)
    )
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    if not call.audio_file_path:
        raise HTTPException(400, "No audio file to process")

    # Reset status
    call.status = CallStatus.processing
    call.error_message = None
    await db.commit()

    # Start background processing
    from ..services.call_processor import process_call_background
    background_tasks.add_task(process_call_background, call.id)

    return {"success": True, "status": call.status.value}
