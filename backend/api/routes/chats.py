from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path
import json
import hashlib
import zipfile
import io
import re
import os
import shutil
from html.parser import HTMLParser

# Uploads directory for imported media
UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct, delete, and_, or_
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models.database import User, UserRole, Chat, Message, ChatCriteria, AIConversation, AnalysisHistory
from ..models.schemas import ChatResponse, ChatUpdate, ChatTypeConfig
from ..services.auth import get_current_user
from ..services.chat_types import (
    get_all_chat_types, get_chat_type_config, get_quick_actions,
    get_suggested_questions, get_default_criteria
)

router = APIRouter()


def can_access_chat(user: User, chat: Chat) -> bool:
    if user.role == UserRole.SUPERADMIN:
        return True
    return chat.owner_id == user.id


@router.get("/types", response_model=List[Dict[str, Any]])
async def get_chat_types():
    """Get all available chat types."""
    return get_all_chat_types()


@router.get("/types/{type_id}")
async def get_chat_type_details(type_id: str):
    """Get detailed configuration for a chat type."""
    config = get_chat_type_config(type_id)
    return {
        "type_info": {
            "id": type_id,
            "name": config["name"],
            "description": config["description"],
            "icon": config["icon"],
            "color": config["color"],
        },
        "quick_actions": get_quick_actions(type_id),
        "suggested_questions": get_suggested_questions(type_id),
        "default_criteria": get_default_criteria(type_id),
    }


