import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routes import auth, users, chats, messages, criteria, ai, stats

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static files directory (built frontend)
STATIC_DIR = Path(__file__).parent / "static"


async def init_database():
    """Initialize database in background."""
    from api.database import engine, Base, AsyncSessionLocal
    from api.services.auth import create_superadmin_if_not_exists

    # Create database tables with retry
    for attempt in range(5):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables created successfully")

            # Create superadmin
            async with AsyncSessionLocal() as db:
                await create_superadmin_if_not_exists(db)
                logger.info("Superadmin check completed")
            return
        except Exception as e:
            logger.warning(f"Database init attempt {attempt + 1}/5 failed: {e}")
            await asyncio.sleep(3)

    logger.error("Failed to initialize database after 5 attempts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting application...")

    # Initialize database in background (don't block startup)
    db_task = asyncio.create_task(init_database())

    # Start Telegram bot in background
    bot_task = None
    try:
        from api.bot import start_bot
        bot_task = asyncio.create_task(start_bot())
        logger.info("Telegram bot task started")
    except Exception as e:
        logger.warning(f"Failed to start Telegram bot: {e}")

    logger.info("Application startup complete - ready for requests")

    yield

    # Shutdown
    logger.info("Shutting down application...")
    if db_task and not db_task.done():
        db_task.cancel()
    if bot_task:
        bot_task.cancel()
    try:
        from api.bot import stop_bot
        await stop_bot()
    except Exception as e:
        logger.warning(f"Error stopping bot: {e}")


app = FastAPI(
    title="HR Candidate Analyzer API",
    description="API for HR candidate analysis with Telegram integration",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(chats.router, prefix="/api/chats", tags=["chats"])
app.include_router(messages.router, prefix="/api/chats", tags=["messages"])
app.include_router(criteria.router, prefix="/api/criteria", tags=["criteria"])
app.include_router(ai.router, prefix="/api/chats", tags=["ai"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


# Serve static files (frontend)
if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        # Catch-all route for SPA - must be last
        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            # Serve index.html for all non-API routes (SPA routing)
            file_path = STATIC_DIR / full_path
            if file_path.exists() and file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(index_file)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
