import asyncio
import logging
import re
from datetime import datetime
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, ChatMemberUpdatedFilter, IS_NOT_MEMBER, IS_MEMBER
from aiogram.types import ChatMemberUpdated, ContentType, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from .config import settings
from .models.database import (
    Base, User, Chat, Message, ChatType, OrgMember,
    Project, ProjectTask, ProjectMember, Department, DepartmentMember,
    ProjectStatus, TaskStatus,
)
from sqlalchemy.orm import selectinload
from .services.transcription import transcription_service
from .utils.db_url import get_database_url
from .services.documents import document_parser
from .services.external_links import external_link_processor, LinkType
from .services.task_trigger import create_tasks_from_message, update_projects_from_status

# Bot logging
logger = logging.getLogger("hr-analyzer.bot")
logger.setLevel(logging.INFO)

# Bot is initialized lazily to avoid crashes on invalid/missing token
bot: Bot | None = None
dp = Dispatcher()


def get_bot() -> Bot:
    """Get or create bot instance."""
    global bot
    if bot is None:
        if not settings.telegram_bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN is not set")
        bot = Bot(token=settings.telegram_bot_token)
    return bot


# Database session
engine = create_async_engine(get_database_url(), echo=False, pool_pre_ping=True)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


async def find_user_by_telegram_id(session: AsyncSession, telegram_id: int) -> User | None:
    """Find user by their Telegram ID."""
    result = await session.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    return result.scalar_one_or_none()


async def get_or_create_chat(session: AsyncSession, telegram_chat: types.Chat, owner_id: int | None, org_id: int | None = None) -> Chat:
    """Get existing chat or create new one. Restores soft-deleted chats."""
    from sqlalchemy.exc import IntegrityError

    result = await session.execute(
        select(Chat).where(Chat.telegram_chat_id == telegram_chat.id)
    )
    chat = result.scalar_one_or_none()

    if chat:
        # Chat exists - update if needed
        updated = False

        # Restore soft-deleted chat
        if chat.deleted_at is not None:
            chat.deleted_at = None
            updated = True
            logger.info(f"♻️ Restored deleted chat: {chat.title}")

        if not chat.is_active:
            chat.is_active = True
            updated = True
        if owner_id and not chat.owner_id:
            chat.owner_id = owner_id
            updated = True
        if org_id and not chat.org_id:
            chat.org_id = org_id
            updated = True
        if chat.title != (telegram_chat.title or telegram_chat.full_name):
            chat.title = telegram_chat.title or telegram_chat.full_name
            updated = True
        if updated:
            await session.commit()
        return chat

    # Try to create new chat
    try:
        chat = Chat(
            telegram_chat_id=telegram_chat.id,
            title=telegram_chat.title or telegram_chat.full_name,
            chat_type=ChatType.work,
            owner_id=owner_id,
            org_id=org_id,
        )
        session.add(chat)
        await session.commit()
        await session.refresh(chat)
        logger.debug(f"Created new chat: {chat.title}")
        return chat
    except IntegrityError:
        # Race condition - chat was created by another request
        await session.rollback()
        result = await session.execute(
            select(Chat).where(Chat.telegram_chat_id == telegram_chat.id)
        )
        chat = result.scalar_one_or_none()
        if chat:
            if chat.deleted_at is not None:
                chat.deleted_at = None
                logger.info(f"♻️ Restored deleted chat: {chat.title}")
            if not chat.is_active:
                chat.is_active = True
            if org_id and not chat.org_id:
                chat.org_id = org_id
            await session.commit()
        return chat


@dp.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=IS_NOT_MEMBER >> IS_MEMBER))
async def on_bot_added(event: ChatMemberUpdated):
    """Handle bot being added to a chat - auto-bind to the user who added it."""
    try:
        logger.info(f"📥 Bot added to chat: {event.chat.title} (ID: {event.chat.id})")
        async with async_session() as session:
            # Find who added the bot
            adder_id = event.from_user.id
            owner = await find_user_by_telegram_id(session, adder_id)

            owner_id = owner.id if owner else None
            org_id = None

            # Get org_id from owner's organization membership
            if owner:
                org_result = await session.execute(
                    select(OrgMember.org_id).where(OrgMember.user_id == owner.id).limit(1)
                )
                org_row = org_result.scalar_one_or_none()
                if org_row:
                    org_id = org_row

            # Create or get the chat
            chat = await get_or_create_chat(session, event.chat, owner_id, org_id)

            if owner:
                logger.info(f"✅ Chat '{event.chat.title}' linked to user {owner.email} (org_id={org_id})")
            else:
                logger.info(f"✅ Chat '{event.chat.title}' created (no linked user)")
    except Exception as e:
        logger.error(f"❌ Error adding chat: {type(e).__name__}: {e}")


@dp.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=IS_MEMBER >> IS_NOT_MEMBER))
async def on_bot_removed(event: ChatMemberUpdated):
    """Handle bot being removed from a chat - mark chat as inactive."""
    try:
        logger.info(f"📤 Bot removed from chat: {event.chat.title} (ID: {event.chat.id})")
        async with async_session() as session:
            result = await session.execute(
                select(Chat).where(Chat.telegram_chat_id == event.chat.id)
            )
            chat = result.scalar_one_or_none()

            if chat:
                chat.is_active = False
                await session.commit()
                logger.info(f"✅ Chat '{event.chat.title}' marked as inactive")
    except Exception as e:
        logger.error(f"❌ Error handling bot removal: {type(e).__name__}: {e}")


# URL pattern for extracting links from messages
URL_PATTERN = re.compile(r'https?://[^\s<>"{}|\\^`\[\]]+')


def _clean_url(url: str) -> str:
    """
    Clean URL by removing trailing punctuation that's commonly attached
    when URLs are written in text (e.g., "check this link: https://example.com.")
    """
    # Remove trailing punctuation that's unlikely to be part of URL
    # Keep trailing / as it's often part of valid URLs
    while url and url[-1] in '.,;:!?)]\'"':
        # Special case: keep ) if there's a matching ( in the URL (e.g., Wikipedia links)
        if url[-1] == ')' and '(' in url:
            break
        url = url[:-1]
    return url


def extract_urls_from_text(text: str) -> list[str]:
    """
    Extract URLs from text, cleaning up trailing punctuation.
    Handles cases where text and link are in the same message.
    """
    urls = URL_PATTERN.findall(text)
    return [_clean_url(url) for url in urls if _clean_url(url)]


async def process_external_links_in_message(text: str, org_id: int, owner_id: int | None, chat_id: int):
    """
    Automatically detect and process external links in message text.
    Parses Google Docs/Sheets/Forms and saves content as chat messages (not CallRecordings).
    """
    from .services.google_docs import google_docs_service
    from datetime import datetime

    try:
        # Extract all URLs from message (with punctuation cleanup)
        urls = extract_urls_from_text(text)
        if not urls:
            return

        for url in urls:
            # Detect link type
            link_type = external_link_processor.detect_link_type(url)

            # Process document types (save to chat as parsed content)
            # Fireflies links still create CallRecordings since they are actual call transcripts
            document_types = {
                LinkType.GOOGLE_DOC,
                LinkType.GOOGLE_SHEET,
                LinkType.GOOGLE_FORM,
            }

            # Media types that need transcription
            media_types = {
                LinkType.DIRECT_MEDIA,
                LinkType.GOOGLE_DRIVE,
            }

            if link_type in document_types:
                logger.info(f"🔗 Parsing {link_type} link in chat {chat_id}: {url[:50]}...")

                try:
                    # Parse the document in background
                    asyncio.create_task(
                        _parse_link_to_chat_message(url, link_type, chat_id)
                    )
                    logger.info(f"✅ Started parsing {link_type} link")
                except Exception as e:
                    logger.error(f"❌ Failed to parse {link_type} link: {e}")

            elif link_type in media_types:
                logger.info(f"🎵 Transcribing {link_type} media link in chat {chat_id}: {url[:50]}...")

                try:
                    # Transcribe media in background
                    asyncio.create_task(
                        _transcribe_media_link_to_chat_message(url, link_type, chat_id)
                    )
                    logger.info(f"✅ Started transcribing {link_type} media link")
                except Exception as e:
                    logger.error(f"❌ Failed to transcribe {link_type} media link: {e}")

    except Exception as e:
        logger.error(f"❌ Error processing external links: {e}")


