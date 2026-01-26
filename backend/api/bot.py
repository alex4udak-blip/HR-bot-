import asyncio
import logging
import re
from datetime import datetime
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, ChatMemberUpdatedFilter, IS_NOT_MEMBER, IS_MEMBER
from aiogram.types import ChatMemberUpdated, ContentType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from .config import settings
from .models.database import Base, User, Chat, Message, ChatType, OrgMember
from .services.transcription import transcription_service
from .utils.db_url import get_database_url
from .services.documents import document_parser
from .services.external_links import external_link_processor, LinkType

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


async def process_external_links_in_message(text: str, org_id: int, owner_id: int | None, chat_id: int):
    """
    Automatically detect and process external links in message text.
    Parses Google Docs/Sheets/Forms and saves content as chat messages (not CallRecordings).
    """
    from .services.google_docs import google_docs_service
    from datetime import datetime

    try:
        # Extract all URLs from message
        urls = URL_PATTERN.findall(text)
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


@dp.message(F.chat.type.in_({"group", "supergroup"}))
async def collect_group_message(message: types.Message):
    """Silently collect all messages from groups."""
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

    await message.answer(
        "🤖 Чат Аналитика\n\n"
        "Добавьте меня в группу для анализа сообщений.\n"
        "Используйте веб-панель для просмотра аналитики.\n\n"
        "📋 Команды:\n"
        "/bind <email> — привязать аккаунт\n"
        "/settype — установить тип чата (в группе)\n"
        "/chats — список ваших чатов"
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
