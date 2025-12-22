from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import aiofiles
import os
import uuid
import logging
import re

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
    title: Optional[str] = None


class StartBotRequest(BaseModel):
    source_url: str
    bot_name: str = "HR Recorder"
    entity_id: Optional[int] = None
    title: Optional[str] = None


class CallUpdateRequest(BaseModel):
    title: Optional[str] = None
    entity_id: Optional[int] = None  # Use -1 to unlink


class CallResponse(BaseModel):
    id: int
    title: Optional[str] = None
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
            "title": call.title,
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
    url_lower = data.source_url.lower()
    if "zoom.us" in url_lower or "zoom.com" in url_lower:
        source_type = CallSource.zoom
    elif "teams.microsoft.com" in url_lower or "teams.live.com" in url_lower:
        source_type = CallSource.teams
    elif "meet.google.com" not in url_lower:
        raise HTTPException(400, "Unsupported meeting URL. Use Google Meet, Zoom, or Microsoft Teams.")

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

    # Start the recording bot via Fireflies
    try:
        from ..services.call_recorder import call_recorder
        result = await call_recorder.start_recording(call.id, data.source_url, data.bot_name)

        if not result.get("success"):
            error_msg = result.get("message", "Fireflies API error")
            logger.error(f"Fireflies rejected call {call.id}: {error_msg}")
            call.status = CallStatus.failed
            call.error_message = error_msg
            await db.commit()
            raise HTTPException(500, f"Fireflies error: {error_msg}")

        # Update status to connecting (bot is joining the meeting)
        call.status = CallStatus.connecting
        await db.commit()
        logger.info(f"Call {call.id} Fireflies bot dispatched for {data.source_url}")

    except HTTPException:
        raise
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
        "title": call.title,
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


