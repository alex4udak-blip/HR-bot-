import logging
from aiogram import Router, Bot, F
from aiogram.types import Message
from aiogram.filters import Command, CommandStart
from aiogram.enums import ChatType

from .config import Config
from .database import Database
from .transcription import TranscriptionService
from .analyzer import AnalyzerService


logger = logging.getLogger(__name__)

# Create routers
private_router = Router(name="private")
group_router = Router(name="group")


class BotHandlers:
    def __init__(
        self,
        config: Config,
        db: Database,
        transcription: TranscriptionService,
        analyzer: AnalyzerService,
    ):
        self.config = config
        self.db = db
        self.transcription = transcription
        self.analyzer = analyzer

    def setup(self, bot: Bot) -> tuple[Router, Router]:
        """Setup handlers and return routers."""
        self.bot = bot

        # Private chat handlers (commands)
        private_router.message.filter(F.chat.type == ChatType.PRIVATE)

        @private_router.message(CommandStart())
        async def cmd_start(message: Message):
            await self._handle_start(message)

        @private_router.message(Command("chats"))
        async def cmd_chats(message: Message):
            await self._handle_chats(message)

        @private_router.message(Command("analyze"))
        async def cmd_analyze(message: Message):
            await self._handle_analyze(message)

        @private_router.message(Command("ask"))
        async def cmd_ask(message: Message):
            await self._handle_ask(message)

        @private_router.message(Command("criteria"))
        async def cmd_criteria(message: Message):
            await self._handle_criteria(message)

        @private_router.message(Command("help"))
        async def cmd_help(message: Message):
            await self._handle_help(message)

        # Group chat handlers (message collection)
        group_router.message.filter(F.chat.type.in_({ChatType.GROUP, ChatType.SUPERGROUP}))

        @group_router.message(F.text)
        async def handle_text(message: Message):
            await self._collect_text(message)

        @group_router.message(F.voice)
        async def handle_voice(message: Message):
            await self._collect_voice(message)

        @group_router.message(F.video_note)
        async def handle_video_note(message: Message):
            await self._collect_video_note(message)

        @group_router.message(F.document)
        async def handle_document(message: Message):
            await self._collect_document(message)

        return private_router, group_router

    async def _check_admin(self, message: Message) -> bool:
        """Check if user is admin."""
        if not self.config.is_admin(message.from_user.id):
            await message.reply("⛔ У вас нет доступа к этому боту.")
            return False
        return True

    async def _handle_start(self, message: Message):
        """Handle /start command."""
        if not await self._check_admin(message):
            return

        await message.reply(
            "👋 Привет! Я бот для анализа кандидатов в групповых чатах.\n\n"
            "Добавьте меня в группу, и я буду молча собирать сообщения. "
            "Затем вы можете получить анализ участников прямо здесь.\n\n"
            "📋 Команды:\n"
            "/chats — список отслеживаемых чатов\n"
            "/analyze <chat_id> — анализ кандидатов\n"
            "/ask <chat_id> <вопрос> — задать вопрос по чату\n"
            "/criteria <chat_id> <критерии> — установить критерии оценки\n"
            "/help — справка"
        )

    async def _handle_help(self, message: Message):
        """Handle /help command."""
        if not await self._check_admin(message):
            return

        await message.reply(
            "📚 **Справка по использованию бота**\n\n"
            "**Как начать:**\n"
            "1. Добавьте бота в групповой чат\n"
            "2. Дайте боту права на чтение сообщений\n"
            "3. Бот будет молча собирать все сообщения\n\n"
            "**Команды (работают только в личке):**\n\n"
            "`/chats` — показать список всех отслеживаемых чатов с их ID\n\n"
            "`/analyze <chat_id>` — получить полный HR-анализ всех участников чата\n"
            "Пример: `/analyze -1001234567890`\n\n"
            "`/ask <chat_id> <вопрос>` — задать произвольный вопрос по переписке\n"
            "Пример: `/ask -1001234567890 Кто самый активный участник?`\n\n"
            "`/criteria <chat_id> <критерии>` — установить критерии оценки для чата\n"
            "Пример: `/criteria -1001234567890 Python, командная работа, инициативность`\n\n"
            "**Что анализируется:**\n"
            "• Текстовые сообщения\n"
            "• Голосовые сообщения (транскрибируются)\n"
            "• Видео-кружки (транскрибируются)\n"
            "• Документы (только метаданные)",
            parse_mode="Markdown"
        )

    async def _handle_chats(self, message: Message):
        """Handle /chats command."""
        if not await self._check_admin(message):
            return

        chats = await self.db.get_all_chats()

        if not chats:
            await message.reply(
                "📭 Нет отслеживаемых чатов.\n"
                "Добавьте меня в группу, чтобы начать сбор данных."
            )
            return

        lines = ["📋 **Отслеживаемые чаты:**\n"]
        for chat in chats:
            stats = await self.db.get_chat_statistics(chat.chat_id)
            criteria_text = f"\n   📌 Критерии: {chat.criteria}" if chat.criteria else ""
            lines.append(
                f"• **{chat.title}**\n"
                f"   ID: `{chat.chat_id}`\n"
                f"   💬 {stats['total_messages']} сообщений, "
                f"👥 {stats['unique_users']} участников"
                f"{criteria_text}\n"
            )

        await message.reply("\n".join(lines), parse_mode="Markdown")

    async def _handle_analyze(self, message: Message):
        """Handle /analyze command."""
        if not await self._check_admin(message):
            return

        args = message.text.split(maxsplit=1)
        if len(args) < 2:
            await message.reply(
                "⚠️ Укажите ID чата.\n"
                "Пример: `/analyze -1001234567890`\n"
                "Используйте /chats чтобы увидеть список чатов.",
                parse_mode="Markdown"
            )
            return

        try:
            chat_id = int(args[1])
        except ValueError:
            await message.reply("⚠️ Некорректный ID чата. ID должен быть числом.")
            return

        chat = await self.db.get_chat(chat_id)
        if not chat:
            await message.reply("⚠️ Чат не найден. Используйте /chats для списка чатов.")
            return

        status_msg = await message.reply("⏳ Анализирую переписку, это может занять некоторое время...")

        try:
            messages = await self.db.get_messages_by_chat(chat_id)
            users = await self.db.get_users_in_chat(chat_id)

            analysis = await self.analyzer.analyze_chat(
                messages=messages,
                users=users,
                chat_title=chat.title,
                criteria=chat.criteria,
            )

            # Split long messages
            if len(analysis) > 4000:
                parts = [analysis[i:i+4000] for i in range(0, len(analysis), 4000)]
                await status_msg.edit_text(f"📊 **Анализ чата \"{chat.title}\"** (часть 1/{len(parts)}):\n\n{parts[0]}", parse_mode="Markdown")
                for i, part in enumerate(parts[1:], 2):
                    await message.answer(f"(часть {i}/{len(parts)}):\n\n{part}", parse_mode="Markdown")
            else:
                await status_msg.edit_text(f"📊 **Анализ чата \"{chat.title}\":**\n\n{analysis}", parse_mode="Markdown")

        except Exception as e:
            logger.exception("Error analyzing chat")
            await status_msg.edit_text(f"❌ Ошибка при анализе: {str(e)}")

    async def _handle_ask(self, message: Message):
        """Handle /ask command."""
        if not await self._check_admin(message):
            return

        args = message.text.split(maxsplit=2)
        if len(args) < 3:
            await message.reply(
                "⚠️ Укажите ID чата и вопрос.\n"
                "Пример: `/ask -1001234567890 Кто самый активный?`",
                parse_mode="Markdown"
            )
            return

        try:
            chat_id = int(args[1])
        except ValueError:
            await message.reply("⚠️ Некорректный ID чата.")
            return

        question = args[2]

        chat = await self.db.get_chat(chat_id)
        if not chat:
            await message.reply("⚠️ Чат не найден. Используйте /chats для списка чатов.")
            return

        status_msg = await message.reply("⏳ Ищу ответ...")

        try:
            messages = await self.db.get_messages_by_chat(chat_id)
            answer = await self.analyzer.ask_question(
                messages=messages,
                question=question,
                chat_title=chat.title,
            )

            await status_msg.edit_text(f"💬 **Ответ:**\n\n{answer}", parse_mode="Markdown")

        except Exception as e:
            logger.exception("Error answering question")
            await status_msg.edit_text(f"❌ Ошибка: {str(e)}")

    async def _handle_criteria(self, message: Message):
        """Handle /criteria command."""
        if not await self._check_admin(message):
            return

        args = message.text.split(maxsplit=2)
        if len(args) < 3:
            await message.reply(
                "⚠️ Укажите ID чата и критерии.\n"
                "Пример: `/criteria -1001234567890 Python, коммуникация, лидерство`",
                parse_mode="Markdown"
            )
            return

        try:
            chat_id = int(args[1])
        except ValueError:
            await message.reply("⚠️ Некорректный ID чата.")
            return

        criteria = args[2]

        success = await self.db.set_criteria(chat_id, criteria)
        if success:
            await message.reply(f"✅ Критерии для чата установлены:\n{criteria}")
        else:
            await message.reply("⚠️ Чат не найден. Используйте /chats для списка чатов.")

    # Group message collectors

    async def _collect_text(self, message: Message):
        """Collect text message from group."""
        if not message.text or message.text.startswith("/"):
            return

        await self._ensure_chat_exists(message)
        await self.db.add_message(
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            message_type="text",
            content=message.text,
        )
        logger.debug(f"Collected text from {message.from_user.id} in {message.chat.id}")

    async def _collect_voice(self, message: Message):
        """Collect and transcribe voice message."""
        await self._ensure_chat_exists(message)

        try:
            transcription = await self.transcription.download_and_transcribe(
                bot=self.bot,
                file_id=message.voice.file_id,
                is_video=False,
            )

            await self.db.add_message(
                chat_id=message.chat.id,
                user_id=message.from_user.id,
                username=message.from_user.username,
                first_name=message.from_user.first_name,
                last_name=message.from_user.last_name,
                message_type="voice",
                content=transcription,
                file_id=message.voice.file_id,
            )
            logger.debug(f"Collected voice from {message.from_user.id} in {message.chat.id}")

        except Exception as e:
            logger.exception(f"Error transcribing voice: {e}")
            # Save with placeholder if transcription fails
            await self.db.add_message(
                chat_id=message.chat.id,
                user_id=message.from_user.id,
                username=message.from_user.username,
                first_name=message.from_user.first_name,
                last_name=message.from_user.last_name,
                message_type="voice",
                content="[Голосовое сообщение - не удалось транскрибировать]",
                file_id=message.voice.file_id,
            )

    async def _collect_video_note(self, message: Message):
        """Collect and transcribe video note (круглое видео)."""
        await self._ensure_chat_exists(message)

        try:
            transcription = await self.transcription.download_and_transcribe(
                bot=self.bot,
                file_id=message.video_note.file_id,
                is_video=True,
            )

            await self.db.add_message(
                chat_id=message.chat.id,
                user_id=message.from_user.id,
                username=message.from_user.username,
                first_name=message.from_user.first_name,
                last_name=message.from_user.last_name,
                message_type="video_note",
                content=transcription,
                file_id=message.video_note.file_id,
            )
            logger.debug(f"Collected video_note from {message.from_user.id} in {message.chat.id}")

        except Exception as e:
            logger.exception(f"Error transcribing video note: {e}")
            await self.db.add_message(
                chat_id=message.chat.id,
                user_id=message.from_user.id,
                username=message.from_user.username,
                first_name=message.from_user.first_name,
                last_name=message.from_user.last_name,
                message_type="video_note",
                content="[Видео-кружок - не удалось транскрибировать]",
                file_id=message.video_note.file_id,
            )

    async def _collect_document(self, message: Message):
        """Collect document metadata."""
        await self._ensure_chat_exists(message)

        doc = message.document
        content = f"Документ: {doc.file_name or 'без имени'}"
        if doc.mime_type:
            content += f" ({doc.mime_type})"

        await self.db.add_message(
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            message_type="document",
            content=content,
            file_id=doc.file_id,
        )
        logger.debug(f"Collected document from {message.from_user.id} in {message.chat.id}")

    async def _ensure_chat_exists(self, message: Message):
        """Ensure chat is registered in database."""
        await self.db.add_or_update_chat(
            chat_id=message.chat.id,
            title=message.chat.title or "Unknown",
        )