async def _parse_link_to_chat_message(url: str, link_type: str, chat_id: int):
    """
    Parse a document link and save the content as a message in the chat.
    This is similar to how document attachments are parsed.
    """
    from .services.google_docs import google_docs_service
    from datetime import datetime
    import re
    import aiohttp

    try:
        content = None
        title = None
        parse_status = "pending"
        parse_error = None
        document_metadata = {}

        if link_type == LinkType.GOOGLE_DOC:
            result = await google_docs_service.parse_from_url(url)
            if result and result.content:
                content = result.content
                title = result.metadata.get('title') if result.metadata else None
                document_metadata = result.metadata or {}
                parse_status = "parsed"
            else:
                parse_status = "failed"
                parse_error = result.error if result else "Failed to parse document"

        elif link_type == LinkType.GOOGLE_SHEET:
            # Extract sheet ID and export as CSV
            match = re.search(r'spreadsheets/d/([a-zA-Z0-9_-]+)', url)
            if match:
                sheet_id = match.group(1)
                export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"

                async with aiohttp.ClientSession() as session:
                    async with session.get(export_url, allow_redirects=True) as response:
                        if response.status == 200:
                            content = await response.text()
                            title = f"Google Sheet"
                            document_metadata = {"type": "spreadsheet", "sheet_id": sheet_id}
                            parse_status = "parsed"
                        else:
                            parse_status = "failed"
                            parse_error = "Sheet not public or not accessible"
            else:
                parse_status = "failed"
                parse_error = "Invalid Google Sheets URL"

        elif link_type == LinkType.GOOGLE_FORM:
            # Forms are harder to parse, just note the link
            content = f"[Google Form: {url}]"
            title = "Google Form"
            document_metadata = {"type": "form"}
            parse_status = "partial"

        # Save as a message in the chat
        if content:
            async with async_session() as session:
                # Create a system message with the parsed content
                msg_content = content
                if title:
                    msg_content = f"📄 {title}\n\n{content}"

                # Truncate if too long (keep first 10000 chars for display, full in metadata)
                display_content = msg_content
                if len(msg_content) > 10000:
                    display_content = msg_content[:10000] + f"\n\n... [Обрезано, полный текст: {len(msg_content)} символов]"
                    document_metadata["full_content_length"] = len(msg_content)
                    document_metadata["truncated"] = True

                db_message = Message(
                    chat_id=chat_id,
                    telegram_message_id=None,  # System message, no telegram ID
                    telegram_user_id=0,  # System/bot user
                    username="system",
                    first_name="📎 Parsed Link",
                    last_name=None,
                    content=display_content,
                    content_type="parsed_link",
                    file_id=None,
                    file_name=title or url[:50],
                    document_metadata={
                        **document_metadata,
                        "source_url": url,
                        "link_type": link_type,
                        "full_content": msg_content if document_metadata.get("truncated") else None
                    },
                    parse_status=parse_status,
                    parse_error=parse_error,
                    timestamp=datetime.utcnow(),
                )
                session.add(db_message)
                await session.commit()

                logger.info(f"✅ Saved parsed {link_type} link as chat message: {len(content)} chars")
        else:
            logger.warning(f"⚠️ Could not parse {link_type} link: {parse_error}")

    except Exception as e:
        logger.error(f"❌ Error parsing link to chat message: {e}")


async def _transcribe_media_link_to_chat_message(url: str, link_type: str, chat_id: int):
    """
    Download and transcribe audio/video from a media link, save as chat message.
    Supports direct media URLs and Google Drive links.
    """
    from datetime import datetime
    import aiohttp
    import tempfile
    import os

    try:
        content = None
        title = None
        parse_status = "pending"
        parse_error = None
        document_metadata = {}

        # Download the media file
        file_bytes = None
        filename = "media_file"

        if link_type == LinkType.GOOGLE_DRIVE:
            # Extract file ID from Google Drive URL
            match = external_link_processor.GDRIVE_PATTERN.search(url) or \
                    external_link_processor.GDRIVE_OPEN_PATTERN.search(url)
            if match:
                file_id = match.group(1)
                # Try direct download URL
                download_url = f"https://drive.google.com/uc?export=download&id={file_id}"

                async with aiohttp.ClientSession() as session:
                    async with session.get(download_url, allow_redirects=True) as response:
                        if response.status == 200:
                            file_bytes = await response.read()
                            # Try to get filename from content-disposition
                            cd = response.headers.get('content-disposition', '')
                            if 'filename=' in cd:
                                filename = cd.split('filename=')[1].strip('"\'')
                            else:
                                filename = f"gdrive_{file_id}"
                            document_metadata["gdrive_file_id"] = file_id
                        else:
                            parse_status = "failed"
                            parse_error = f"Failed to download from Google Drive (status {response.status})"
            else:
                parse_status = "failed"
                parse_error = "Invalid Google Drive URL"

        elif link_type == LinkType.DIRECT_MEDIA:
            # Direct download
            async with aiohttp.ClientSession() as session:
                async with session.get(url, allow_redirects=True, timeout=aiohttp.ClientTimeout(total=120)) as response:
                    if response.status == 200:
                        file_bytes = await response.read()
                        # Get filename from URL
                        from urllib.parse import urlparse, unquote
                        parsed = urlparse(url)
                        filename = unquote(os.path.basename(parsed.path)) or "media_file"
                    else:
                        parse_status = "failed"
                        parse_error = f"Failed to download media (status {response.status})"

        # Transcribe if we have the file
        if file_bytes:
            # Determine if audio or video
            ext = os.path.splitext(filename)[1].lower()
            is_video = ext in {'.mp4', '.webm', '.avi', '.mov', '.mkv'}
            is_audio = ext in {'.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'}

            if is_video or is_audio:
                try:
                    if is_video:
                        content = await transcription_service.transcribe_video(file_bytes, filename)
                    else:
                        content = await transcription_service.transcribe_audio(file_bytes)

                    if content:
                        title = f"🎵 Транскрибация: {filename}"
                        parse_status = "parsed"
                        document_metadata["media_type"] = "video" if is_video else "audio"
                        document_metadata["file_size"] = len(file_bytes)
                    else:
                        parse_status = "failed"
                        parse_error = "Transcription returned empty result"
                except Exception as e:
                    parse_status = "failed"
                    parse_error = f"Transcription error: {str(e)}"
                    logger.error(f"Transcription error for {url}: {e}")
            else:
                parse_status = "failed"
                parse_error = f"Unsupported media format: {ext}"

        # Save as a message in the chat
        if content:
            async with async_session() as session:
                msg_content = content
                if title:
                    msg_content = f"{title}\n\n{content}"

                # Truncate if too long
                display_content = msg_content
                if len(msg_content) > 10000:
                    display_content = msg_content[:10000] + f"\n\n... [Обрезано, полный текст: {len(msg_content)} символов]"
                    document_metadata["full_content_length"] = len(msg_content)
                    document_metadata["truncated"] = True

                db_message = Message(
                    chat_id=chat_id,
                    telegram_message_id=None,
                    telegram_user_id=0,
                    username="system",
                    first_name="🎵 Transcribed Media",
                    last_name=None,
                    content=display_content,
                    content_type="transcribed_media",
                    file_id=None,
                    file_name=filename,
                    document_metadata={
                        **document_metadata,
                        "source_url": url,
                        "link_type": link_type,
                        "full_content": msg_content if document_metadata.get("truncated") else None
                    },
                    parse_status=parse_status,
                    parse_error=parse_error,
                    timestamp=datetime.utcnow(),
                )
                session.add(db_message)
                await session.commit()

                logger.info(f"✅ Saved transcribed media as chat message: {len(content)} chars")
        else:
            logger.warning(f"⚠️ Could not transcribe media link: {parse_error}")

    except Exception as e:
        logger.error(f"❌ Error transcribing media link to chat message: {e}")


# ─── Project management commands ───────────────────────────────────────

PROJECT_STATUS_LABELS = {
    ProjectStatus.planning: "Планирование",
    ProjectStatus.active: "В разработке",
    ProjectStatus.on_hold: "На паузе",
    ProjectStatus.completed: "Завершён",
    ProjectStatus.cancelled: "Отменён",
}

TASK_STATUS_LABELS = {
    TaskStatus.backlog: "Бэклог",
    TaskStatus.todo: "К выполнению",
    TaskStatus.in_progress: "В работе",
    TaskStatus.review: "На ревью",
    TaskStatus.done: "Готово",
    TaskStatus.cancelled: "Отменено",
}


def _progress_bar(percent: int, length: int = 10) -> str:
    """Generate a text progress bar using block characters."""
    filled = round(percent / 100 * length)
    return "█" * filled + "░" * (length - filled)


def _health_emoji(percent: int) -> str:
    """Return a health emoji based on progress percentage."""
    if percent >= 70:
        return "✅"
    elif percent >= 30:
        return "⚠️"
    return "🔴"


def _deadline_emoji(due_date) -> str:
    """Return an emoji based on how close the deadline is."""
    if not due_date:
        return ""
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    if hasattr(due_date, 'date'):
        due = due_date
    else:
        due = due_date
    diff = (due - now).days
    if diff < 0:
        return "🔴"
    elif diff == 0:
        return "🔴"
    elif diff <= 7:
        return "⚠️"
    return ""


def _deadline_text(due_date) -> str:
    """Return human-readable deadline text."""
    if not due_date:
        return ""
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    diff = (due - now).days if (due := due_date) else 0
    if diff < 0:
        return "просрочено"
    elif diff == 0:
        return "сегодня"
    elif diff == 1:
        return "завтра"
    elif diff <= 7:
        return f"через {diff} дн."
    return due_date.strftime("%d.%m")


async def _get_user_org_id(session: AsyncSession, telegram_id: int):
    """Get user and their org_id from telegram_id."""
    user = await find_user_by_telegram_id(session, telegram_id)
    if not user:
        return None, None
    org_result = await session.execute(
        select(OrgMember.org_id).where(OrgMember.user_id == user.id).limit(1)
    )
    org_id = org_result.scalar_one_or_none()
    return user, org_id


async def _get_user_access(session: AsyncSession, telegram_id: int) -> dict | None:
    """Get user's access level and allowed resources.

    Returns dict with keys:
        user, user_id, org_id, is_admin, is_dept_lead, dept_ids, project_ids
    or None if user not found / not linked.
    """
    user = await find_user_by_telegram_id(session, telegram_id)
    if not user:
        return None

    # Get org membership
    org_result = await session.execute(
        select(OrgMember).where(OrgMember.user_id == user.id)
    )
    org_member = org_result.scalar_one_or_none()

    is_admin = user.role.value == 'superadmin' or (
        org_member and org_member.role.value in ('owner', 'admin')
    )

    # Get department memberships
    dept_result = await session.execute(
        select(DepartmentMember).where(DepartmentMember.user_id == user.id)
    )
    dept_memberships = list(dept_result.scalars().all())
    dept_ids = [dm.department_id for dm in dept_memberships]
    is_dept_lead = any(
        dm.role.value in ('lead', 'sub_admin') for dm in dept_memberships
    )

    # Get project memberships
    proj_result = await session.execute(
        select(ProjectMember).where(ProjectMember.user_id == user.id)
    )
    project_ids = [pm.project_id for pm in proj_result.scalars().all()]

    return {
        'user': user,
        'user_id': user.id,
        'org_id': org_member.org_id if org_member else None,
        'is_admin': is_admin,
        'is_dept_lead': is_dept_lead,
        'dept_ids': dept_ids,
        'project_ids': project_ids,
    }


