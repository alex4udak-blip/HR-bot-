import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routes import auth, users, chats, messages, criteria, ai, stats

# Configure logging - show important messages
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout
)

# Suppress noisy loggers but keep important ones
for noisy_logger in [
    "uvicorn.access",
    "sqlalchemy.engine",
    "httpx", "httpcore",
    "watchfiles"
]:
    logging.getLogger(noisy_logger).setLevel(logging.WARNING)

# Our app logger
logger = logging.getLogger("hr-analyzer")
logger.setLevel(logging.INFO)

# Static files directory (built frontend)
STATIC_DIR = Path(__file__).parent / "static"


async def init_database():
    """Initialize database in background."""
    from api.database import engine, AsyncSessionLocal
    from api.models.database import Base
    from api.services.auth import create_superadmin_if_not_exists
    from sqlalchemy import text

    for attempt in range(5):
        try:
            async with engine.begin() as conn:
                # Add all enum values to chattype if they don't exist (PostgreSQL specific)
                enum_values = ['work', 'hr', 'project', 'client', 'contractor', 'sales', 'support', 'custom']
                for value in enum_values:
                    try:
                        await conn.execute(text(f"ALTER TYPE chattype ADD VALUE IF NOT EXISTS '{value}'"))
                    except Exception:
                        pass  # Enum value already exists
                logger.info("Ensured all chattype enum values exist")

                # Create tables if they don't exist (safe, preserves data)
                await conn.run_sync(Base.metadata.create_all)

            # Create superadmin
            async with AsyncSessionLocal() as db:
                await create_superadmin_if_not_exists(db)

            logger.info("Database initialized successfully")
            return
        except Exception as e:
            logger.warning(f"Database init attempt {attempt + 1} failed: {e}")
            await asyncio.sleep(3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - initialize database in background
    db_task = asyncio.create_task(init_database())

    # Start Telegram bot in background
    bot_task = None
    try:
        from api.bot import start_bot
        bot_task = asyncio.create_task(start_bot())
    except Exception:
        pass

    yield

    # Shutdown
    if db_task and not db_task.done():
        db_task.cancel()
    if bot_task:
        bot_task.cancel()
    try:
        from api.bot import stop_bot
        await stop_bot()
    except Exception:
        pass


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
            # Skip API routes - they are handled by routers
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not found")
            # Skip health check
            if full_path == "health":
                raise HTTPException(status_code=404, detail="Not found")
            # Serve static file if exists
            file_path = STATIC_DIR / full_path
            if file_path.exists() and file_path.is_file():
                return FileResponse(file_path)
            # Fallback to index.html for SPA routing
            return FileResponse(index_file)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
