import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routes import auth, users, chats, messages, criteria, ai, stats, entities, calls

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

                # Create new enum types for entities and calls if they don't exist
                new_enums = [
                    ("entitytype", ['candidate', 'client', 'contractor', 'lead', 'partner', 'custom']),
                    ("entitystatus", ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'active', 'paused', 'churned', 'converted', 'ended', 'negotiation']),
                    ("callsource", ['meet', 'zoom', 'upload', 'telegram']),
                    ("callstatus", ['pending', 'connecting', 'recording', 'processing', 'transcribing', 'analyzing', 'done', 'failed']),
                    ("reporttype", ['daily_hr', 'weekly_summary', 'daily_calls', 'weekly_pipeline']),
                    ("deliverymethod", ['telegram', 'email'])
                ]
                for enum_name, values in new_enums:
                    try:
                        values_str = ', '.join([f"'{v}'" for v in values])
                        await conn.execute(text(f"CREATE TYPE {enum_name} AS ENUM ({values_str})"))
                        logger.info(f"Created enum type {enum_name}")
                    except Exception:
                        pass  # Enum already exists

                # Add deleted_at column if it doesn't exist
                try:
                    await conn.execute(text(
                        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP"
                    ))
                    await conn.execute(text(
                        "CREATE INDEX IF NOT EXISTS ix_chats_deleted_at ON chats(deleted_at)"
                    ))
                    logger.info("Added deleted_at column to chats table")
                except Exception:
                    pass  # Column already exists

                # Migrate content column to TEXT if it's VARCHAR
                try:
                    await conn.execute(text(
                        "ALTER TABLE messages ALTER COLUMN content TYPE TEXT"
                    ))
                    logger.info("Migrated messages.content to TEXT")
                except Exception:
                    pass  # Already TEXT or table doesn't exist

                # Add file_path column for imported media
                try:
                    await conn.execute(text(
                        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_path VARCHAR(512)"
                    ))
                    logger.info("Added file_path column to messages table")
                except Exception:
                    pass  # Column already exists

                # Add is_imported column to track imported messages
                try:
                    await conn.execute(text(
                        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_imported BOOLEAN DEFAULT FALSE"
                    ))
                    logger.info("Added is_imported column to messages table")
                    # Mark existing messages with file_path as imported
                    await conn.execute(text(
                        "UPDATE messages SET is_imported = TRUE WHERE file_path IS NOT NULL AND is_imported = FALSE"
                    ))
                    logger.info("Marked existing messages with file_path as imported")
                except Exception:
                    pass  # Column already exists

                # Create tables if they don't exist (safe, preserves data)
                await conn.run_sync(Base.metadata.create_all)

                # Add entity_id column to chats if it doesn't exist
                try:
                    await conn.execute(text(
                        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL"
                    ))
                    await conn.execute(text(
                        "CREATE INDEX IF NOT EXISTS ix_chats_entity_id ON chats(entity_id)"
                    ))
                    logger.info("Added entity_id column to chats table")
                except Exception:
                    pass  # Column already exists or entities table doesn't exist

                # Add entity_id column to analysis_history if it doesn't exist
                try:
                    await conn.execute(text(
                        "ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL"
                    ))
                    await conn.execute(text(
                        "CREATE INDEX IF NOT EXISTS ix_analysis_history_entity_id ON analysis_history(entity_id)"
                    ))
                    logger.info("Added entity_id column to analysis_history table")
                except Exception:
                    pass  # Column already exists or entities table doesn't exist

                # Add missing columns to call_recordings table
                call_columns = [
                    ("title", "VARCHAR(255)"),
                    ("speakers", "JSONB"),
                    ("action_items", "JSONB"),
                    ("key_points", "JSONB"),
                ]
                for col_name, col_type in call_columns:
                    try:
                        # Check if column exists
                        result = await conn.execute(text(
                            f"SELECT 1 FROM information_schema.columns WHERE table_name='call_recordings' AND column_name='{col_name}'"
                        ))
                        if not result.first():
                            await conn.execute(text(
                                f"ALTER TABLE call_recordings ADD COLUMN {col_name} {col_type}"
                            ))
                            logger.info(f"Added {col_name} column to call_recordings table")
                    except Exception as e:
                        logger.warning(f"Failed to add {col_name} column: {e}")


            # Create superadmin
            async with AsyncSessionLocal() as db:
                await create_superadmin_if_not_exists(db)

            logger.info("Database initialized successfully")
            return
        except Exception as e:
            logger.warning(f"Database init attempt {attempt + 1} failed: {e}")
            await asyncio.sleep(3)


async def cleanup_deleted_chats_task():
    """Periodically clean up chats deleted more than 30 days ago."""
    from api.database import AsyncSessionLocal
    from api.routes.chats import cleanup_old_deleted_chats

    # Wait for database to initialize
    await asyncio.sleep(60)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                count = await cleanup_old_deleted_chats(db)
                if count > 0:
                    logger.info(f"Cleaned up {count} old deleted chats")
        except Exception as e:
            logger.error(f"Error cleaning up deleted chats: {e}")

        # Run every 24 hours
        await asyncio.sleep(86400)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - initialize database (wait for it to complete)
    try:
        await asyncio.wait_for(init_database(), timeout=60)
    except asyncio.TimeoutError:
        logger.error("Database initialization timed out")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")

    # Start Telegram bot in background
    bot_task = None
    try:
        from api.bot import start_bot
        bot_task = asyncio.create_task(start_bot())
    except Exception:
        pass

    # Start cleanup task for old deleted chats
    cleanup_task = asyncio.create_task(cleanup_deleted_chats_task())

    yield

    # Shutdown
    if bot_task:
        bot_task.cancel()
    if cleanup_task:
        cleanup_task.cancel()
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
app.include_router(entities.router, prefix="/api/entities", tags=["entities"])
app.include_router(calls.router, prefix="/api/calls", tags=["calls"])


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
