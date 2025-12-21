from typing import List
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import httpx

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message
from ..models.schemas import MessageResponse, ParticipantResponse
from ..services.auth import get_current_user, get_current_user_optional, get_user_from_token
from ..services.transcription import transcription_service
from ..config import settings

# Uploads directory for imported media
UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


@router.get("/{chat_id}/messages", response_model=List[MessageResponse])
async def get_messages(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    limit: int = Query(1000, le=2000),
    content_type: str = Query(None),
):
    user = await db.merge(user)
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    query = select(Message).where(Message.chat_id == chat_id)
    if content_type and content_type != "all":
        query = query.where(Message.content_type == content_type)

    query = query.order_by(Message.timestamp.desc()).offset((page - 1) * limit).limit(limit)

    result = await db.execute(query)
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=m.id,
            telegram_user_id=m.telegram_user_id,
            username=m.username,
            first_name=m.first_name,
            last_name=m.last_name,
            content=m.content,
            content_type=m.content_type,
            file_id=m.file_id,
            file_path=m.file_path,
            file_name=m.file_name,
            document_metadata=m.document_metadata,
            parse_status=m.parse_status,
            parse_error=m.parse_error,
            timestamp=m.timestamp,
        ) for m in reversed(messages)
    ]


@router.get("/{chat_id}/participants", response_model=List[ParticipantResponse])
async def get_participants(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(
            Message.telegram_user_id,
            Message.username,
            Message.first_name,
            Message.last_name,
            func.count(Message.id).label("count")
        )
        .where(Message.chat_id == chat_id)
        .group_by(
            Message.telegram_user_id,
            Message.username,
            Message.first_name,
            Message.last_name
        )
        .order_by(func.count(Message.id).desc())
    )
    participants = result.all()

    return [
        ParticipantResponse(
            telegram_user_id=p.telegram_user_id,
            username=p.username,
            first_name=p.first_name,
            last_name=p.last_name,
            messages_count=p.count,
        ) for p in participants
    ]


