import asyncio
import logging
import sys
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from src.config import Config
from src.database import Database
from src.transcription import TranscriptionService
from src.analyzer import AnalyzerService
from src.handlers import BotHandlers


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


async def main():
    # Load environment variables
    load_dotenv()

    # Initialize configuration
    try:
        config = Config.from_env()
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        sys.exit(1)

    # Initialize services
    db = Database(config.database_url)
    await db.connect()
    logger.info("Database connected")

    transcription = TranscriptionService(config.openai_api_key)
    analyzer = AnalyzerService(config.anthropic_api_key)

    # Initialize bot
    bot = Bot(
        token=config.telegram_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    # Initialize dispatcher
    dp = Dispatcher()

    # Setup handlers
    handlers = BotHandlers(
        config=config,
        db=db,
        transcription=transcription,
        analyzer=analyzer,
    )
    private_router, group_router = handlers.setup(bot)
    dp.include_router(private_router)
    dp.include_router(group_router)

    # Start polling
    logger.info("Bot started")
    try:
        await dp.start_polling(bot, allowed_updates=["message"])
    finally:
        await db.close()
        await bot.session.close()
        logger.info("Bot stopped")


if __name__ == "__main__":
    asyncio.run(main())