@router.patch("/{call_id}")
async def update_call(
    call_id: int,
    data: CallUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update call recording (title, entity link)"""
    result = await db.execute(
        select(CallRecording).where(CallRecording.id == call_id)
    )
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(404, "Call not found")

    # Update title if provided
    if data.title is not None:
        call.title = data.title if data.title else None

    # Update entity link
    if data.entity_id is not None:
        if data.entity_id == -1:
            # Unlink entity
            call.entity_id = None
        else:
            # Verify entity exists
            entity_result = await db.execute(
                select(Entity).where(Entity.id == data.entity_id)
            )
            entity = entity_result.scalar_one_or_none()
            if not entity:
                raise HTTPException(404, "Entity not found")
            call.entity_id = data.entity_id

    await db.commit()
    await db.refresh(call)

    # Get entity name for response
    entity_name = None
    if call.entity_id:
        entity_result = await db.execute(
            select(Entity.name).where(Entity.id == call.entity_id)
        )
        entity_name = entity_result.scalar()

    return {
        "id": call.id,
        "title": call.title,
        "entity_id": call.entity_id,
        "entity_name": entity_name,
        "success": True
    }


# === Fireflies Webhook ===

@router.post("/fireflies-webhook")
async def fireflies_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Webhook endpoint for Fireflies.ai notifications.

    Fireflies sends this when transcription is completed:
    {
        "meetingId": "abc123",           # Fireflies transcript ID
        "eventType": "Transcription completed",
        "clientReferenceId": null        # Only for uploadAudio
    }

    We identify our call by parsing the title "HR Call #123"
    which Fireflies returns in the transcript.
    """
    try:
        data = await request.json()
        logger.info(f"Fireflies webhook received: {data}")

        meeting_id = data.get("meetingId")
        event_type = data.get("eventType", "")

        # Only process transcription completed events
        if "completed" not in event_type.lower():
            logger.info(f"Ignoring Fireflies event: {event_type}")
            return {"status": "ignored", "reason": f"event_type: {event_type}"}

        if not meeting_id:
            logger.warning("Fireflies webhook missing meetingId")
            return {"status": "error", "reason": "missing_meeting_id"}

        # Fetch transcript from Fireflies to get the title
        from ..services.fireflies_client import fireflies_client

        transcript = await fireflies_client.get_transcript(meeting_id)
        if not transcript:
            logger.error(f"Could not fetch transcript {meeting_id} from Fireflies")
            return {"status": "error", "reason": "transcript_not_found"}

        title = transcript.get("title", "")
        logger.info(f"Fireflies transcript title: {title}")

        # Extract call_id from title "HR Call #123"
        call_id = None
        match = re.search(r"HR Call #(\d+)", title)
        if match:
            call_id = int(match.group(1))
        else:
            # Try to find by meeting URL or just log
            logger.warning(f"Could not extract call_id from title: {title}")
            return {"status": "ignored", "reason": "unknown_meeting", "title": title}

        # Get call from database
        result = await db.execute(
            select(CallRecording).where(CallRecording.id == call_id)
        )
        call = result.scalar_one_or_none()

        if not call:
            logger.error(f"Call {call_id} not found in database")
            return {"status": "error", "reason": "call_not_found", "call_id": call_id}

        # Update call with Fireflies transcript ID
        call.fireflies_transcript_id = meeting_id
        call.status = CallStatus.processing
        await db.commit()

        logger.info(f"Processing Fireflies transcript for call {call_id}")

        # Process transcript in background
        background_tasks.add_task(
            process_fireflies_transcript,
            call_id,
            transcript
        )

        return {"status": "ok", "call_id": call_id, "transcript_id": meeting_id}

    except Exception as e:
        logger.exception(f"Error processing Fireflies webhook: {e}")
        return {"status": "error", "reason": str(e)}


async def process_fireflies_transcript(call_id: int, transcript: dict):
    """
    Process Fireflies transcript: format speakers, analyze with Claude, save results.
    """
    from ..database import AsyncSessionLocal
    from ..services.call_processor import call_processor

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(CallRecording).where(CallRecording.id == call_id)
            )
            call = result.scalar_one_or_none()

            if not call:
                logger.error(f"Call {call_id} not found for processing")
                return

            # Format transcript with speaker labels
            sentences = transcript.get("sentences", [])
            speakers = transcript.get("speakers", [])
            duration = transcript.get("duration", 0)
            summary_data = transcript.get("summary", {})

            # Build formatted transcript text
            formatted_lines = []
            speaker_segments = []

            for sentence in sentences:
                speaker_name = sentence.get("speaker_name") or f"Speaker {sentence.get('speaker_id', '?')}"
                text = sentence.get("text", "")
                start_time = sentence.get("start_time", 0)
                end_time = sentence.get("end_time", 0)

                # Format timestamp
                start_min = int(start_time // 60)
                start_sec = int(start_time % 60)
                timestamp = f"[{start_min:02d}:{start_sec:02d}]"

                formatted_lines.append(f"{timestamp} {speaker_name}: {text}")

                # Store speaker segment for JSON
                speaker_segments.append({
                    "speaker": speaker_name,
                    "start": start_time,
                    "end": end_time,
                    "text": text
                })

            formatted_transcript = "\n".join(formatted_lines)

            # Update call with transcript data
            call.transcript = formatted_transcript
            call.speakers = speaker_segments
            call.duration_seconds = duration
            call.status = CallStatus.analyzing

            # Use Fireflies summary if available, otherwise analyze with Claude
            if summary_data.get("overview"):
                call.summary = summary_data.get("overview") or summary_data.get("short_summary", "")
                call.action_items = summary_data.get("action_items", [])
                call.key_points = summary_data.get("keywords", [])
                call.status = CallStatus.done
                call.processed_at = datetime.utcnow()
                call.ended_at = datetime.utcnow()
                await db.commit()
                logger.info(f"Call {call_id} processed with Fireflies summary")
            else:
                # Analyze with Claude
                await db.commit()
                await call_processor.analyze_transcript(call_id, formatted_transcript, speaker_segments)

    except Exception as e:
        logger.exception(f"Error processing transcript for call {call_id}: {e}")

        # Mark as failed
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(CallRecording).where(CallRecording.id == call_id)
                )
                call = result.scalar_one_or_none()
                if call:
                    call.status = CallStatus.failed
                    call.error_message = str(e)
                    await db.commit()
        except Exception as db_error:
            logger.error(f"Failed to update call status: {db_error}")