@dp.message(Command("status"))
async def cmd_status(message: types.Message):
    """Overview of departments and their projects — filtered by role."""
    async with async_session() as session:
        access = await _get_user_access(session, message.from_user.id)
        if not access or not access['org_id']:
            await message.answer("Сначала привяжите аккаунт: /bind <email>")
            return

        # Developer: no access
        if not access['is_admin'] and not access['is_dept_lead']:
            await message.answer("🔒 Нет доступа. Используйте /my для просмотра своих задач.")
            return

        org_id = access['org_id']

        # Get departments filtered by role
        dept_query = select(Department).where(
            Department.org_id == org_id,
            Department.is_active == True,
        ).order_by(Department.name)
        if access['is_dept_lead'] and not access['is_admin']:
            dept_query = dept_query.where(Department.id.in_(access['dept_ids']))

        dept_result = await session.execute(dept_query)
        departments = dept_result.scalars().all()

        proj_query = select(Project).where(Project.org_id == org_id).order_by(Project.name)
        if access['is_dept_lead'] and not access['is_admin']:
            proj_query = proj_query.where(Project.department_id.in_(access['dept_ids']))

        proj_result = await session.execute(proj_query)
        projects = proj_result.scalars().all()

        # Group projects by department
        dept_projects: dict[int | None, list] = {}
        for p in projects:
            dept_projects.setdefault(p.department_id, []).append(p)

        if not departments and not projects:
            await message.answer("Нет данных по отделам и проектам.")
            return

        title = "📊 <b>Статус отделов:</b>\n" if access['is_admin'] else "📊 <b>Мой отдел:</b>\n"
        lines = [title]

        for dept in departments:
            d_projects = dept_projects.get(dept.id, [])
            lines.append(f"🏢 <b>{dept.name}</b> ({len(d_projects)} проект{'а' if 1 < len(d_projects) < 5 else 'ов' if len(d_projects) >= 5 or len(d_projects) == 0 else ''})")
            for i, p in enumerate(d_projects):
                is_last = i == len(d_projects) - 1
                prefix = "  └ " if is_last else "  ├ "
                status_label = PROJECT_STATUS_LABELS.get(p.status, str(p.status))
                health = _health_emoji(p.progress_percent or 0)
                lines.append(f"{prefix}{p.name} — {status_label} {p.progress_percent or 0}% {health}")
            lines.append("")

        # Projects without department — only for admins
        if access['is_admin']:
            no_dept = dept_projects.get(None, [])
            if no_dept:
                lines.append(f"📂 <b>Без отдела</b> ({len(no_dept)} проект.)")
                for i, p in enumerate(no_dept):
                    is_last = i == len(no_dept) - 1
                    prefix = "  └ " if is_last else "  ├ "
                    status_label = PROJECT_STATUS_LABELS.get(p.status, str(p.status))
                    health = _health_emoji(p.progress_percent or 0)
                    lines.append(f"{prefix}{p.name} — {status_label} {p.progress_percent or 0}% {health}")

        await message.answer("\n".join(lines), parse_mode="HTML")


@dp.message(Command("project"))
async def cmd_project(message: types.Message):
    """Detailed project info — filtered by role."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer("Использование: /project <название>")
        return

    project_name = args[1].strip()

    async with async_session() as session:
        access = await _get_user_access(session, message.from_user.id)
        if not access or not access['org_id']:
            await message.answer("Сначала привяжите аккаунт: /bind <email>")
            return

        org_id = access['org_id']

        # Find project by name (case-insensitive partial match)
        result = await session.execute(
            select(Project).where(
                Project.org_id == org_id,
                Project.name.ilike(f"%{project_name}%"),
            )
        )
        project = result.scalar_one_or_none()

        if not project:
            # List available projects filtered by access
            proj_query = select(Project.name).where(Project.org_id == org_id).order_by(Project.name)
            if not access['is_admin']:
                if access['is_dept_lead']:
                    proj_query = proj_query.where(
                        (Project.department_id.in_(access['dept_ids'])) | (Project.id.in_(access['project_ids']))
                    )
                else:
                    proj_query = proj_query.where(Project.id.in_(access['project_ids']))
            all_proj = await session.execute(proj_query)
            names = [r[0] for r in all_proj.all()]
            if names:
                listing = "\n".join(f"  • {n}" for n in names)
                await message.answer(f"Проект не найден.\n\nДоступные проекты:\n{listing}")
            else:
                await message.answer("Проект не найден. Нет доступных проектов.")
            return

        # Access check for found project
        if not access['is_admin']:
            in_dept = access['is_dept_lead'] and project.department_id in access['dept_ids']
            in_project = project.id in access['project_ids']
            if not in_dept and not in_project:
                await message.answer("🔒 Нет доступа к этому проекту.")
                return

        # Get team members
        members_result = await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id
            ).options(selectinload(ProjectMember.user))
        )
        members = members_result.scalars().all()
        team_names = [m.user.name for m in members if m.user] if members else []

        # Get tasks
        tasks_result = await session.execute(
            select(ProjectTask).where(
                ProjectTask.project_id == project.id,
            ).options(selectinload(ProjectTask.assignee)).order_by(ProjectTask.sort_order)
        )
        tasks = tasks_result.scalars().all()

        done_count = sum(1 for t in tasks if t.status == TaskStatus.done)
        total_count = len(tasks)

        # Active tasks (not done, not cancelled)
        active_tasks = [
            t for t in tasks
            if t.status not in (TaskStatus.done, TaskStatus.cancelled, TaskStatus.backlog)
        ]

        status_label = PROJECT_STATUS_LABELS.get(project.status, str(project.status))
        pct = project.progress_percent or 0
        bar = _progress_bar(pct)

        lines = [
            f"📋 <b>{project.name}</b>",
            f"Статус: {status_label}",
            f"Прогресс: {pct}% {bar}",
        ]
        if team_names:
            lines.append(f"Команда: {', '.join(team_names)}")
        lines.append(f"Задачи: {done_count} done / {total_count} total")

        if active_tasks:
            lines.append("\n📌 <b>Активные задачи:</b>")
            for t in active_tasks[:10]:
                task_key = f"{project.prefix or ''}-{t.task_number}" if t.task_number else f"#{t.id}"
                assignee_name = t.assignee.name if t.assignee else "—"
                deadline = ""
                if t.due_date:
                    dl_text = _deadline_text(t.due_date)
                    dl_emoji = _deadline_emoji(t.due_date)
                    deadline = f" ({dl_text}) {dl_emoji}" if dl_text else ""
                lines.append(f"  • {task_key} {t.title} → {assignee_name}{deadline}")

        await message.answer("\n".join(lines), parse_mode="HTML")


@dp.message(Command("my"))
async def cmd_my_tasks(message: types.Message):
    """My tasks for today and upcoming."""
    async with async_session() as session:
        user, org_id = await _get_user_org_id(session, message.from_user.id)
        if not user or not org_id:
            await message.answer("Сначала привяжите аккаунт: /bind <email>")
            return

        # Get all active tasks assigned to this user
        tasks_result = await session.execute(
            select(ProjectTask).where(
                ProjectTask.assignee_id == user.id,
                ProjectTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
            ).options(
                selectinload(ProjectTask.project),
            ).order_by(ProjectTask.due_date.asc().nullslast(), ProjectTask.sort_order)
        )
        tasks = tasks_result.scalars().all()

        if not tasks:
            await message.answer("📋 У вас нет активных задач.")
            return

        # Group by project
        by_project: dict[str, list] = {}
        for t in tasks:
            pname = t.project.name if t.project else "Без проекта"
            by_project.setdefault(pname, []).append(t)

        lines = ["📋 <b>Мои задачи:</b>\n"]
        for pname, ptasks in by_project.items():
            lines.append(f"<b>{pname}:</b>")
            for t in ptasks:
                task_key = ""
                if t.project and t.project.prefix and t.task_number:
                    task_key = f"{t.project.prefix}-{t.task_number} "
                deadline = ""
                dl_emoji = ""
                if t.due_date:
                    dl_text = _deadline_text(t.due_date)
                    dl_emoji = _deadline_emoji(t.due_date)
                    deadline = f" ({dl_text})" if dl_text else ""
                lines.append(f"  • {task_key}{t.title}{deadline} {dl_emoji}")
            lines.append("")

        lines.append(f"Всего: {len(tasks)} задач{'а' if 1 < len(tasks) < 5 else '' if len(tasks) == 1 else ''}")

        await message.answer("\n".join(lines), parse_mode="HTML")


@dp.message(Command("dept"))
async def cmd_department(message: types.Message):
    """Department details — filtered by role."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer("Использование: /dept <название отдела>")
        return

    dept_name = args[1].strip()

    async with async_session() as session:
        access = await _get_user_access(session, message.from_user.id)
        if not access or not access['org_id']:
            await message.answer("Сначала привяжите аккаунт: /bind <email>")
            return

        org_id = access['org_id']

        # Developer: no access to dept details
        if not access['is_admin'] and not access['is_dept_lead']:
            await message.answer("🔒 Нет доступа. Используйте /my для просмотра своих задач.")
            return

        # Find department by name
        result = await session.execute(
            select(Department).where(
                Department.org_id == org_id,
                Department.is_active == True,
                Department.name.ilike(f"%{dept_name}%"),
            )
        )
        dept = result.scalar_one_or_none()

        if not dept:
            # List available depts filtered by access
            dept_query = select(Department.name).where(
                Department.org_id == org_id,
                Department.is_active == True,
            ).order_by(Department.name)
            if access['is_dept_lead'] and not access['is_admin']:
                dept_query = dept_query.where(Department.id.in_(access['dept_ids']))
            all_depts = await session.execute(dept_query)
            names = [r[0] for r in all_depts.all()]
            if names:
                listing = "\n".join(f"  • {n}" for n in names)
                await message.answer(f"Отдел не найден.\n\nДоступные отделы:\n{listing}")
            else:
                await message.answer("Отдел не найден. Нет доступных отделов.")
            return

        # Access check: dept lead can only see their own departments
        if access['is_dept_lead'] and not access['is_admin'] and dept.id not in access['dept_ids']:
            await message.answer("🔒 Нет доступа к этому отделу.")
            return

        # Get members
        members_result = await session.execute(
            select(DepartmentMember).where(
                DepartmentMember.department_id == dept.id,
            ).options(selectinload(DepartmentMember.user))
        )
        members = members_result.scalars().all()
        member_names = []
        for m in members:
            if m.user:
                role_suffix = " (лид)" if m.role and m.role.value == "lead" else ""
                member_names.append(f"{m.user.name}{role_suffix}")

        # Get projects in this department
        proj_result = await session.execute(
            select(Project).where(
                Project.department_id == dept.id,
            ).order_by(Project.name)
        )
        projects = proj_result.scalars().all()

        # Count active tasks across all department projects
        active_task_count = 0
        if projects:
            project_ids = [p.id for p in projects]
            count_result = await session.execute(
                select(func.count(ProjectTask.id)).where(
                    ProjectTask.project_id.in_(project_ids),
                    ProjectTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
                )
            )
            active_task_count = count_result.scalar() or 0

        lines = [
            f"🏢 <b>{dept.name}</b>",
        ]
        if member_names:
            lines.append(f"Участники: {', '.join(member_names)}")
        lines.append(f"Проектов: {len(projects)}")

        if projects:
            lines.append("\n📊 <b>Проекты:</b>")
            for p in projects:
                pct = p.progress_percent or 0
                bar = _progress_bar(pct)
                status_label = PROJECT_STATUS_LABELS.get(p.status, str(p.status))
                lines.append(f"  {p.name} — {pct}% {bar} {status_label}")

        lines.append(f"\n📌 Активные задачи: {active_task_count}")

        await message.answer("\n".join(lines), parse_mode="HTML")