@router.get("", response_model=List[ChatResponse])
async def get_chats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: str = Query(None),
    chat_type: str = Query(None, description="Filter by chat type"),
):
    # Merge detached user into current session
    user = await db.merge(user)

    query = select(Chat).options(selectinload(Chat.owner)).where(Chat.deleted_at.is_(None))
    if user.role != UserRole.SUPERADMIN:
        query = query.where(Chat.owner_id == user.id)
    if search:
        query = query.where(Chat.title.ilike(f"%{search}%"))
    if chat_type:
        query = query.where(Chat.chat_type == chat_type)
    query = query.order_by(Chat.last_activity.desc())

    result = await db.execute(query)
    chats = result.scalars().all()

    response = []
    for chat in chats:
        msg_count = await db.execute(
            select(func.count(Message.id)).where(Message.chat_id == chat.id)
        )
        part_count = await db.execute(
            select(func.count(distinct(Message.telegram_user_id))).where(Message.chat_id == chat.id)
        )
        has_crit = await db.execute(
            select(ChatCriteria.id).where(ChatCriteria.chat_id == chat.id)
        )

        response.append(ChatResponse(
            id=chat.id,
            telegram_chat_id=chat.telegram_chat_id,
            title=chat.title,
            custom_name=chat.custom_name,
            chat_type=chat.chat_type.value if chat.chat_type else "hr",
            custom_type_name=chat.custom_type_name,
            custom_type_description=chat.custom_type_description,
            owner_id=chat.owner_id,
            owner_name=chat.owner.name if chat.owner else None,
            is_active=chat.is_active,
            messages_count=msg_count.scalar() or 0,
            participants_count=part_count.scalar() or 0,
            last_activity=chat.last_activity,
            created_at=chat.created_at,
            has_criteria=has_crit.scalar() is not None,
        ))

    return response


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user = await db.merge(user)

    result = await db.execute(
        select(Chat).options(selectinload(Chat.owner)).where(
            Chat.id == chat_id,
            Chat.deleted_at.is_(None)
        )
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    msg_count = await db.execute(
        select(func.count(Message.id)).where(Message.chat_id == chat.id)
    )
    part_count = await db.execute(
        select(func.count(distinct(Message.telegram_user_id))).where(Message.chat_id == chat.id)
    )
    has_crit = await db.execute(
        select(ChatCriteria.id).where(ChatCriteria.chat_id == chat.id)
    )

    return ChatResponse(
        id=chat.id,
        telegram_chat_id=chat.telegram_chat_id,
        title=chat.title,
        custom_name=chat.custom_name,
        chat_type=chat.chat_type.value if chat.chat_type else "hr",
        custom_type_name=chat.custom_type_name,
        custom_type_description=chat.custom_type_description,
        owner_id=chat.owner_id,
        owner_name=chat.owner.name if chat.owner else None,
        is_active=chat.is_active,
        messages_count=msg_count.scalar() or 0,
        participants_count=part_count.scalar() or 0,
        last_activity=chat.last_activity,
        created_at=chat.created_at,
        has_criteria=has_crit.scalar() is not None,
    )


@router.patch("/{chat_id}", response_model=ChatResponse)
async def update_chat(
    chat_id: int,
    data: ChatUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from ..models.database import ChatType
    user = await db.merge(user)

    result = await db.execute(
        select(Chat).options(selectinload(Chat.owner)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    if data.custom_name is not None:
        chat.custom_name = data.custom_name
    if data.is_active is not None:
        chat.is_active = data.is_active
    if data.owner_id is not None and user.role == UserRole.SUPERADMIN:
        chat.owner_id = data.owner_id
    if data.chat_type is not None:
        try:
            chat.chat_type = ChatType(data.chat_type)
        except ValueError:
            chat.chat_type = ChatType.custom
    if data.custom_type_name is not None:
        chat.custom_type_name = data.custom_type_name
    if data.custom_type_description is not None:
        chat.custom_type_description = data.custom_type_description

    await db.commit()
    await db.refresh(chat)

    return ChatResponse(
        id=chat.id,
        telegram_chat_id=chat.telegram_chat_id,
        title=chat.title,
        custom_name=chat.custom_name,
        chat_type=chat.chat_type.value if chat.chat_type else "hr",
        custom_type_name=chat.custom_type_name,
        custom_type_description=chat.custom_type_description,
        owner_id=chat.owner_id,
        owner_name=chat.owner.name if chat.owner else None,
        is_active=chat.is_active,
        messages_count=0,
        participants_count=0,
        last_activity=chat.last_activity,
        created_at=chat.created_at,
        has_criteria=False,
    )


@router.delete("/{chat_id}/messages", status_code=204)
async def clear_messages(
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

    await db.execute(Message.__table__.delete().where(Message.chat_id == chat_id))
    await db.commit()


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Soft delete a chat (moves to trash for 30 days)."""
    user = await db.merge(user)

    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.deleted_at.is_(None)))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Soft delete - just set deleted_at timestamp
    chat.deleted_at = datetime.utcnow()
    await db.commit()


@router.get("/deleted/list", response_model=List[ChatResponse])
async def get_deleted_chats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get list of deleted chats (trash)."""
    user = await db.merge(user)

    query = select(Chat).options(selectinload(Chat.owner)).where(Chat.deleted_at.isnot(None))
    if user.role != UserRole.SUPERADMIN:
        query = query.where(Chat.owner_id == user.id)
    query = query.order_by(Chat.deleted_at.desc())

    result = await db.execute(query)
    chats = result.scalars().all()

    response = []
    for chat in chats:
        msg_count = await db.execute(
            select(func.count(Message.id)).where(Message.chat_id == chat.id)
        )
        days_left = 30 - (datetime.utcnow() - chat.deleted_at).days if chat.deleted_at else 30

        response.append(ChatResponse(
            id=chat.id,
            telegram_chat_id=chat.telegram_chat_id,
            title=chat.title,
            custom_name=chat.custom_name,
            chat_type=chat.chat_type.value if chat.chat_type else "hr",
            custom_type_name=chat.custom_type_name,
            custom_type_description=chat.custom_type_description,
            owner_id=chat.owner_id,
            owner_name=chat.owner.name if chat.owner else None,
            is_active=chat.is_active,
            messages_count=msg_count.scalar() or 0,
            participants_count=0,
            last_activity=chat.last_activity,
            created_at=chat.created_at,
            has_criteria=False,
            deleted_at=chat.deleted_at,
            days_until_permanent_delete=max(0, days_left),
        ))

    return response


@router.post("/{chat_id}/restore", status_code=200)
async def restore_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore a deleted chat from trash."""
    user = await db.merge(user)

    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.deleted_at.isnot(None)))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Deleted chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    chat.deleted_at = None
    await db.commit()
    return {"message": "Chat restored successfully"}


@router.delete("/{chat_id}/permanent", status_code=204)
async def permanent_delete_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete a chat (no recovery)."""
    user = await db.merge(user)

    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete all related data
    await db.execute(delete(Message).where(Message.chat_id == chat_id))
    await db.execute(delete(ChatCriteria).where(ChatCriteria.chat_id == chat_id))
    await db.execute(delete(AIConversation).where(AIConversation.chat_id == chat_id))
    await db.execute(delete(AnalysisHistory).where(AnalysisHistory.chat_id == chat_id))
    await db.delete(chat)
    await db.commit()


async def cleanup_old_deleted_chats(db: AsyncSession):
    """Delete chats that have been in trash for more than 30 days."""
    cutoff = datetime.utcnow() - timedelta(days=30)

    # Find old deleted chats
    result = await db.execute(
        select(Chat.id).where(Chat.deleted_at < cutoff)
    )
    old_chat_ids = [row[0] for row in result.fetchall()]

    for chat_id in old_chat_ids:
        await db.execute(delete(Message).where(Message.chat_id == chat_id))
        await db.execute(delete(ChatCriteria).where(ChatCriteria.chat_id == chat_id))
        await db.execute(delete(AIConversation).where(AIConversation.chat_id == chat_id))
        await db.execute(delete(AnalysisHistory).where(AnalysisHistory.chat_id == chat_id))
        await db.execute(delete(Chat).where(Chat.id == chat_id))

    await db.commit()
    return len(old_chat_ids)


def parse_telegram_date(date_str: str) -> datetime:
    """Parse Telegram export date format."""
    if not date_str:
        return datetime.now()

    # Strip timezone suffix like " UTC+03:00"
    if ' UTC' in date_str:
        date_str = date_str.split(' UTC')[0]

    # Try ISO format first: 2024-12-10T14:30:00
    try:
        return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except ValueError:
        pass

    # Try Russian format: DD.MM.YYYY HH:MM:SS
    try:
        if '.' in date_str and len(date_str.split('.')[0]) <= 2:
            return datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S')
    except ValueError:
        pass

    # Try other common formats
    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%d/%m/%Y %H:%M:%S',
        '%Y-%m-%dT%H:%M:%S',
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue

    # Fallback - return now (shouldn't happen often)
    return datetime.now()


def detect_content_type(msg: dict) -> str:
    """Detect message content type from Telegram export."""
    if msg.get('media_type') == 'voice_message':
        return 'voice'
    if msg.get('media_type') == 'video_message':
        return 'video_note'
    if msg.get('media_type') == 'sticker':
        return 'sticker'
    if 'photo' in msg:
        return 'photo'
    if 'file' in msg and msg.get('mime_type', '').startswith('video'):
        return 'video'
    if 'file' in msg:
        return 'document'
    return 'text'


def extract_text_content(msg: dict) -> str:
    """Extract text content from Telegram message."""
    text = msg.get('text', '')

    # Handle complex text (with formatting entities)
    if isinstance(text, list):
        parts = []
        for part in text:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(part.get('text', ''))
        text = ''.join(parts)

    # Add media type indicator if no text
    if not text:
        content_type = detect_content_type(msg)
        type_labels = {
            'voice': '[Голосовое сообщение]',
            'video_note': '[Видеосообщение]',
            'photo': '[Фото]',
            'video': '[Видео]',
            'sticker': '[Стикер]',
            'document': f'[Файл: {msg.get("file_name", "документ")}]',
        }
        text = type_labels.get(content_type, '[Медиа]')

    return text


def get_content_hash(content: str, timestamp: datetime) -> str:
    """Generate hash for deduplication when message_id is not available."""
    data = f"{content}:{timestamp.isoformat()}"
    return hashlib.md5(data.encode()).hexdigest()


class TelegramHTMLParser(HTMLParser):
    """
    Parser for Telegram Desktop HTML export format.

    HTML structure:
    - Message container: div.message.default (or div.message.default.joined for continuation)
    - Sender name: div.from_name (only in first message of a sequence)
    - Message body: div.body > div.text
    - Date: div.date (datetime in title attribute, format: "DD.MM.YYYY HH:MM:SS")
    - Media: div.media_wrap (photos, videos, etc.)

    Messages with class "joined" don't have from_name - they continue from previous sender.
    """

    def __init__(self):
        super().__init__()
        self.messages = []
        self.current_message = None
        self.last_sender = None  # Track last sender for "joined" messages
        self.in_from_name = False
        self.in_text = False
        self.in_media = False
        self.text_buffer = ""
        self.from_buffer = ""
        self.div_depth = 0  # Track div nesting to know when message ends
        self.message_div_depth = 0  # Depth where message div started
        self.is_joined = False
        self.media_type = None  # photo, video, sticker, video_note, voice

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        class_name = attrs_dict.get('class', '')
        classes = class_name.split() if class_name else []

        if tag == 'div':
            self.div_depth += 1

            # Check for message container: div.message.default
            if 'message' in classes and 'default' in classes:
                self.message_div_depth = self.div_depth
                self.is_joined = 'joined' in classes
                self.current_message = {
                    'id': None,
                    'from': self.last_sender if self.is_joined else None,
                    'date': '',
                    'text': '',
                    'has_media': False,
                    'media_file': None,  # Path to media file in export
                    'media_type': None,  # photo, video, sticker, video_note, voice
                    'type': 'message'
                }
                # Get message ID from id attribute (format: "message123")
                msg_id = attrs_dict.get('id', '')
                if msg_id.startswith('message'):
                    try:
                        self.current_message['id'] = int(msg_id[7:])
                    except ValueError:
                        pass

            elif self.current_message:
                # Check for from_name
                if 'from_name' in classes:
                    self.in_from_name = True
                    self.from_buffer = ""

                # Check for text content
                elif 'text' in classes:
                    self.in_text = True
                    self.text_buffer = ""

                # Check for media
                elif 'media_wrap' in classes or 'media' in classes:
                    self.in_media = True
                    self.current_message['has_media'] = True
                    # Detect media type from classes
                    if 'photo' in classes:
                        self.current_message['media_type'] = 'photo'
                    elif 'video' in classes:
                        self.current_message['media_type'] = 'video'
                    elif 'sticker' in classes:
                        self.current_message['media_type'] = 'sticker'

                # Check for date (datetime in title attribute)
                elif 'date' in classes:
                    title = attrs_dict.get('title', '')
                    if title:
                        self.current_message['date'] = title

        # Capture media file paths from a, img, video tags inside media div
        elif self.in_media and self.current_message:
            if tag == 'a':
                href = attrs_dict.get('href', '')
                if href and not href.startswith('#') and not href.startswith('http'):
                    self.current_message['media_file'] = href
                    # Detect type from file path
                    if 'photos/' in href or href.endswith(('.jpg', '.jpeg', '.png', '.webp')):
                        self.current_message['media_type'] = 'photo'
                    elif 'video_files/' in href or 'round_video' in href:
                        self.current_message['media_type'] = 'video_note'
                    elif 'videos/' in href or href.endswith(('.mp4', '.webm')):
                        self.current_message['media_type'] = 'video'
                    elif 'stickers/' in href or href.endswith('.webp'):
                        self.current_message['media_type'] = 'sticker'
                    elif 'voice_messages/' in href or href.endswith('.ogg'):
                        self.current_message['media_type'] = 'voice'
            elif tag == 'img':
                src = attrs_dict.get('src', '')
                if src and not src.startswith('http'):
                    self.current_message['media_file'] = src
                    if 'sticker' in src.lower():
                        self.current_message['media_type'] = 'sticker'
                    else:
                        self.current_message['media_type'] = 'photo'
            elif tag == 'video':
                src = attrs_dict.get('src', '')
                if src:
                    self.current_message['media_file'] = src
                    if 'round' in src.lower():
                        self.current_message['media_type'] = 'video_note'
                    else:
                        self.current_message['media_type'] = 'video'
            elif tag == 'source':
                src = attrs_dict.get('src', '')
                if src and not self.current_message.get('media_file'):
                    self.current_message['media_file'] = src

        # Handle links and other inline elements in text
        elif tag == 'a' and self.in_text:
            # Links are part of text, continue collecting
            pass

        elif tag == 'br' and self.in_text:
            self.text_buffer += '\n'

    def handle_endtag(self, tag):
        if tag == 'div':
            # Check if we're closing the message div
            if self.current_message and self.div_depth == self.message_div_depth:
                # Finalize the message
                if self.from_buffer.strip():
                    self.current_message['from'] = self.from_buffer.strip()
                    self.last_sender = self.from_buffer.strip()

                if self.text_buffer.strip():
                    self.current_message['text'] = self.text_buffer.strip()

                # Only save if we have sender (from current or previous)
                if self.current_message.get('from'):
                    self.messages.append(self.current_message)

                # Reset state
                self.current_message = None
                self.in_from_name = False
                self.in_text = False
                self.in_media = False
                self.text_buffer = ""
                self.from_buffer = ""
                self.is_joined = False

            self.div_depth -= 1

        # Reset from_name flag when its span/div closes
        elif tag in ('span', 'div') and self.in_from_name:
            self.in_from_name = False

    def handle_data(self, data):
        if self.in_from_name:
            self.from_buffer += data
        elif self.in_text:
            self.text_buffer += data


def parse_html_export(html_content: str) -> List[dict]:
    """Parse Telegram HTML export and return messages list."""
    parser = TelegramHTMLParser()
    try:
        parser.feed(html_content)
    except Exception as e:
        print(f"HTML parse error: {e}")
        return []

    import logging
    logger = logging.getLogger("hr-analyzer")

    messages = []
    for msg in parser.messages:
        # Skip if no sender
        if not msg.get('from'):
            continue

        # Parse date (format: "DD.MM.YYYY HH:MM:SS" or "DD.MM.YYYY HH:MM:SS UTC+03:00")
        date_str = msg.get('date', '')

        # Strip timezone suffix like " UTC+03:00"
        if ' UTC' in date_str:
            date_str = date_str.split(' UTC')[0]

        logger.info(f"HTML Parser - cleaned date string: '{date_str}'")

        try:
            if '.' in date_str and len(date_str.split('.')[0]) <= 2:
                # Russian format: DD.MM.YYYY HH:MM:SS
                parsed_date = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S')
                logger.info(f"HTML Parser - parsed as DD.MM.YYYY: {parsed_date}")
            elif 'T' in date_str:
                # ISO format
                parsed_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                logger.info(f"HTML Parser - parsed as ISO: {parsed_date}")
            else:
                parsed_date = datetime.now()
                logger.warning(f"HTML Parser - using datetime.now() for unknown format: '{date_str}'")
        except (ValueError, AttributeError) as e:
            parsed_date = datetime.now()
            logger.error(f"HTML Parser - date parse error for '{date_str}': {e}")

        # Determine text content and media type
        text = msg.get('text', '').strip()
        media_file = msg.get('media_file')
        media_type = msg.get('media_type')

        if not text and msg.get('has_media'):
            # Set appropriate placeholder based on media type
            if media_type == 'photo':
                text = '[Фото]'
            elif media_type == 'video_note':
                text = '[Видео-кружок]'
            elif media_type == 'video':
                text = '[Видео]'
            elif media_type == 'sticker':
                text = '[Стикер]'
            elif media_type == 'voice':
                text = '[Голосовое сообщение]'
            else:
                text = '[Медиа]'
        elif not text:
            continue  # Skip empty messages

        messages.append({
            'id': msg.get('id'),
            'type': 'message',
            'date': parsed_date.isoformat(),
            'from': msg.get('from'),
            'from_id': '',
            'text': text,
            'media_file': media_file,  # Path to media file in export
            'media_type': media_type   # photo, video, sticker, video_note, voice
        })

    return messages


@router.post("/{chat_id}/import")
async def import_telegram_history(
    chat_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Import chat history from Telegram Desktop export (JSON, HTML or ZIP format).

    Expected format: result.json, messages.html or ZIP archive containing them
    """
    import logging
    logger = logging.getLogger("hr-analyzer")

    user = await db.merge(user)

    # Check chat exists and user has access
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.deleted_at.is_(None)))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    # Read file content
    messages_data = None
    is_html_source = False  # Track if data came from HTML parser
    filename = file.filename.lower() if file.filename else ""

    logger.info(f"Import started for chat {chat_id}, file: {filename}")

    try:
        content = await file.read()
        logger.info(f"File size: {len(content)} bytes")

        # Variables for ZIP file handling
        zip_file = None
        zip_bytes = None

        # Check if it's a ZIP file
        if filename.endswith('.zip'):
            try:
                zip_bytes = io.BytesIO(content)
                zip_file = zipfile.ZipFile(zip_bytes)

                # First try to find JSON file
                target_file = None
                is_html = False

                file_list = zip_file.namelist()
                logger.info(f"ZIP contents: {file_list}")

                for name in file_list:
                    if name.endswith('result.json') or name == 'result.json':
                        target_file = name
                        break

                if not target_file:
                    for name in file_list:
                        if name.endswith('.json'):
                            target_file = name
                            break

                # If no JSON, try HTML
                if not target_file:
                    for name in file_list:
                        if name.endswith('.html') or name.endswith('.htm'):
                            target_file = name
                            is_html = True
                            break

                if not target_file:
                    zip_file.close()
                    raise HTTPException(status_code=400, detail="ZIP-архив не содержит JSON или HTML файл")

                logger.info(f"Using file from ZIP: {target_file}, is_html: {is_html}")
                file_content = zip_file.read(target_file).decode('utf-8')

                if is_html:
                    messages_data = parse_html_export(file_content)
                    is_html_source = True
                    logger.info(f"HTML parsed, got {len(messages_data)} messages")
                else:
                    data = json.loads(file_content)
                    messages_data = data.get('messages', [])
                    logger.info(f"JSON parsed, got {len(messages_data)} messages")

            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="Повреждённый ZIP-архив")

        # Check if it's an HTML file
        elif filename.endswith('.html') or filename.endswith('.htm'):
            html_content = content.decode('utf-8')
            messages_data = parse_html_export(html_content)
            is_html_source = True
            logger.info(f"HTML file parsed, got {len(messages_data)} messages")

        # Regular JSON file
        else:
            data = json.loads(content.decode('utf-8'))
            messages_data = data.get('messages', [])
            logger.info(f"JSON file parsed, got {len(messages_data)} messages")

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        raise HTTPException(status_code=400, detail=f"Неверный формат JSON: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File read error: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Ошибка чтения файла: {str(e)}")

    # Validate structure
    if not messages_data:
        raise HTTPException(status_code=400, detail="Файл не содержит сообщений")

    # Get existing message IDs and hashes for deduplication
    existing_result = await db.execute(
        select(Message.telegram_message_id, Message.content, Message.timestamp)
        .where(Message.chat_id == chat_id)
    )
    existing_messages = existing_result.fetchall()

    existing_msg_ids = {row[0] for row in existing_messages if row[0] is not None}
    existing_hashes = {get_content_hash(row[1], row[2]) for row in existing_messages}

    imported_count = 0
    skipped_count = 0
    errors = []

    for msg in messages_data:
        try:
            # Skip service messages
            if msg.get('type') != 'message':
                continue

            telegram_msg_id = msg.get('id')

            # Check for duplicates by message_id
            if telegram_msg_id and telegram_msg_id in existing_msg_ids:
                skipped_count += 1
                continue

            # Handle differently based on source
            file_path = None  # For imported media files

            if is_html_source:
                # HTML parser already extracted text in 'text' field
                content = msg.get('text', '')
                content_type = msg.get('media_type') or 'text'
                timestamp = parse_telegram_date(msg.get('date', ''))
                from_name = msg.get('from', 'Unknown')
                from_id = msg.get('from_id', '')

                # Extract media file from ZIP if available
                media_file = msg.get('media_file')
                if media_file and zip_file:
                    try:
                        # Create uploads directory for this chat
                        chat_uploads_dir = UPLOADS_DIR / str(chat_id)
                        chat_uploads_dir.mkdir(parents=True, exist_ok=True)

                        # Try to find the file in ZIP (might have different path prefix)
                        file_found = False
                        for zip_path in zip_file.namelist():
                            if zip_path.endswith(media_file) or media_file in zip_path:
                                # Extract and save the file
                                file_data = zip_file.read(zip_path)
                                # Create a unique filename
                                safe_name = os.path.basename(media_file)
                                if telegram_msg_id:
                                    safe_name = f"{telegram_msg_id}_{safe_name}"
                                dest_path = chat_uploads_dir / safe_name
                                dest_path.write_bytes(file_data)
                                file_path = f"uploads/{chat_id}/{safe_name}"
                                file_found = True
                                logger.info(f"Extracted media: {zip_path} -> {file_path}")
                                break

                        if not file_found:
                            logger.warning(f"Media file not found in ZIP: {media_file}")
                    except Exception as e:
                        logger.error(f"Error extracting media {media_file}: {e}")
            else:
                # JSON format - use original extract functions
                timestamp = parse_telegram_date(msg.get('date', ''))
                content = extract_text_content(msg)
                content_type = detect_content_type(msg)
                from_name = msg.get('from', 'Unknown')
                from_id = msg.get('from_id', '')

            # Check for duplicates by content hash (when no message_id)
            content_hash = get_content_hash(content, timestamp)
            if content_hash in existing_hashes:
                skipped_count += 1
                continue

            # Parse telegram user ID from string like "user123456"
            telegram_user_id = 0
            if isinstance(from_id, str) and from_id.startswith('user'):
                try:
                    telegram_user_id = int(from_id[4:])
                except ValueError:
                    pass
            elif isinstance(from_id, int):
                telegram_user_id = from_id

            # Split name into first/last name
            name_parts = from_name.split(' ', 1) if from_name else ['Unknown']
            first_name = (name_parts[0] if name_parts else 'Unknown')[:255]  # Truncate to 255
            last_name = (name_parts[1] if len(name_parts) > 1 else None)
            if last_name:
                last_name = last_name[:255]  # Truncate to 255

            # Truncate file_name if too long
            file_name = msg.get('file_name')
            if file_name:
                file_name = file_name[:255]

            # Create message
            new_message = Message(
                chat_id=chat_id,
                telegram_message_id=telegram_msg_id,
                telegram_user_id=telegram_user_id,
                username=None,  # Not available in export
                first_name=first_name,
                last_name=last_name,
                content=content,
                content_type=content_type[:50] if content_type else 'text',  # Truncate to 50
                file_id=None,  # Telegram Bot API file_id (not available in export)
                file_path=file_path,  # Local file path for imported media
                file_name=file_name,
                is_imported=True,  # Mark as imported from file
                timestamp=timestamp,
            )

            db.add(new_message)
            existing_msg_ids.add(telegram_msg_id)
            existing_hashes.add(content_hash)
            imported_count += 1

        except Exception as e:
            logger.error(f"Error importing message {msg.get('id', '?')}: {e}")
            errors.append(f"Message {msg.get('id', '?')}: {str(e)}")
            continue

    # Close ZIP file if open
    if zip_file:
        try:
            zip_file.close()
        except Exception:
            pass

    # Update chat's last_activity if we imported newer messages
    if imported_count > 0:
        await db.commit()
        logger.info(f"Imported {imported_count} messages, skipped {skipped_count}")

        # Get the latest message timestamp
        latest_result = await db.execute(
            select(func.max(Message.timestamp)).where(Message.chat_id == chat_id)
        )
        latest_timestamp = latest_result.scalar()
        if latest_timestamp and (not chat.last_activity or latest_timestamp > chat.last_activity):
            chat.last_activity = latest_timestamp
            await db.commit()

    return {
        "success": True,
        "imported": imported_count,
        "skipped": skipped_count,
        "errors": errors[:10] if errors else [],  # Return first 10 errors
        "total_errors": len(errors),
    }


@router.delete("/{chat_id}/import/cleanup")
async def cleanup_bad_import(
    chat_id: int,
    mode: str = Query("bad", description="Cleanup mode: 'bad' for Unknown/[Медиа], 'today' for messages with today's date, 'all_imported' for all without telegram_message_id"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Delete badly imported messages.

    Modes:
    - bad: Delete messages with Unknown sender and [Медиа] content
    - today: Delete messages with today's timestamp (wrong date import)
    - all_imported: Delete all messages without telegram_message_id (imported from file)
    """
    user = await db.merge(user)

    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.deleted_at.is_(None)))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not can_access_chat(user, chat):
        raise HTTPException(status_code=403, detail="Access denied")

    deleted_count = 0

    if mode == "bad":
        # Delete messages with Unknown sender and [Медиа] content
        delete_result = await db.execute(
            delete(Message).where(
                Message.chat_id == chat_id,
                Message.first_name == 'Unknown',
                Message.content == '[Медиа]'
            )
        )
        deleted_count = delete_result.rowcount

    elif mode == "today":
        # Delete messages with today's timestamp (likely wrong date import)
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        delete_result = await db.execute(
            delete(Message).where(
                Message.chat_id == chat_id,
                Message.timestamp >= today_start
            )
        )
        deleted_count = delete_result.rowcount

    elif mode == "all_imported":
        # Delete all messages without file_id (imported from file, not from bot)
        # Bot messages have file_id, imported messages don't
        delete_result = await db.execute(
            delete(Message).where(
                Message.chat_id == chat_id,
                Message.file_id.is_(None)
            )
        )
        deleted_count = delete_result.rowcount

    elif mode == "all":
        # Delete all imported messages (is_imported=True)
        delete_result = await db.execute(
            delete(Message).where(
                Message.chat_id == chat_id,
                Message.is_imported == True
            )
        )
        deleted_count = delete_result.rowcount

    elif mode == "clear_all":
        # Delete ALL messages in the chat (nuclear option)
        delete_result = await db.execute(
            delete(Message).where(Message.chat_id == chat_id)
        )
        deleted_count = delete_result.rowcount

    await db.commit()

    return {
        "success": True,
        "deleted": deleted_count,
        "mode": mode,
    }
