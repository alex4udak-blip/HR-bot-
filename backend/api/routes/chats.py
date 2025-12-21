from datetime import datetime, timedelta
from typing import List, Dict, Any
import json
import hashlib
import zipfile
import io
import re
from html.parser import HTMLParser
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
    # Telegram uses ISO format: 2024-12-10T14:30:00
    try:
        return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except ValueError:
        # Fallback for other formats
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
    """Parser for Telegram HTML export format."""

    def __init__(self):
        super().__init__()
        self.messages = []
        self.current_message = None
        self.current_field = None
        self.text_buffer = ""
        self.in_message = False
        self.in_body = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        class_name = attrs_dict.get('class', '')

        if 'message' in class_name and 'default' in class_name:
            self.in_message = True
            self.current_message = {
                'id': None,
                'from': 'Unknown',
                'date': '',
                'text': '',
                'type': 'message'
            }
            # Try to get message ID from id attribute
            if 'id' in attrs_dict:
                msg_id = attrs_dict['id'].replace('message', '')
                try:
                    self.current_message['id'] = int(msg_id)
                except ValueError:
                    pass

        elif self.in_message:
            if 'from_name' in class_name:
                self.current_field = 'from'
                self.text_buffer = ""
            elif 'date' in class_name:
                self.current_field = 'date'
                # Get title attribute for full datetime
                if 'title' in attrs_dict:
                    self.current_message['date'] = attrs_dict['title']
            elif 'text' in class_name:
                self.current_field = 'text'
                self.text_buffer = ""
            elif 'media_wrap' in class_name:
                self.current_field = 'media'
            elif 'body' in class_name:
                self.in_body = True

    def handle_endtag(self, tag):
        if self.current_field == 'from' and tag in ['span', 'div']:
            if self.current_message:
                self.current_message['from'] = self.text_buffer.strip()
            self.current_field = None
        elif self.current_field == 'text' and tag == 'div':
            if self.current_message:
                self.current_message['text'] = self.text_buffer.strip()
            self.current_field = None

        if tag == 'div' and self.in_message and self.in_body:
            if self.current_message and (self.current_message.get('text') or self.current_message.get('from')):
                self.messages.append(self.current_message)
            self.current_message = None
            self.in_message = False
            self.in_body = False

    def handle_data(self, data):
        if self.current_field in ['from', 'text']:
            self.text_buffer += data


def parse_html_export(html_content: str) -> List[dict]:
    """Parse Telegram HTML export and return messages list."""
    parser = TelegramHTMLParser()
    parser.feed(html_content)

    messages = []
    for msg in parser.messages:
        if not msg.get('text') and not msg.get('from'):
            continue

        # Parse date
        date_str = msg.get('date', '')
        try:
            # Try common formats: "DD.MM.YYYY HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
            if '.' in date_str and len(date_str.split('.')[0]) <= 2:
                parsed_date = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S')
            else:
                parsed_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            parsed_date = datetime.now()

        messages.append({
            'id': msg.get('id'),
            'type': 'message',
            'date': parsed_date.isoformat(),
            'from': msg.get('from', 'Unknown'),
            'from_id': '',
            'text': msg.get('text', '')
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
    filename = file.filename.lower() if file.filename else ""

    try:
        content = await file.read()

        # Check if it's a ZIP file
        if filename.endswith('.zip'):
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    # First try to find JSON file
                    target_file = None
                    is_html = False

                    for name in zf.namelist():
                        if name.endswith('result.json') or name == 'result.json':
                            target_file = name
                            break

                    if not target_file:
                        for name in zf.namelist():
                            if name.endswith('.json'):
                                target_file = name
                                break

                    # If no JSON, try HTML
                    if not target_file:
                        for name in zf.namelist():
                            if name.endswith('.html') or name.endswith('.htm'):
                                target_file = name
                                is_html = True
                                break

                    if not target_file:
                        raise HTTPException(status_code=400, detail="ZIP-архив не содержит JSON или HTML файл")

                    file_content = zf.read(target_file).decode('utf-8')

                    if is_html:
                        messages_data = parse_html_export(file_content)
                    else:
                        data = json.loads(file_content)
                        messages_data = data.get('messages', [])

            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="Повреждённый ZIP-архив")

        # Check if it's an HTML file
        elif filename.endswith('.html') or filename.endswith('.htm'):
            html_content = content.decode('utf-8')
            messages_data = parse_html_export(html_content)

        # Regular JSON file
        else:
            data = json.loads(content.decode('utf-8'))
            messages_data = data.get('messages', [])

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Неверный формат JSON: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
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

            # Parse message data
            timestamp = parse_telegram_date(msg.get('date', ''))
            content = extract_text_content(msg)
            content_type = detect_content_type(msg)

            # Check for duplicates by content hash (when no message_id)
            content_hash = get_content_hash(content, timestamp)
            if content_hash in existing_hashes:
                skipped_count += 1
                continue

            # Extract user info
            from_name = msg.get('from', 'Unknown')
            from_id = msg.get('from_id', '')

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
            name_parts = from_name.split(' ', 1)
            first_name = name_parts[0] if name_parts else 'Unknown'
            last_name = name_parts[1] if len(name_parts) > 1 else None

            # Create message
            new_message = Message(
                chat_id=chat_id,
                telegram_message_id=telegram_msg_id,
                telegram_user_id=telegram_user_id,
                username=None,  # Not available in export
                first_name=first_name,
                last_name=last_name,
                content=content,
                content_type=content_type,
                file_id=None,  # Files not imported
                file_name=msg.get('file_name'),
                timestamp=timestamp,
            )

            db.add(new_message)
            existing_msg_ids.add(telegram_msg_id)
            existing_hashes.add(content_hash)
            imported_count += 1

        except Exception as e:
            errors.append(f"Message {msg.get('id', '?')}: {str(e)}")
            continue

    # Update chat's last_activity if we imported newer messages
    if imported_count > 0:
        await db.commit()

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
