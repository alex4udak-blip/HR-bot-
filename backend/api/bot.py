import asyncio
import logging
from datetime import datetime
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, ChatMemberUpdatedFilter, IS_NOT_MEMBER, IS_MEMBER
from aiogram.types import ChatMemberUpdated, ContentType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from .config import settings
from .models.database import Base, User, Chat, Message
from .services.transcription import transcription_service
from .services.documents import document_parser

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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


# Database session - convert postgresql:// to postgresql+asyncpg://
database_url = settings.database_url
if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(database_url, echo=False, pool_pre_ping=True)
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


async def get_or_create_chat(session: AsyncSession, telegram_chat: types.Chat, owner_id: int | None) -> Chat:
    """Get existing chat or create new one."""
    result = await session.execute(
        select(Chat).where(Chat.telegram_chat_id == telegram_chat.id)
    )
    chat = result.scalar_one_or_none()

    if not chat:
        chat = Chat(
            telegram_chat_id=telegram_chat.id,
            title=telegram_chat.title or telegram_chat.full_name,
            chat_type=telegram_chat.type,
            owner_id=owner_id,
        )
        session.add(chat)
        await session.commit()
        await session.refresh(chat)
        logger.info(f"Created new chat: {chat.title} (owner_id: {owner_id})")
    elif owner_id and not chat.owner_id:
        # Update owner if not set
        chat.owner_id = owner_id
        await session.commit()
        logger.info(f"Updated chat owner: {chat.title} -> {owner_id}")

    return chat


@dp.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=IS_NOT_MEMBER >> IS_MEMBER))
async def on_bot_added(event: ChatMemberUpdated):
    """Handle bot being added to a chat - auto-bind to the user who added it."""
    async with async_session() as session:
        # Find who added the bot
        adder_id = event.from_user.id
        owner = await find_user_by_telegram_id(session, adder_id)

        owner_id = owner.id if owner else None

        # Create or get the chat
        chat = await get_or_create_chat(session, event.chat, owner_id)

        if owner:
            logger.info(f"Bot added to '{event.chat.title}' by user {owner.email} (telegram: {adder_id})")
        else:
            logger.info(f"Bot added to '{event.chat.title}' by unregistered telegram user {adder_id}")


@dp.message(F.chat.type.in_({"group", "supergroup"}))
async def collect_group_message(message: types.Message):
    """Silently collect all messages from groups."""
    async with async_session() as session:
        # Get or create the chat
        chat = await get_or_create_chat(session, message.chat, None)

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
                logger.error(f"Voice transcription error: {e}")
                content = "[Voice message - transcription failed]"

        elif message.video_note:
            content_type = "video_note"
            file_name = "video_note.mp4"
            try:
                file = await get_bot().get_file(message.video_note.file_id)
                file_bytes = await get_bot().download_file(file.file_path)
                content = await transcription_service.transcribe_video(file_bytes.read())
            except Exception as e:
                logger.error(f"Video note transcription error: {e}")
                content = "[Video note - transcription failed]"

        elif message.video:
            content_type = "video"
            file_name = message.video.file_name or "video.mp4"
            if message.video.file_size < 20 * 1024 * 1024:  # 20MB limit
                try:
                    file = await get_bot().get_file(message.video.file_id)
                    file_bytes = await get_bot().download_file(file.file_path)
                    content = await transcription_service.transcribe_video(file_bytes.read())
                except Exception as e:
                    logger.error(f"Video transcription error: {e}")
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
                    logger.error(f"Audio transcription error: {e}")
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
                    logger.info(f"Parsed document: {file_name} - status: {parse_status}")
                except Exception as e:
                    logger.error(f"Document parsing error: {e}")
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
                timestamp=message.date,
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
                logger.info(f"OCR photo: status: {parse_status}")
            except Exception as e:
                logger.error(f"Photo OCR error: {e}")
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
                timestamp=message.date,
            )
            session.add(db_message)
            await session.commit()
            return  # Early return

        elif message.sticker:
            content_type = "sticker"
            content = f"[Sticker: {message.sticker.emoji or ''}]"

        # Save message (for text, voice, video, audio, sticker)
        db_message = Message(
            chat_id=chat.id,
            telegram_message_id=message.message_id,
            telegram_user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            content=content,
            content_type=content_type,
            file_name=file_name,
            timestamp=message.date,
        )
        session.add(db_message)
        await session.commit()


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """Handle /start command in private chat."""
    if message.chat.type != "private":
        return

    await message.answer(
        "HR Candidate Analyzer Bot\n\n"
        "Добавьте меня в группу для сбора сообщений кандидатов.\n"
        "Используйте веб-панель для анализа и управления.\n\n"
        "Для привязки аккаунта используйте команду /bind <email>"
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


async def start_bot():
    """Start the bot polling."""
    try:
        bot_instance = get_bot()
        logger.info("Starting Telegram bot...")
        await dp.start_polling(bot_instance)
    except ValueError as e:
        logger.warning(f"Bot not started: {e}")
    except Exception as e:
        logger.error(f"Bot startup failed: {e}")


async def stop_bot():
    """Stop the bot."""
    global bot
    if bot:
        await bot.session.close()
