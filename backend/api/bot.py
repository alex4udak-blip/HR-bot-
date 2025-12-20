import logging
import os
import tempfile
import asyncio
import subprocess
from typing import Optional

from aiogram import Bot, Dispatcher, Router, F
from aiogram.types import Message, ChatMemberUpdated
from aiogram.filters import ChatMemberUpdatedFilter, IS_MEMBER, IS_NOT_MEMBER
from aiogram.enums import ChatType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from .config import get_settings
from .database import AsyncSessionLocal
from .models.database import User, Chat, Message as DBMessage

logger = logging.getLogger(__name__)
settings = get_settings()

router = Router()
openai_client = AsyncOpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None


async def get_db_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        return session


async def transcribe_audio(file_path: str) -> str:
    """Transcribe audio using Whisper API."""
    if not openai_client:
        return "[Транскрипция недоступна]"

    with open(file_path, "rb") as audio_file:
        response = await openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="ru",
        )
    return response.text


async def transcribe_video(file_path: str) -> str:
    """Extract audio from video and transcribe."""
    audio_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            audio_path = tmp.name

        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-i", file_path, "-vn", "-acodec", "libmp3lame",
            "-ar", "16000", "-ac", "1", "-y", audio_path,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        await process.wait()

        if process.returncode != 0:
            return "[Не удалось извлечь аудио]"

        return await transcribe_audio(audio_path)
    finally:
        if audio_path and os.path.exists(audio_path):
            os.unlink(audio_path)


# Handler for bot being added to chat
@router.my_chat_member(ChatMemberUpdatedFilter(IS_NOT_MEMBER >> IS_MEMBER))
async def on_bot_added(event: ChatMemberUpdated):
    """When bot is added to a chat, bind it to the user who added."""
    if event.chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return

    added_by_id = event.from_user.id
    chat_id = event.chat.id
    chat_title = event.chat.title or "Unknown"

    logger.info(f"Bot added to chat {chat_id} ({chat_title}) by user {added_by_id}")

    async with AsyncSessionLocal() as db:
        # Find admin by telegram_id
        result = await db.execute(
            select(User).where(User.telegram_id == added_by_id)
        )
        admin = result.scalar_one_or_none()

        # Check if chat exists
        result = await db.execute(select(Chat).where(Chat.chat_id == chat_id))
        chat = result.scalar_one_or_none()

        if chat:
            # Update existing chat
            chat.title = chat_title
            if admin:
                chat.owner_id = admin.id
        else:
            # Create new chat
            chat = Chat(
                chat_id=chat_id,
                title=chat_title,
                owner_id=admin.id if admin else None,
                is_active=True,
            )
            db.add(chat)

        await db.commit()

        if admin:
            logger.info(f"Chat {chat_id} bound to admin {admin.email}")
        else:
            logger.warning(f"User {added_by_id} not found in admins, chat unassigned")


# Handler for text messages in groups
@router.message(F.chat.type.in_({ChatType.GROUP, ChatType.SUPERGROUP}), F.text)
async def collect_text(message: Message):
    if not message.text or message.text.startswith("/"):
        return

    async with AsyncSessionLocal() as db:
        # Ensure chat exists
        result = await db.execute(select(Chat).where(Chat.chat_id == message.chat.id))
        chat = result.scalar_one_or_none()

        if not chat:
            chat = Chat(
                chat_id=message.chat.id,
                title=message.chat.title or "Unknown",
                is_active=True,
            )
            db.add(chat)
            await db.commit()
            await db.refresh(chat)

        # Add message
        db_message = DBMessage(
            chat_db_id=chat.id,
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            message_type="text",
            content=message.text,
        )
        db.add(db_message)
        await db.commit()


# Handler for voice messages
@router.message(F.chat.type.in_({ChatType.GROUP, ChatType.SUPERGROUP}), F.voice)
async def collect_voice(message: Message, bot: Bot):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Chat).where(Chat.chat_id == message.chat.id))
        chat = result.scalar_one_or_none()

        if not chat:
            chat = Chat(
                chat_id=message.chat.id,
                title=message.chat.title or "Unknown",
                is_active=True,
            )
            db.add(chat)
            await db.commit()
            await db.refresh(chat)

        # Download and transcribe
        content = "[Голосовое сообщение]"
        try:
            file = await bot.get_file(message.voice.file_id)
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
                file_path = tmp.name
            await bot.download_file(file.file_path, destination=file_path)
            content = await transcribe_audio(file_path)
            os.unlink(file_path)
        except Exception as e:
            logger.exception(f"Error transcribing voice: {e}")

        db_message = DBMessage(
            chat_db_id=chat.id,
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            message_type="voice",
            content=content,
            file_id=message.voice.file_id,
        )
        db.add(db_message)
        await db.commit()


# Handler for video notes
@router.message(F.chat.type.in_({ChatType.GROUP, ChatType.SUPERGROUP}), F.video_note)
async def collect_video_note(message: Message, bot: Bot):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Chat).where(Chat.chat_id == message.chat.id))
        chat = result.scalar_one_or_none()

        if not chat:
            chat = Chat(
                chat_id=message.chat.id,
                title=message.chat.title or "Unknown",
                is_active=True,
            )
            db.add(chat)
            await db.commit()
            await db.refresh(chat)

        content = "[Видео-кружок]"
        try:
            file = await bot.get_file(message.video_note.file_id)
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                file_path = tmp.name
            await bot.download_file(file.file_path, destination=file_path)
            content = await transcribe_video(file_path)
            os.unlink(file_path)
        except Exception as e:
            logger.exception(f"Error transcribing video note: {e}")

        db_message = DBMessage(
            chat_db_id=chat.id,
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            message_type="video_note",
            content=content,
            file_id=message.video_note.file_id,
        )
        db.add(db_message)
        await db.commit()


# Handler for documents
@router.message(F.chat.type.in_({ChatType.GROUP, ChatType.SUPERGROUP}), F.document)
async def collect_document(message: Message):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Chat).where(Chat.chat_id == message.chat.id))
        chat = result.scalar_one_or_none()

        if not chat:
            chat = Chat(
                chat_id=message.chat.id,
                title=message.chat.title or "Unknown",
                is_active=True,
            )
            db.add(chat)
            await db.commit()
            await db.refresh(chat)

        doc = message.document
        content = f"Документ: {doc.file_name or 'без имени'}"
        if doc.mime_type:
            content += f" ({doc.mime_type})"

        db_message = DBMessage(
            chat_db_id=chat.id,
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            message_type="document",
            content=content,
            file_id=doc.file_id,
        )
        db.add(db_message)
        await db.commit()


def create_bot() -> tuple[Bot, Dispatcher]:
    """Create bot and dispatcher."""
    bot = Bot(token=settings.telegram_bot_token)
    dp = Dispatcher()
    dp.include_router(router)
    return bot, dp
