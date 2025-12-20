import asyncio
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from api.config import get_settings
from api.database import init_db, AsyncSessionLocal
from api.routes import api_router
from api.services.auth import create_superadmin_if_not_exists
from api.bot import create_bot

# Load environment
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

settings = get_settings()

# Bot instance
bot_instance = None
bot_task = None


async def start_bot():
    """Start Telegram bot polling."""
    global bot_instance
    bot, dp = create_bot()
    bot_instance = bot
    logger.info("Starting Telegram bot...")
    await dp.start_polling(bot, allowed_updates=["message", "my_chat_member"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_task

    # Initialize database
    await init_db()
    logger.info("Database initialized")

    # Create superadmin if not exists
    async with AsyncSessionLocal() as db:
        await create_superadmin_if_not_exists(db)

    # Start bot in background
    if settings.telegram_bot_token:
        bot_task = asyncio.create_task(start_bot())
        logger.info("Telegram bot task started")

    yield

    # Cleanup
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass

    if bot_instance:
        await bot_instance.session.close()

    logger.info("Application shutdown complete")


app = FastAPI(
    title="HR Bot Admin API",
    description="API for HR Candidate Analyzer Bot",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