@router.get("/file/{file_id}")
async def get_telegram_file(
    file_id: str,
    token: str = Query(None, description="Auth token for img/video tags"),
    user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """
    Proxy Telegram file downloads.

    Supports two auth methods:
    - Authorization header (for fetch requests)
    - Query param ?token=xxx (for img/video tags that can't send headers)
    """
    # Check auth - either from header or query param
    if not user and token:
        user = await get_user_from_token(token, db)

    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=500, detail="Bot token not configured")

    try:
        async with httpx.AsyncClient() as client:
            # Get file path from Telegram
            response = await client.get(
                f"https://api.telegram.org/bot{settings.telegram_bot_token}/getFile",
                params={"file_id": file_id}
            )
            data = response.json()

            if not data.get("ok"):
                raise HTTPException(status_code=404, detail="File not found")

            file_path = data["result"]["file_path"]

            # Download file from Telegram
            file_url = f"https://api.telegram.org/file/bot{settings.telegram_bot_token}/{file_path}"
            file_response = await client.get(file_url)

            if file_response.status_code != 200:
                raise HTTPException(status_code=404, detail="File download failed")

            # Determine content type
            content_type = "application/octet-stream"
            if file_path.endswith(('.jpg', '.jpeg')):
                content_type = "image/jpeg"
            elif file_path.endswith('.png'):
                content_type = "image/png"
            elif file_path.endswith('.gif'):
                content_type = "image/gif"
            elif file_path.endswith('.webp'):
                content_type = "image/webp"
            elif file_path.endswith('.webm'):
                content_type = "video/webm"
            elif file_path.endswith('.mp4'):
                content_type = "video/mp4"
            elif file_path.endswith('.tgs'):
                content_type = "application/x-tgsticker"

            return StreamingResponse(
                iter([file_response.content]),
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400"}  # Cache for 24h
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Network error: {str(e)}")


@router.get("/local/{chat_id}/{filename:path}")
async def get_local_file(
    chat_id: int,
    filename: str,
    token: str = Query(None, description="Auth token for img/video tags"),
    user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """
    Serve locally stored imported media files.

    Supports two auth methods:
    - Authorization header (for fetch requests)
    - Query param ?token=xxx (for img/video tags that can't send headers)
    """
    # Check auth - either from header or query param
    if not user and token:
        user = await get_user_from_token(token, db)

    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Verify user has access to this chat
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id, Chat.deleted_at.is_(None))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Build file path and verify it exists
    file_path = UPLOADS_DIR / str(chat_id) / filename

    # Security: ensure path doesn't escape uploads directory
    try:
        file_path = file_path.resolve()
        if not str(file_path).startswith(str(UPLOADS_DIR.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine content type
    content_type = "application/octet-stream"
    suffix = file_path.suffix.lower()
    if suffix in ('.jpg', '.jpeg'):
        content_type = "image/jpeg"
    elif suffix == '.png':
        content_type = "image/png"
    elif suffix == '.gif':
        content_type = "image/gif"
    elif suffix == '.webp':
        content_type = "image/webp"
    elif suffix == '.webm':
        content_type = "video/webm"
    elif suffix == '.mp4':
        content_type = "video/mp4"
    elif suffix == '.ogg':
        content_type = "audio/ogg"

    return FileResponse(
        file_path,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"}  # Cache for 24h
    )


@router.post("/messages/{message_id}/transcribe")
async def transcribe_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Transcribe audio/video from an imported message.
    Updates the message content with the transcription.
    """
    user = await db.merge(user)

    # Get message
    result = await db.execute(select(Message).where(Message.id == message_id))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Verify user has access to the chat
    result = await db.execute(
        select(Chat).where(Chat.id == message.chat_id, Chat.deleted_at.is_(None))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get file bytes - either from local file or from Telegram
    file_bytes = None
    suffix = ''
    filename = None  # For transcription format detection

    if message.file_path:
        # Local file from import
        file_path = UPLOADS_DIR.parent / message.file_path
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Media file not found")
        file_bytes = file_path.read_bytes()
        suffix = file_path.suffix.lower()
        filename = message.file_path  # Full path for format detection
    elif message.file_id:
        # Telegram file - download via API
        import httpx
        from api.config import settings

        if not settings.telegram_bot_token:
            raise HTTPException(status_code=500, detail="Bot token not configured")

        try:
            async with httpx.AsyncClient() as client:
                # Get file path from Telegram
                response = await client.get(
                    f"https://api.telegram.org/bot{settings.telegram_bot_token}/getFile",
                    params={"file_id": message.file_id}
                )
                data = response.json()

                if not data.get("ok"):
                    raise HTTPException(status_code=404, detail="File not found on Telegram")

                tg_file_path = data["result"]["file_path"]
                suffix = f".{tg_file_path.split('.')[-1]}" if '.' in tg_file_path else ''
                filename = tg_file_path  # For format detection

                # Download file from Telegram
                file_url = f"https://api.telegram.org/file/bot{settings.telegram_bot_token}/{tg_file_path}"
                file_response = await client.get(file_url)

                if file_response.status_code != 200:
                    raise HTTPException(status_code=404, detail="File download failed")

                file_bytes = file_response.content
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Network error: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Message has no media file")

    # Determine if audio or video based on content_type or file extension
    is_video = message.content_type in ('video', 'video_note') or suffix in ('.mp4', '.webm')
    is_audio = message.content_type == 'voice' or suffix in ('.ogg', '.mp3', '.wav')

    if not is_video and not is_audio:
        raise HTTPException(status_code=400, detail="File is not audio or video")

    # Transcribe
    if is_video:
        transcription = await transcription_service.transcribe_video(file_bytes, filename)
    else:
        transcription = await transcription_service.transcribe_audio(file_bytes)

    # Update message content with transcription (keep original placeholder + add transcription)
    original_placeholder = message.content if message.content else ""
    if transcription and not transcription.startswith("["):
        # Successful transcription - replace placeholder with actual text
        message.content = transcription
    else:
        # Error or unavailable - append to placeholder
        message.content = f"{original_placeholder}\n{transcription}" if original_placeholder else transcription

    await db.commit()

    return {
        "success": True,
        "transcription": transcription,
        "message_id": message_id
    }


@router.post("/{chat_id}/transcribe-all")
async def transcribe_all_media(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Transcribe all untranscribed voice/video messages in a chat.
    Returns count of successfully transcribed messages.
    """
    import logging
    logger = logging.getLogger("hr-analyzer")

    user = await db.merge(user)

    # Verify user has access to the chat
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id, Chat.deleted_at.is_(None))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Find all messages that need transcription
    # - content_type is voice, video_note, or video
    # - has file_path or file_id
    # - content starts with placeholder (not yet transcribed)
    result = await db.execute(
        select(Message)
        .where(
            Message.chat_id == chat_id,
            Message.content_type.in_(['voice', 'video_note', 'video']),
            or_(Message.file_path.isnot(None), Message.file_id.isnot(None))
        )
    )
    messages = result.scalars().all()

    # Filter to only untranscribed messages
    untranscribed = []
    for msg in messages:
        if not msg.content:
            untranscribed.append(msg)
        elif msg.content.startswith('[') and (
            'Голосов' in msg.content or
            'Voice' in msg.content or
            'Видео' in msg.content or
            'Video' in msg.content or
            'transcription failed' in msg.content
        ):
            untranscribed.append(msg)

    logger.info(f"Found {len(untranscribed)} messages to transcribe in chat {chat_id}")

    transcribed_count = 0
    errors = []

    for msg in untranscribed:
        try:
            # Get file bytes
            file_bytes = None
            filename = None

            if msg.file_path:
                file_path = UPLOADS_DIR.parent / msg.file_path
                if file_path.exists():
                    file_bytes = file_path.read_bytes()
                    filename = msg.file_path
            elif msg.file_id:
                # Download from Telegram
                import httpx
                from api.config import settings

                if settings.telegram_bot_token:
                    async with httpx.AsyncClient() as client:
                        response = await client.get(
                            f"https://api.telegram.org/bot{settings.telegram_bot_token}/getFile",
                            params={"file_id": msg.file_id}
                        )
                        data = response.json()
                        if data.get("ok"):
                            tg_file_path = data["result"]["file_path"]
                            filename = tg_file_path
                            file_url = f"https://api.telegram.org/file/bot{settings.telegram_bot_token}/{tg_file_path}"
                            file_response = await client.get(file_url)
                            if file_response.status_code == 200:
                                file_bytes = file_response.content

            if not file_bytes:
                continue

            # Transcribe
            is_video = msg.content_type in ('video', 'video_note')
            if is_video:
                transcription = await transcription_service.transcribe_video(file_bytes, filename)
            else:
                transcription = await transcription_service.transcribe_audio(file_bytes)

            # Update message if successful
            if transcription and not transcription.startswith("["):
                msg.content = transcription
                transcribed_count += 1
                logger.info(f"Transcribed message {msg.id}: {transcription[:50]}...")

        except Exception as e:
            logger.error(f"Error transcribing message {msg.id}: {e}")
            errors.append(str(e))

    await db.commit()

    return {
        "success": True,
        "transcribed": transcribed_count,
        "total_found": len(untranscribed),
        "errors": len(errors)
    }