# ─── End of project management commands ──────────────────────────────


# ─── Inline button menu system ───────────────────────────────────────

def main_menu_kb(access: dict | None = None) -> InlineKeyboardMarkup:
    """Build the main menu inline keyboard based on user access level."""
    buttons: list[list[InlineKeyboardButton]] = []

    if access is None or access['is_admin']:
        # Admin / fallback: show everything
        buttons.append([InlineKeyboardButton(text="📊 Статус отделов", callback_data="menu:status")])
        buttons.append([InlineKeyboardButton(text="🏢 Отделы", callback_data="menu:depts")])
        buttons.append([InlineKeyboardButton(text="📋 Мои задачи", callback_data="menu:my")])
        buttons.append([InlineKeyboardButton(text="📁 Проекты", callback_data="menu:projects")])
    elif access['is_dept_lead']:
        # Department lead: status of their dept, tasks, projects
        buttons.append([InlineKeyboardButton(text="📊 Мой отдел", callback_data="menu:status")])
        buttons.append([InlineKeyboardButton(text="📋 Мои задачи", callback_data="menu:my")])
        buttons.append([InlineKeyboardButton(text="📁 Проекты", callback_data="menu:projects")])
    else:
        # Developer / regular member: only their tasks and projects
        buttons.append([InlineKeyboardButton(text="📋 Мои задачи", callback_data="menu:my")])
        buttons.append([InlineKeyboardButton(text="📁 Мои проекты", callback_data="menu:projects")])

    return InlineKeyboardMarkup(inline_keyboard=buttons)


def _access_denied_kb() -> InlineKeyboardMarkup:
    """Keyboard with just a Home button for access denied messages."""
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🏠 Главная", callback_data="menu:main"),
    ]])


def _back_main_row() -> list[InlineKeyboardButton]:
    """Row with just 'Home' button."""
    return [InlineKeyboardButton(text="🏠 Главная", callback_data="menu:main")]


def _back_and_main_row(back_data: str) -> list[InlineKeyboardButton]:
    """Row with 'Back' and 'Home' buttons."""
    return [
        InlineKeyboardButton(text="← Назад", callback_data=back_data),
        InlineKeyboardButton(text="🏠 Главная", callback_data="menu:main"),
    ]


@dp.message(Command("menu"))
async def cmd_menu(message: types.Message):
    """Show inline button main menu."""
    async with async_session() as session:
        access = await _get_user_access(session, message.from_user.id)
        if not access:
            await message.answer("Сначала привяжите аккаунт командой /bind <email>")
            return
        await message.answer("📱 Главное меню:", reply_markup=main_menu_kb(access))


@dp.callback_query(F.data == "menu:main")
async def cb_main_menu(callback: CallbackQuery):
    """Return to main menu."""
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return
        await callback.message.edit_text("📱 Главное меню:", reply_markup=main_menu_kb(access))
    await callback.answer()


@dp.callback_query(F.data == "menu:status")
async def cb_status(callback: CallbackQuery):
    """Status overview — filtered by access level."""
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        org_id = access['org_id']
        if not org_id:
            await callback.message.edit_text(
                "Вы не состоите в организации.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[_back_main_row()]),
            )
            await callback.answer()
            return

        # Developer: no access to status overview
        if not access['is_admin'] and not access['is_dept_lead']:
            await callback.message.edit_text(
                "🔒 Нет доступа к этому разделу. Используйте «Мои задачи» для просмотра своих задач.",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        # Build department query with role filtering
        dept_query = select(Department).where(
            Department.org_id == org_id,
            Department.is_active == True,
        ).order_by(Department.name)

        if access['is_dept_lead'] and not access['is_admin']:
            dept_query = dept_query.where(Department.id.in_(access['dept_ids']))

        dept_result = await session.execute(dept_query)
        departments = dept_result.scalars().all()

        # Build project query with role filtering
        proj_query = select(Project).where(Project.org_id == org_id).order_by(Project.name)
        if access['is_dept_lead'] and not access['is_admin']:
            proj_query = proj_query.where(Project.department_id.in_(access['dept_ids']))

        proj_result = await session.execute(proj_query)
        projects = proj_result.scalars().all()

        dept_projects: dict[int | None, list] = {}
        for p in projects:
            dept_projects.setdefault(p.department_id, []).append(p)

        if not departments and not projects:
            await callback.message.edit_text(
                "Нет данных по отделам и проектам.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[_back_main_row()]),
            )
            await callback.answer()
            return

        title = "📊 <b>Статус отделов:</b>\n" if access['is_admin'] else "📊 <b>Мой отдел:</b>\n"
        lines = [title]
        for dept in departments:
            d_projects = dept_projects.get(dept.id, [])
            lines.append(f"🏢 <b>{dept.name}</b> ({len(d_projects)} проект{'а' if 1 < len(d_projects) < 5 else 'ов' if len(d_projects) >= 5 or len(d_projects) == 0 else ''})")
            for i, p in enumerate(d_projects):
                is_last = i == len(d_projects) - 1
                prefix = "  └ " if is_last else "  ├ "
                status_label = PROJECT_STATUS_LABELS.get(p.status, str(p.status))
                health = _health_emoji(p.progress_percent or 0)
                lines.append(f"{prefix}{p.name} — {status_label} {p.progress_percent or 0}% {health}")
            lines.append("")

        # Show projects without department only for admins
        if access['is_admin']:
            no_dept = dept_projects.get(None, [])
            if no_dept:
                lines.append(f"📂 <b>Без отдела</b> ({len(no_dept)} проект.)")
                for i, p in enumerate(no_dept):
                    is_last = i == len(no_dept) - 1
                    prefix = "  └ " if is_last else "  ├ "
                    status_label = PROJECT_STATUS_LABELS.get(p.status, str(p.status))
                    health = _health_emoji(p.progress_percent or 0)
                    lines.append(f"{prefix}{p.name} — {status_label} {p.progress_percent or 0}% {health}")

        await callback.message.edit_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[_back_main_row()]),
        )
    await callback.answer()


@dp.callback_query(F.data == "menu:my")
async def cb_my_tasks(callback: CallbackQuery):
    """My tasks — same logic as /my but via inline button, with 'mark done' buttons."""
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        user = access['user']
        tasks_result = await session.execute(
            select(ProjectTask).where(
                ProjectTask.assignee_id == user.id,
                ProjectTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
            ).options(
                selectinload(ProjectTask.project),
            ).order_by(ProjectTask.due_date.asc().nullslast(), ProjectTask.sort_order)
        )
        tasks = tasks_result.scalars().all()

        if not tasks:
            await callback.message.edit_text(
                "📋 У вас нет активных задач.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[_back_main_row()]),
            )
            await callback.answer()
            return

        by_project: dict[str, list] = {}
        for t in tasks:
            pname = t.project.name if t.project else "Без проекта"
            by_project.setdefault(pname, []).append(t)

        lines = ["📋 <b>Мои задачи:</b>\n"]
        for pname, ptasks in by_project.items():
            lines.append(f"<b>{pname}:</b>")
            for t in ptasks:
                task_key = ""
                if t.project and t.project.prefix and t.task_number:
                    task_key = f"{t.project.prefix}-{t.task_number} "
                deadline = ""
                dl_emoji = ""
                if t.due_date:
                    dl_text = _deadline_text(t.due_date)
                    dl_emoji = _deadline_emoji(t.due_date)
                    deadline = f" ({dl_text})" if dl_text else ""
                lines.append(f"  • {task_key}{t.title}{deadline} {dl_emoji}")
            lines.append("")

        lines.append(f"Всего: {len(tasks)} задач")

        # Add per-task "done" buttons (up to 8 to avoid overflow)
        buttons: list[list[InlineKeyboardButton]] = []
        for t in tasks[:8]:
            task_key = ""
            if t.project and t.project.prefix and t.task_number:
                task_key = f"{t.project.prefix}-{t.task_number} "
            buttons.append([InlineKeyboardButton(
                text=f"✅ {task_key}{t.title[:30]}",
                callback_data=f"task_done:{t.id}",
            )])
        buttons.append(_back_main_row())

        await callback.message.edit_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
    await callback.answer()


