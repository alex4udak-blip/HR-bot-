import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routes import auth, users, chats, messages, criteria, ai, stats, entities, calls, entity_ai, organizations

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


async def run_migration(engine, sql: str, description: str):
    """Run a single migration in its own transaction."""
    try:
        async with engine.begin() as conn:
            from sqlalchemy import text
            await conn.execute(text(sql))
        logger.info(f"Migration OK: {description}")
        return True
    except Exception as e:
        logger.debug(f"Migration skipped ({description}): {e}")
        return False


async def init_database():
    """Initialize database with separate transactions for each migration."""
    from api.database import engine, AsyncSessionLocal
    from api.models.database import Base
    from api.services.auth import create_superadmin_if_not_exists
    from sqlalchemy import text

    logger.info("=== DATABASE INITIALIZATION START ===")

    # Step 1: Create enum types (each in separate transaction)
    new_enums = [
        ("entitytype", ['candidate', 'client', 'contractor', 'lead', 'partner', 'custom']),
        ("entitystatus", ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'active', 'paused', 'churned', 'converted', 'ended', 'negotiation']),
        ("callsource", ['meet', 'zoom', 'teams', 'upload', 'telegram']),
        ("callstatus", ['pending', 'connecting', 'recording', 'processing', 'transcribing', 'analyzing', 'done', 'failed']),
        ("reporttype", ['daily_hr', 'weekly_summary', 'daily_calls', 'weekly_pipeline']),
        ("deliverymethod", ['telegram', 'email'])
    ]

    for enum_name, values in new_enums:
        values_str = ', '.join([f"'{v}'" for v in values])
        await run_migration(engine, f"CREATE TYPE {enum_name} AS ENUM ({values_str})", f"Create {enum_name} enum")

    # Step 2: Add enum values to chattype (each in separate transaction)
    for value in ['work', 'hr', 'project', 'client', 'contractor', 'sales', 'support', 'custom']:
        await run_migration(engine, f"ALTER TYPE chattype ADD VALUE IF NOT EXISTS '{value}'", f"Add {value} to chattype")

    # Step 3: Create all tables
    logger.info("Creating tables with create_all...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Tables created successfully")
    except Exception as e:
        logger.error(f"Error creating tables: {e}")
        return

    # Step 4: Create call_recordings table if not exists (preserves existing data)
    logger.info("=== SETTING UP call_recordings TABLE ===")

    # Create table only if it doesn't exist
    create_call_recordings_sql = """
        CREATE TABLE IF NOT EXISTS call_recordings (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255),
            entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
            owner_id INTEGER REFERENCES users(id),
            source_type callsource NOT NULL,
            source_url VARCHAR(500),
            bot_name VARCHAR(100) DEFAULT 'HR Recorder',
            status callstatus DEFAULT 'pending',
            duration_seconds INTEGER,
            audio_file_path VARCHAR(500),
            fireflies_transcript_id VARCHAR(100),
            transcript TEXT,
            speakers JSONB,
            summary TEXT,
            action_items JSONB,
            key_points JSONB,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            started_at TIMESTAMP,
            ended_at TIMESTAMP,
            processed_at TIMESTAMP
        )
    """
    await run_migration(engine, create_call_recordings_sql, "Create call_recordings table")

    # Create indexes
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_entity_id ON call_recordings(entity_id)", "Index entity_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_owner_id ON call_recordings(owner_id)", "Index owner_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_status ON call_recordings(status)", "Index status")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_fireflies_transcript_id ON call_recordings(fireflies_transcript_id)", "Index fireflies_transcript_id")

    logger.info("=== call_recordings TABLE READY ===")

    # Step 5: Other column migrations

    # Fireflies integration migrations
    await run_migration(engine, "ALTER TYPE callsource ADD VALUE IF NOT EXISTS 'teams'", "Add teams to callsource enum")
    await run_migration(engine, "ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS fireflies_transcript_id VARCHAR(100)", "Add fireflies_transcript_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_fireflies_transcript_id ON call_recordings(fireflies_transcript_id)", "Index fireflies_transcript_id on existing table")

    await run_migration(engine, "ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP", "Add deleted_at to chats")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_chats_deleted_at ON chats(deleted_at)", "Index chats.deleted_at")
    await run_migration(engine, "ALTER TABLE chats ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL", "Add entity_id to chats")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_chats_entity_id ON chats(entity_id)", "Index chats.entity_id")
    await run_migration(engine, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_path VARCHAR(512)", "Add file_path to messages")
    await run_migration(engine, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_imported BOOLEAN DEFAULT FALSE", "Add is_imported to messages")
    await run_migration(engine, "ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL", "Add entity_id to analysis_history")

    # Entity AI tables
    create_entity_ai_conversations = """
        CREATE TABLE IF NOT EXISTS entity_ai_conversations (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            messages JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """
    await run_migration(engine, create_entity_ai_conversations, "Create entity_ai_conversations table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entity_ai_conversations_entity_id ON entity_ai_conversations(entity_id)", "Index entity_ai_conversations.entity_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entity_ai_conversations_user_id ON entity_ai_conversations(user_id)", "Index entity_ai_conversations.user_id")

    create_entity_analyses = """
        CREATE TABLE IF NOT EXISTS entity_analyses (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            analysis_type VARCHAR(50),
            result TEXT NOT NULL,
            scores JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """
    await run_migration(engine, create_entity_analyses, "Create entity_analyses table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entity_analyses_entity_id ON entity_analyses(entity_id)", "Index entity_analyses.entity_id")

    # Step 6: Multi-tenancy - Organizations
    logger.info("=== SETTING UP MULTI-TENANCY ===")

    # Create enums for organizations
    await run_migration(engine, "CREATE TYPE orgrole AS ENUM ('owner', 'admin', 'member')", "Create orgrole enum")
    await run_migration(engine, "CREATE TYPE subscriptionplan AS ENUM ('free', 'pro', 'enterprise')", "Create subscriptionplan enum")

    # Create organizations table
    create_organizations = """
        CREATE TABLE IF NOT EXISTS organizations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(100) UNIQUE NOT NULL,
            subscription_plan subscriptionplan DEFAULT 'free',
            settings JSONB DEFAULT '{}'::jsonb,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """
    await run_migration(engine, create_organizations, "Create organizations table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_organizations_slug ON organizations(slug)", "Index organizations.slug")

    # Create org_members table
    create_org_members = """
        CREATE TABLE IF NOT EXISTS org_members (
            id SERIAL PRIMARY KEY,
            org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role orgrole DEFAULT 'member',
            invited_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(org_id, user_id)
        )
    """
    await run_migration(engine, create_org_members, "Create org_members table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_org_members_org_id ON org_members(org_id)", "Index org_members.org_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_org_members_user_id ON org_members(user_id)", "Index org_members.user_id")

    # Add org_id to existing tables
    await run_migration(engine, "ALTER TABLE chats ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE", "Add org_id to chats")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_chats_org_id ON chats(org_id)", "Index chats.org_id")

    await run_migration(engine, "ALTER TABLE entities ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE", "Add org_id to entities")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entities_org_id ON entities(org_id)", "Index entities.org_id")

    await run_migration(engine, "ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE", "Add org_id to call_recordings")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_org_id ON call_recordings(org_id)", "Index call_recordings.org_id")

    logger.info("=== MULTI-TENANCY TABLES READY ===")

    # Step 7: Create superadmin and default organization
    try:
        async with AsyncSessionLocal() as db:
            await create_superadmin_if_not_exists(db)
    except Exception as e:
        logger.warning(f"Superadmin creation: {e}")

    logger.info("=== DATABASE INITIALIZATION COMPLETE ===")


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
        await asyncio.wait_for(init_database(), timeout=120)
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
app.include_router(entity_ai.router, prefix="/api", tags=["entity-ai"])
app.include_router(organizations.router, prefix="/api/organizations", tags=["organizations"])


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