@dp.callback_query(F.data.startswith("task_done:"))
async def cb_task_done(callback: CallbackQuery):
    """Mark a task as done."""
    task_id = int(callback.data.split(":")[1])
    async with async_session() as session:
        result = await session.execute(
            select(ProjectTask).where(ProjectTask.id == task_id).options(selectinload(ProjectTask.project))
        )
        task = result.scalar_one_or_none()
        if not task:
            await callback.answer("Задача не найдена", show_alert=True)
            return

        task.status = TaskStatus.done
        await session.commit()

        task_key = ""
        if task.project and task.project.prefix and task.task_number:
            task_key = f"{task.project.prefix}-{task.task_number} "
        await callback.answer(f"✅ {task_key}{task.title} — готово!")

    # Refresh the my tasks view
    await cb_my_tasks(callback)


@dp.callback_query(F.data == "menu:depts")
async def cb_departments(callback: CallbackQuery):
    """List departments as inline buttons — filtered by access."""
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access or not access['org_id']:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        # Only admins and dept leads can see departments list
        if not access['is_admin'] and not access['is_dept_lead']:
            await callback.message.edit_text(
                "🔒 Нет доступа к этому разделу.",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        dept_query = select(Department).where(
            Department.org_id == access['org_id'],
            Department.is_active == True,
        ).order_by(Department.name)

        # Dept lead: only their departments
        if access['is_dept_lead'] and not access['is_admin']:
            dept_query = dept_query.where(Department.id.in_(access['dept_ids']))

        dept_result = await session.execute(dept_query)
        departments = dept_result.scalars().all()

        if not departments:
            await callback.message.edit_text(
                "Нет доступных отделов.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[_back_main_row()]),
            )
            await callback.answer()
            return

        # Count members per department
        buttons: list[list[InlineKeyboardButton]] = []
        for dept in departments:
            count_result = await session.execute(
                select(func.count(DepartmentMember.id)).where(
                    DepartmentMember.department_id == dept.id
                )
            )
            member_count = count_result.scalar() or 0
            buttons.append([InlineKeyboardButton(
                text=f"🏢 {dept.name} ({member_count})",
                callback_data=f"dept:{dept.id}",
            )])

        buttons.append(_back_main_row())
        await callback.message.edit_text(
            "🏢 Выберите отдел:",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
    await callback.answer()


@dp.callback_query(F.data.startswith("dept:"))
async def cb_department_detail(callback: CallbackQuery):
    """Show department detail with project buttons — access checked."""
    dept_id = int(callback.data.split(":")[1])
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        # Access check: admin sees all, dept lead only their depts, others denied
        if not access['is_admin']:
            if not access['is_dept_lead'] or dept_id not in access['dept_ids']:
                await callback.message.edit_text(
                    "🔒 Нет доступа к этому разделу.",
                    reply_markup=_access_denied_kb(),
                )
                await callback.answer()
                return

        result = await session.execute(
            select(Department).where(Department.id == dept_id)
        )
        dept = result.scalar_one_or_none()
        if not dept:
            await callback.answer("Отдел не найден", show_alert=True)
            return

        # Get members
        members_result = await session.execute(
            select(DepartmentMember).where(
                DepartmentMember.department_id == dept.id,
            ).options(selectinload(DepartmentMember.user))
        )
        members = members_result.scalars().all()
        lead_name = None
        member_count = len(members)
        for m in members:
            if m.user and m.role and m.role.value == "lead":
                lead_name = m.user.name

        # Get projects
        proj_result = await session.execute(
            select(Project).where(Project.department_id == dept.id).order_by(Project.name)
        )
        projects = proj_result.scalars().all()

        lines = [f"🏢 <b>{dept.name}</b>"]
        if lead_name:
            lines.append(f"Лид: {lead_name}")
        lines.append(f"Участников: {member_count}")

        buttons: list[list[InlineKeyboardButton]] = []
        # Project buttons — up to 3 per row
        row: list[InlineKeyboardButton] = []
        for p in projects:
            pct = p.progress_percent or 0
            row.append(InlineKeyboardButton(
                text=f"{p.name} {pct}%",
                callback_data=f"proj:{p.id}",
            ))
            if len(row) >= 3:
                buttons.append(row)
                row = []
        if row:
            buttons.append(row)

        buttons.append(_back_and_main_row("menu:depts"))

        await callback.message.edit_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
    await callback.answer()


@dp.callback_query(F.data == "menu:projects")
async def cb_projects_list(callback: CallbackQuery):
    """List projects as inline buttons — filtered by access."""
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access or not access['org_id']:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        org_id = access['org_id']

        if access['is_admin']:
            # Admin: all projects
            proj_query = select(Project).where(
                Project.org_id == org_id,
            ).order_by(Project.name)
        elif access['is_dept_lead']:
            # Dept lead: projects in their departments + projects they are a member of
            proj_query = select(Project).where(
                Project.org_id == org_id,
                (Project.department_id.in_(access['dept_ids'])) | (Project.id.in_(access['project_ids'])),
            ).order_by(Project.name)
        else:
            # Developer: only projects they are a member of
            proj_query = select(Project).where(
                Project.org_id == org_id,
                Project.id.in_(access['project_ids']),
            ).order_by(Project.name)

        proj_result = await session.execute(proj_query)
        projects = proj_result.scalars().all()

        if not projects:
            await callback.message.edit_text(
                "Нет доступных проектов.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[_back_main_row()]),
            )
            await callback.answer()
            return

        title = "📁 Выберите проект:" if access['is_admin'] else "📁 Мои проекты:"
        buttons: list[list[InlineKeyboardButton]] = []
        for p in projects:
            pct = p.progress_percent or 0
            status_label = PROJECT_STATUS_LABELS.get(p.status, str(p.status))
            buttons.append([InlineKeyboardButton(
                text=f"📋 {p.name} — {pct}% {status_label}",
                callback_data=f"proj:{p.id}",
            )])

        buttons.append(_back_main_row())
        await callback.message.edit_text(
            title,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
    await callback.answer()


@dp.callback_query(F.data.startswith("proj:"))
async def cb_project_detail(callback: CallbackQuery):
    """Show project detail with tasks and navigation — access checked."""
    project_id = int(callback.data.split(":")[1])
    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access:
            await callback.message.edit_text(
                "Сначала привяжите аккаунт командой /bind <email>",
                reply_markup=_access_denied_kb(),
            )
            await callback.answer()
            return

        result = await session.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            await callback.answer("Проект не найден", show_alert=True)
            return

        # Access check
        if not access['is_admin']:
            # Dept lead can see projects in their departments
            in_dept = access['is_dept_lead'] and project.department_id in access['dept_ids']
            # Member can see projects they belong to
            in_project = project_id in access['project_ids']
            if not in_dept and not in_project:
                await callback.message.edit_text(
                    "🔒 Нет доступа к этому проекту.",
                    reply_markup=_access_denied_kb(),
                )
                await callback.answer()
                return

        # Get team members
        members_result = await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id
            ).options(selectinload(ProjectMember.user))
        )
        members = members_result.scalars().all()
        team_names = [m.user.name for m in members if m.user] if members else []

        # Get tasks
        tasks_result = await session.execute(
            select(ProjectTask).where(
                ProjectTask.project_id == project.id,
            ).options(selectinload(ProjectTask.assignee)).order_by(ProjectTask.sort_order)
        )
        tasks = tasks_result.scalars().all()

        done_count = sum(1 for t in tasks if t.status == TaskStatus.done)
        total_count = len(tasks)

        active_tasks = [
            t for t in tasks
            if t.status not in (TaskStatus.done, TaskStatus.cancelled, TaskStatus.backlog)
        ]

        status_label = PROJECT_STATUS_LABELS.get(project.status, str(project.status))
        pct = project.progress_percent or 0
        bar = _progress_bar(pct)
        health = _health_emoji(pct)

        PRIORITY_LABELS = {0: "🟢 Низкий", 1: "🔵 Нормальный", 2: "🟡 Высокий", 3: "🔴 Критический"}
        priority_label = PRIORITY_LABELS.get(project.priority, "🔵 Нормальный")

        # Find project manager
        manager = next((m for m in members if m.role and (m.role.value if hasattr(m.role, 'value') else m.role) == 'manager'), None)
        manager_name = manager.user.name if manager and manager.user else "Не назначен"

        lines = [
            f"📋 <b>{project.name}</b> — {status_label} {health}",
            f"Прогресс: {pct}% {bar}",
            f"Приоритет: {priority_label}",
            f"Ответственный: {manager_name}",
        ]
        if project.description:
            desc = project.description[:200] + ("..." if len(project.description or "") > 200 else "")
            lines.append(f"\n📝 {desc}")
        if project.client_name:
            lines.append(f"Клиент: {project.client_name}")
        if project.target_date:
            dl_text = _deadline_text(project.target_date)
            dl_emoji = _deadline_emoji(project.target_date)
            lines.append(f"Дедлайн: {dl_text} {dl_emoji}")
        if team_names:
            lines.append(f"Команда: {', '.join(team_names)}")
        lines.append(f"Задачи: {done_count}/{total_count}")

        if active_tasks:
            lines.append("\n📌 <b>Активные задачи:</b>")
            for t in active_tasks[:10]:
                task_key = f"{project.prefix or ''}-{t.task_number}" if t.task_number else f"#{t.id}"
                assignee_name = t.assignee.name if t.assignee else "—"
                deadline = ""
                if t.due_date:
                    dl_text = _deadline_text(t.due_date)
                    dl_emoji = _deadline_emoji(t.due_date)
                    deadline = f" {dl_emoji}" if dl_emoji else ""
                lines.append(f"  • {task_key} {t.title} → {assignee_name}{deadline}")

        # Navigation + action buttons
        back_data = "menu:projects"
        back_label = "← Назад"
        if project.department_id:
            if access['is_admin'] or (access['is_dept_lead'] and project.department_id in access['dept_ids']):
                back_data = f"dept:{project.department_id}"
                back_label = "← Назад к отделу"

        buttons: list[list[InlineKeyboardButton]] = []

        # Priority change buttons (only for admin/manager)
        can_edit = access['is_admin'] or (manager and manager.user_id == access['user_id'])
        if can_edit:
            prio_buttons = []
            for pval, plabel in [(0, "🟢"), (1, "🔵"), (2, "🟡"), (3, "🔴")]:
                if pval != project.priority:
                    prio_buttons.append(InlineKeyboardButton(text=plabel, callback_data=f"prio:{project.id}:{pval}"))
            if prio_buttons:
                buttons.append(prio_buttons)

        buttons.append([
            InlineKeyboardButton(text=back_label, callback_data=back_data),
            InlineKeyboardButton(text="🏠 Главная", callback_data="menu:main"),
        ])

        await callback.message.edit_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
    await callback.answer()


@dp.callback_query(F.data.startswith("prio:"))
async def cb_change_priority(callback: CallbackQuery):
    """Change project priority via inline button."""
    parts = callback.data.split(":")
    project_id = int(parts[1])
    new_priority = int(parts[2])
    PRIO_NAMES = {0: "Низкий", 1: "Нормальный", 2: "Высокий", 3: "Критический"}

    async with async_session() as session:
        access = await _get_user_access(session, callback.from_user.id)
        if not access:
            await callback.answer("Привяжите аккаунт", show_alert=True)
            return

        result = await session.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            await callback.answer("Проект не найден", show_alert=True)
            return

        project.priority = new_priority
        await session.commit()

    await callback.answer(f"Приоритет → {PRIO_NAMES.get(new_priority, '?')}", show_alert=False)
    # Refresh project detail
    callback.data = f"proj:{project_id}"
    await cb_project_detail(callback)


# ─── End of inline button menu ───────────────────────────────────────


@dp.message(F.chat.type.in_({"group", "supergroup"}), lambda msg: not (msg.text and msg.text.startswith("/")))
async def collect_group_message(message: types.Message):
    """Silently collect all messages from groups. Skips commands so they reach their handlers."""
    # Skip messages without user info (system messages, channel posts, etc.)
    if not message.from_user:
        logger.debug(f"Skipping message without from_user in chat {message.chat.id}")
        return

    try:
        async with async_session() as session:
            # Try to find owner by telegram_id of message sender
            owner = await find_user_by_telegram_id(session, message.from_user.id)
            owner_id = owner.id if owner else None
            org_id = None

            if owner:
                org_result = await session.execute(
                    select(OrgMember.org_id).where(OrgMember.user_id == owner.id).limit(1)
                )
                org_row = org_result.scalar_one_or_none()
                if org_row:
                    org_id = org_row

            # Get or create the chat
            chat = await get_or_create_chat(session, message.chat, owner_id, org_id)

            # Determine content type and content
            content = ""
            content_type = "text"
            file_name = None

            if message.text:
                content = message.text
                content_type = "text"
            elif message.caption:
                content = message.caption

            if message.voice:
                content_type = "voice"
                file_name = "voice_message.ogg"
                # Try to transcribe
                try:
                    file = await get_bot().get_file(message.voice.file_id)
                    file_bytes = await get_bot().download_file(file.file_path)
                    content = await transcription_service.transcribe_audio(file_bytes.read())
                except Exception as e:
                    logger.debug(f"Voice transcription: {e}")
                    content = "[Voice message - transcription failed]"

            elif message.video_note:
                content_type = "video_note"
                file_name = "video_note.mp4"
                try:
                    file = await get_bot().get_file(message.video_note.file_id)
                    file_bytes = await get_bot().download_file(file.file_path)
                    content = await transcription_service.transcribe_video(file_bytes.read(), file.file_path)
                except Exception as e:
                    logger.debug(f"Video note transcription: {e}")
                    content = "[Video note - transcription failed]"

            elif message.video:
                content_type = "video"
                file_name = message.video.file_name or "video.mp4"
                if message.video.file_size < 20 * 1024 * 1024:  # 20MB limit
                    try:
                        file = await get_bot().get_file(message.video.file_id)
                        file_bytes = await get_bot().download_file(file.file_path)
                        content = await transcription_service.transcribe_video(file_bytes.read(), file_name)
                    except Exception as e:
                        logger.debug(f"Video transcription: {e}")
                        content = f"[Video: {file_name}]"
                else:
                    content = f"[Video: {file_name} - too large for transcription]"

            elif message.audio:
                content_type = "audio"
                file_name = message.audio.file_name or "audio.mp3"
                if message.audio.file_size < 20 * 1024 * 1024:
                    try:
                        file = await get_bot().get_file(message.audio.file_id)
                        file_bytes = await get_bot().download_file(file.file_path)
                        content = await transcription_service.transcribe_audio(file_bytes.read())
                    except Exception as e:
                        logger.debug(f"Audio transcription: {e}")
                        content = f"[Audio: {file_name}]"
                else:
                    content = f"[Audio: {file_name} - too large]"

            elif message.document:
                content_type = "document"
                file_name = message.document.file_name or "document"
                file_id = message.document.file_id
                document_metadata = None
                parse_status = None
                parse_error = None

                # Try to parse the document
                if message.document.file_size and message.document.file_size < 20 * 1024 * 1024:
                    try:
                        file = await get_bot().get_file(file_id)
                        file_bytes = await get_bot().download_file(file.file_path)
                        result = await document_parser.parse(file_bytes.read(), file_name)
                        content = result.content or f"[Document: {file_name}]"
                        document_metadata = result.metadata
                        parse_status = result.status
                        parse_error = result.error
                    except Exception as e:
                        logger.debug(f"Document parsing: {e}")
                        content = f"[Document: {file_name}]"
                        parse_status = "failed"
                        parse_error = str(e)
                else:
                    content = f"[Document: {file_name} - too large]"
                    parse_status = "skipped"
                    parse_error = "File too large"

                # Save message with document metadata
                db_message = Message(
                    chat_id=chat.id,
                    telegram_message_id=message.message_id,
                    telegram_user_id=message.from_user.id,
                    username=message.from_user.username,
                    first_name=message.from_user.first_name,
                    last_name=message.from_user.last_name,
                    content=content,
                    content_type=content_type,
                    file_id=file_id,
                    file_name=file_name,
                    document_metadata=document_metadata,
                    parse_status=parse_status,
                    parse_error=parse_error,
                    timestamp=message.date.replace(tzinfo=None),
                )
                session.add(db_message)
                await session.commit()
                return  # Early return since we've already saved

            elif message.photo:
                content_type = "photo"
                file_name = "photo.jpg"
                file_id = message.photo[-1].file_id  # Get highest resolution
                document_metadata = None
                parse_status = None
                parse_error = None

                # OCR the photo
                try:
                    file = await get_bot().get_file(file_id)
                    file_bytes = await get_bot().download_file(file.file_path)
                    result = await document_parser.parse(file_bytes.read(), file_name)
                    content = result.content if result.content else (message.caption or "[Photo]")
                    document_metadata = result.metadata
                    parse_status = result.status
                except Exception as e:
                    logger.debug(f"Photo OCR: {e}")
                    content = message.caption or "[Photo]"
                    parse_status = "failed"
                    parse_error = str(e)

                # Save message with OCR data
                db_message = Message(
                    chat_id=chat.id,
                    telegram_message_id=message.message_id,
                    telegram_user_id=message.from_user.id,
                    username=message.from_user.username,
                    first_name=message.from_user.first_name,
                    last_name=message.from_user.last_name,
                    content=content,
                    content_type=content_type,
                    file_id=file_id,
                    file_name=file_name,
                    document_metadata=document_metadata,
                    parse_status=parse_status,
                    parse_error=parse_error,
                    timestamp=message.date.replace(tzinfo=None),
                )
                session.add(db_message)
                await session.commit()
                return  # Early return

            elif message.sticker:
                content_type = "sticker"
                content = f"[Sticker: {message.sticker.emoji or ''}]"
                file_name = "sticker.webp"

            # Save message (for text, voice, video, audio, sticker)
            # Get file_id for voice/video/audio if not already set
            msg_file_id = None
            if message.voice:
                msg_file_id = message.voice.file_id
            elif message.video_note:
                msg_file_id = message.video_note.file_id
            elif message.video:
                msg_file_id = message.video.file_id
            elif message.audio:
                msg_file_id = message.audio.file_id
            elif message.sticker:
                msg_file_id = message.sticker.file_id

            db_message = Message(
                chat_id=chat.id,
                telegram_message_id=message.message_id,
                telegram_user_id=message.from_user.id,
                username=message.from_user.username,
                first_name=message.from_user.first_name,
                last_name=message.from_user.last_name,
                content=content,
                content_type=content_type,
                file_id=msg_file_id,
                file_name=file_name,
                timestamp=message.date.replace(tzinfo=None),
            )
            session.add(db_message)
            await session.commit()

            # Auto-detect and process external links (Fireflies, Google Docs/Sheets/Forms)
            if content_type == "text" and content and org_id:
                await process_external_links_in_message(content, org_id, owner_id, chat.id)

            # Auto-detect status reports OR create tasks from planning messages
            # Only if auto_tasks_enabled is ON for this chat (off by default)
            chat_auto_tasks = getattr(chat, 'auto_tasks_enabled', False)
            if chat_auto_tasks is None:
                chat_auto_tasks = False

            if content_type == "text" and content and chat_auto_tasks:
                # 1. Check for status report first (takes priority over task trigger)
                is_status = False
                try:
                    status_updates = await update_projects_from_status(
                        db=session,
                        message_text=content,
                        user_name=message.from_user.full_name,
                        telegram_user_id=message.from_user.id,
                    )
                    if status_updates:
                        is_status = True
                        lines = ["\U0001f4ca Статус обновлён:"]
                        for u in status_updates:
                            emoji = "\u2705" if u["status"] == "completed" else "\U0001f4c8"
                            lines.append(f"  {emoji} {u['project_name']} \u2192 {u['progress']}%")
                        await message.reply("\n".join(lines))
                except Exception as e:
                    logger.error(f"Status report error: {e}")

                # 2. If not a status report, try task trigger
                if not is_status:
                    try:
                        created_tasks = await create_tasks_from_message(
                            db=session,
                            message_text=content,
                            user_name=message.from_user.full_name,
                            telegram_user_id=message.from_user.id,
                            chat_id=message.chat.id,
                            telegram_username=message.from_user.username,
                        )
                        if created_tasks:
                            lines = ["\u2705 Задачи созданы из плана:"]
                            for t in created_tasks:
                                lines.append(f"  \u2022 {t['task_key']} \"{t['title']}\" \u2192 {t['assignee']}")
                            await message.reply("\n".join(lines))
                    except Exception as e:
                        logger.error(f"Task trigger error: {e}")

    except Exception as e:
        logger.error(f"❌ Error collecting message: {type(e).__name__}: {e}")


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """Handle /start command in private chat. Supports deep linking for auto-bind."""
    if message.chat.type != "private":
        return

    # Check for deep link parameter (e.g., /start bind_123)
    args = message.text.split(maxsplit=1)
    if len(args) > 1 and args[1].startswith("bind_"):
        # Extract user_id from deep link
        try:
            user_id = int(args[1].replace("bind_", ""))
            await handle_deep_link_bind(message, user_id)
            return
        except ValueError:
            pass

    # Build access-aware menu
    async with async_session() as session:
        access = await _get_user_access(session, message.from_user.id)

    await message.answer(
        "👋 Добро пожаловать в Enceladus!\n\n"
        "Добавьте меня в группу для анализа сообщений.\n"
        "Используйте веб-панель для просмотра аналитики.\n\n"
        "Выберите действие или используйте команды:\n"
        "/bind <email> — привязать аккаунт\n"
        "/menu — главное меню",
        reply_markup=main_menu_kb(access),
    )


async def handle_deep_link_bind(message: types.Message, user_id: int):
    """Handle deep link binding from invitation."""
    async with async_session() as session:
        # Find user by ID
        result = await session.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()

        if not user:
            await message.answer(
                "❌ Ссылка недействительна или устарела.\n\n"
                "Если у вас есть аккаунт, используйте /bind <email>"
            )
            return

        # Check if this Telegram ID is already bound to another user
        result = await session.execute(
            select(User).where(
                User.telegram_id == message.from_user.id,
                User.id != user_id
            )
        )
        already_bound_user = result.scalar_one_or_none()

        if already_bound_user:
            await message.answer(
                "❌ Ваш Telegram уже привязан к другому аккаунту.\n\n"
                "Обратитесь к администратору для решения проблемы."
            )
            return

        # Check if target user already has a different Telegram bound
        if user.telegram_id and user.telegram_id != message.from_user.id:
            await message.answer(
                "❌ Этот аккаунт уже привязан к другому Telegram.\n\n"
                "Обратитесь к администратору для решения проблемы."
            )
            return

        # Bind
        user.telegram_id = message.from_user.id
        user.telegram_username = message.from_user.username
        await session.commit()

        await message.answer(
            f"✅ Аккаунт успешно привязан!\n\n"
            f"👤 {user.name}\n"
            f"📧 {user.email}\n\n"
            "Теперь при добавлении бота в группы, они автоматически будут привязаны к вашему аккаунту.\n\n"
            "Добавьте меня в рабочую группу для начала работы!"
        )


@dp.message(Command("bind"))
async def cmd_bind(message: types.Message):
    """Bind Telegram account to web admin account."""
    if message.chat.type != "private":
        await message.answer("Эта команда доступна только в личных сообщениях.")
        return

    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer("Использование: /bind <email>")
        return

    email = args[1].strip().lower()

    async with async_session() as session:
        # Find user by email
        result = await session.execute(
            select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()

        if not user:
            await message.answer("Пользователь с таким email не найден.")
            return

        # Check if already bound
        if user.telegram_id and user.telegram_id != message.from_user.id:
            await message.answer("Этот аккаунт уже привязан к другому Telegram.")
            return

        # Bind
        user.telegram_id = message.from_user.id
        user.telegram_username = message.from_user.username
        await session.commit()

        await message.answer(
            f"Аккаунт успешно привязан!\n"
            f"Email: {email}\n\n"
            "Теперь при добавлении бота в группы, они автоматически будут привязаны к вашему аккаунту."
        )


@dp.message(Command("chats"))
async def cmd_chats(message: types.Message):
    """List user's chats."""
    if message.chat.type != "private":
        return

    async with async_session() as session:
        user = await find_user_by_telegram_id(session, message.from_user.id)

        if not user:
            await message.answer("Сначала привяжите аккаунт: /bind <email>")
            return

        result = await session.execute(
            select(Chat).where(Chat.owner_id == user.id)
        )
        chats = result.scalars().all()

        if not chats:
            await message.answer("У вас нет привязанных чатов.")
            return

        text = "Ваши чаты:\n\n"
        for chat in chats:
            text += f"• {chat.custom_name or chat.title}\n"

        await message.answer(text)


# Available chat types
CHAT_TYPES = {
    'work': 'Рабочий чат',
    'hr': 'HR / Кандидаты',
    'project': 'Проект',
    'client': 'Клиент',
    'contractor': 'Подрядчик',
    'sales': 'Продажи',
    'support': 'Поддержка',
    'custom': 'Другое',
}


@dp.message(Command("settype"))
async def cmd_settype(message: types.Message):
    """Set the chat type for analysis."""
    if message.chat.type not in ("group", "supergroup"):
        await message.answer(
            "Эта команда работает только в группах.\n"
            "Добавьте бота в группу и используйте там."
        )
        return

    args = message.text.split(maxsplit=1)

    async with async_session() as session:
        # Get the chat
        result = await session.execute(
            select(Chat).where(Chat.telegram_chat_id == message.chat.id)
        )
        chat = result.scalar_one_or_none()

        if not chat:
            await message.answer("Чат не найден. Попробуйте позже.")
            return

        # If no argument, show available types
        if len(args) < 2:
            types_list = "\n".join([f"• {code} — {name}" for code, name in CHAT_TYPES.items()])
            current_type = CHAT_TYPES.get(chat.chat_type, chat.chat_type)
            await message.answer(
                f"Текущий тип: {current_type}\n\n"
                f"Доступные типы:\n{types_list}\n\n"
                f"Использование: /settype <тип>\n"
                f"Пример: /settype hr"
            )
            return

        new_type = args[1].strip().lower()

        if new_type not in CHAT_TYPES:
            await message.answer(
                f"Неизвестный тип: {new_type}\n"
                f"Доступные типы: {', '.join(CHAT_TYPES.keys())}"
            )
            return

        # Update chat type
        chat.chat_type = new_type
        await session.commit()

        await message.answer(
            f"✅ Тип чата изменён на: {CHAT_TYPES[new_type]}\n\n"
            "AI-ассистент теперь будет анализировать чат с учётом этого контекста."
        )


@dp.message(Command("meets"))
async def cmd_meets(message: types.Message):
    """Broadcast meeting times to chats.

    Usage (in private chat with bot):
        /meets
        Чат с Кириллом - 13:00
        Чат с Марией - 13:30
        Дизайн общий - 14:00

    Bot will fuzzy-match chat names and send personalized meeting notifications.
    """
    if message.chat.type != "private":
        await message.answer("Эта команда работает только в личных сообщениях с ботом.")
        return

    async with async_session() as session:
        user = await find_user_by_telegram_id(session, message.from_user.id)
        if not user:
            await message.answer("Сначала привяжите аккаунт: /bind <email>")
            return

        # Parse the message: remove /meets command, get lines
        text = message.text or ""
        # Remove the command itself
        lines = text.split("\n")
        data_lines = [l.strip() for l in lines[1:] if l.strip()]  # skip first line (/meets)

        # Also handle single-line: /meets\ndata
        if not data_lines and len(lines) == 1:
            await message.answer(
                "📅 <b>Рассылка митов</b>\n\n"
                "Формат:\n"
                "<code>/meets\n"
                "Чат Кирилл - 13:00\n"
                "Чат Мария - 13:30\n"
                "Чат Дизайн - 14:00</code>\n\n"
                "<b>Со ссылкой (одна на всех):</b>\n"
                "<code>/meets\n"
                "https://meet.google.com/xxx\n"
                "Кирилл - 13:00\n"
                "Мария - 13:30</code>\n\n"
                "<b>С разными ссылками:</b>\n"
                "<code>/meets\n"
                "Кирилл - 13:00 https://meet.google.com/aaa\n"
                "Мария - 13:30 https://meet.google.com/bbb</code>\n\n"
                "Бот найдёт чаты по названию и отправит каждому время мита.",
                parse_mode="HTML",
            )
            return

        # Check if first data line is a global link
        global_link = None
        url_pattern = re.compile(r'^https?://\S+$')
        if data_lines and url_pattern.match(data_lines[0]):
            global_link = data_lines[0]
            data_lines = data_lines[1:]

        # Load all active chats (from user's org or all if superadmin)
        chat_query = select(Chat).where(Chat.is_active == True)
        if hasattr(Chat, 'deleted_at'):
            chat_query = chat_query.where(Chat.deleted_at == None)
        result = await session.execute(chat_query)
        all_chats = result.scalars().all()

        # Build lookup: lowercase name → chat
        chat_lookup: dict[str, Chat] = {}
        for c in all_chats:
            name = (c.custom_name or c.title or "").lower().strip()
            if name:
                chat_lookup[name] = c

        # Parse each line and match chats
        schedule: list[tuple[Chat, str, str, str | None]] = []  # (chat, time_str, original_name, link)
        not_found: list[str] = []

        for line in data_lines:
            # Try to parse "chat name - time [link]" or "chat name — time [link]"
            match = re.match(r'^(.+?)\s*[-–—]\s*(\d{1,2}[:.]\d{2})\s*(https?://\S+)?\s*$', line)
            if not match:
                not_found.append(f"❓ Не понял строку: <code>{line}</code>")
                continue

            chat_name = match.group(1).strip()
            time_str = match.group(2).replace('.', ':')
            line_link = match.group(3)  # per-line link or None
            chat_name_lower = chat_name.lower()

            # Exact match first
            found_chat = chat_lookup.get(chat_name_lower)

            # Fuzzy: substring match
            if not found_chat:
                for name, c in chat_lookup.items():
                    if chat_name_lower in name or name in chat_name_lower:
                        found_chat = c
                        break

            if found_chat:
                link = line_link or global_link  # per-line link takes priority
                schedule.append((found_chat, time_str, chat_name, link))
            else:
                not_found.append(f"❌ Чат не найден: <b>{chat_name}</b>")

        if not schedule and not_found:
            await message.answer(
                "Не удалось найти чаты:\n\n" + "\n".join(not_found),
                parse_mode="HTML",
            )
            return

        # Send meeting notifications
        bot_instance = get_bot()
        sent = []
        failed = []

        for chat_obj, time_str, original_name, meet_link in schedule:
            try:
                meeting_text = f"📅 <b>Мит сегодня в {time_str}</b>"
                if meet_link:
                    meeting_text += f'\n\n🔗 <a href="{meet_link}">Подключиться</a>'
                meeting_text += "\n\nПожалуйста, будьте готовы к назначенному времени."
                await bot_instance.send_message(
                    chat_id=chat_obj.telegram_chat_id,
                    text=meeting_text,
                    parse_mode="HTML",
                )
                sent.append(f"✅ {original_name} → {time_str}")
            except Exception as e:
                logger.error(f"Failed to send meet to chat {chat_obj.telegram_chat_id}: {e}")
                failed.append(f"❌ {original_name} — ошибка отправки")

        # Report back
        report = "📅 <b>Рассылка митов</b>\n\n"
        if sent:
            report += "<b>Отправлено:</b>\n" + "\n".join(sent) + "\n\n"
        if failed:
            report += "<b>Ошибки:</b>\n" + "\n".join(failed) + "\n\n"
        if not_found:
            report += "<b>Не найдено:</b>\n" + "\n".join(not_found) + "\n\n"

        report += f"Итого: {len(sent)} из {len(schedule)} отправлено"
        await message.answer(report, parse_mode="HTML")


@dp.message(Command("autotasks"))
async def cmd_autotasks(message: types.Message):
    """Manage which chats have smart features enabled.

    Usage (in private chat with bot):
        /autotasks                — show all chats and their status
        /autotasks on             — enable listed chats (multiline)
        Кирилл
        Мария
        /autotasks off            — disable listed chats
        Кирилл
        /autotasks all on         — enable ALL chats
        /autotasks all off        — disable ALL chats
    """
    try:
        async with async_session() as session:
            user = await find_user_by_telegram_id(session, message.from_user.id)

            # Load all active chats
            chat_query = select(Chat).where(Chat.is_active == True)
            if hasattr(Chat, 'deleted_at'):
                chat_query = chat_query.where(Chat.deleted_at == None)
            result = await session.execute(chat_query)
            all_chats = result.scalars().all()

            if not all_chats:
                await message.answer("Нет зарегистрированных чатов.")
                return

            # Parse the message
            text = message.text or ""
            lines = text.split("\n")
            first_line = lines[0].strip()
            data_lines = [l.strip() for l in lines[1:] if l.strip()]

            # Extract mode from first line: /autotasks [on|off|all on|all off]
            parts = first_line.split()
            mode = None  # None = show status
            all_mode = False

            if len(parts) >= 3 and parts[1].lower() == "all":
                all_mode = True
                mode = parts[2].lower()
            elif len(parts) >= 2:
                mode = parts[1].lower()

            # Normalize mode
            if mode in ("on", "1", "вкл", "да"):
                mode = "on"
            elif mode in ("off", "0", "выкл", "нет"):
                mode = "off"
            else:
                mode = None

            # /autotasks all on/off — bulk toggle ALL chats
            if all_mode and mode:
                enabled = mode == "on"
                count = 0
                for c in all_chats:
                    c.auto_tasks_enabled = enabled
                    count += 1
                await session.commit()
                status_emoji = "🟢" if enabled else "🔴"
                status_text = "включены" if enabled else "выключены"
                await message.answer(
                    f"{status_emoji} Смарт-функции <b>{status_text}</b> для всех {count} чатов.",
                    parse_mode="HTML",
                )
                return

            # /autotasks on/off + list of chat names
            if mode and data_lines:
                enabled = mode == "on"

                # Build lookup: lowercase name → chat
                chat_lookup: dict[str, Chat] = {}
                for c in all_chats:
                    name = (c.custom_name or c.title or "").lower().strip()
                    if name:
                        chat_lookup[name] = c

                toggled = []
                not_found = []

                for line in data_lines:
                    chat_name = line.strip()
                    chat_name_lower = chat_name.lower()

                    # Exact match first
                    found_chat = chat_lookup.get(chat_name_lower)

                    # Fuzzy: substring match
                    if not found_chat:
                        for name, c in chat_lookup.items():
                            if chat_name_lower in name or name in chat_name_lower:
                                found_chat = c
                                break

                    if found_chat:
                        found_chat.auto_tasks_enabled = enabled
                        display_name = found_chat.custom_name or found_chat.title or "?"
                        toggled.append(f"{'🟢' if enabled else '🔴'} {display_name}")
                    else:
                        not_found.append(f"❓ {chat_name}")

                await session.commit()

                status_text = "включены" if enabled else "выключены"
                report = f"⚙️ <b>Смарт-функции {status_text}:</b>\n\n"
                if toggled:
                    report += "\n".join(toggled) + "\n\n"
                if not_found:
                    report += "<b>Не найдено:</b>\n" + "\n".join(not_found) + "\n\n"

                await message.answer(report, parse_mode="HTML")
                return

            # No mode or no chat names → show status of all chats
            on_chats = []
            off_chats = []
            for c in all_chats:
                name = c.custom_name or c.title or f"ID:{c.telegram_chat_id}"
                enabled = getattr(c, 'auto_tasks_enabled', False)
                if enabled is None:
                    enabled = False
                if enabled:
                    on_chats.append(f"🟢 {name}")
                else:
                    off_chats.append(f"🔴 {name}")

            report = "⚙️ <b>Смарт-функции (автозадачи, статусы, миты)</b>\n\n"
            if on_chats:
                report += "<b>Включены:</b>\n" + "\n".join(on_chats) + "\n\n"
            if off_chats:
                report += "<b>Выключены:</b>\n" + "\n".join(off_chats) + "\n\n"

            report += (
                "<b>Управление:</b>\n"
                "<code>/autotasks on\n"
                "Кирилл\n"
                "Мария</code>\n\n"
                "<code>/autotasks off\n"
                "Кирилл</code>\n\n"
                "<code>/autotasks all on</code> — включить всем\n"
                "<code>/autotasks all off</code> — выключить всем"
            )
            await message.answer(report, parse_mode="HTML")

    except Exception as e:
        logger.error(f"Error in /autotasks command: {e}")
        await message.answer(f"⚠️ Ошибка: {e}")


async def start_bot():
    """Start the bot polling."""
    try:
        bot_instance = get_bot()
        me = await bot_instance.get_me()
        logger.info(f"🤖 Bot started: @{me.username} (ID: {me.id})")
        await dp.start_polling(bot_instance)
    except ValueError as e:
        logger.error(f"❌ Bot token error: {e}")
    except Exception as e:
        logger.error(f"❌ Bot failed to start: {type(e).__name__}: {e}")


async def stop_bot():
    """Stop the bot."""
    global bot
    if bot:
        logger.info("🛑 Bot stopping...")
        await bot.session.close()
