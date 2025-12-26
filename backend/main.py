import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from sqlalchemy import text
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from api.limiter import limiter
from api.routes import auth, users, chats, messages, criteria, ai, stats, entities, calls, entity_ai, organizations, sharing, departments, invitations, realtime, admin, external_links
from api.config import settings

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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers to all responses."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "connect-src 'self' ws: wss:; "
            "script-src 'self' 'unsafe-inline'"
        )
        return response


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
    await run_migration(engine, "ALTER TYPE callsource ADD VALUE IF NOT EXISTS 'fireflies'", "Add fireflies to callsource enum")

    # External links integration migrations
    await run_migration(engine, "ALTER TYPE callsource ADD VALUE IF NOT EXISTS 'google_doc'", "Add google_doc to callsource enum")
    await run_migration(engine, "ALTER TYPE callsource ADD VALUE IF NOT EXISTS 'google_drive'", "Add google_drive to callsource enum")
    await run_migration(engine, "ALTER TYPE callsource ADD VALUE IF NOT EXISTS 'direct_url'", "Add direct_url to callsource enum")
    await run_migration(engine, "ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS fireflies_transcript_id VARCHAR(100)", "Add fireflies_transcript_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_call_recordings_fireflies_transcript_id ON call_recordings(fireflies_transcript_id)", "Index fireflies_transcript_id on existing table")

    await run_migration(engine, "ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP", "Add deleted_at to chats")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_chats_deleted_at ON chats(deleted_at)", "Index chats.deleted_at")
    await run_migration(engine, "ALTER TABLE chats ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL", "Add entity_id to chats")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_chats_entity_id ON chats(entity_id)", "Index chats.entity_id")
    await run_migration(engine, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_path VARCHAR(512)", "Add file_path to messages")
    await run_migration(engine, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_imported BOOLEAN DEFAULT FALSE", "Add is_imported to messages")
    await run_migration(engine, "ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL", "Add entity_id to analysis_history")

    # User security columns (for token invalidation and brute-force protection)
    await run_migration(engine, "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0", "Add token_version to users")
    await run_migration(engine, "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0", "Add failed_login_attempts to users")
    await run_migration(engine, "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP", "Add locked_until to users")

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

    # Step 8: Departments
    logger.info("=== SETTING UP DEPARTMENTS ===")

    # Create deptrole enum
    await run_migration(engine, "CREATE TYPE deptrole AS ENUM ('lead', 'member')", "Create deptrole enum")

    # Create departments table
    create_departments = """
        CREATE TABLE IF NOT EXISTS departments (
            id SERIAL PRIMARY KEY,
            org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            color VARCHAR(20),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """
    await run_migration(engine, create_departments, "Create departments table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_departments_org_id ON departments(org_id)", "Index departments.org_id")

    # Create department_members table
    create_department_members = """
        CREATE TABLE IF NOT EXISTS department_members (
            id SERIAL PRIMARY KEY,
            department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role deptrole DEFAULT 'member',
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(department_id, user_id)
        )
    """
    await run_migration(engine, create_department_members, "Create department_members table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_department_members_department_id ON department_members(department_id)", "Index department_members.department_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_department_members_user_id ON department_members(user_id)", "Index department_members.user_id")

    # Add parent_id to departments for sub-departments support
    await run_migration(engine, "ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES departments(id) ON DELETE CASCADE", "Add parent_id to departments")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_departments_parent_id ON departments(parent_id)", "Index departments.parent_id")

    # Add department_id to entities
    await run_migration(engine, "ALTER TABLE entities ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL", "Add department_id to entities")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entities_department_id ON entities(department_id)", "Index entities.department_id")

    # Update entity_transfers to use department_id instead of string
    await run_migration(engine, "ALTER TABLE entity_transfers ADD COLUMN IF NOT EXISTS from_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL", "Add from_department_id to entity_transfers")
    await run_migration(engine, "ALTER TABLE entity_transfers ADD COLUMN IF NOT EXISTS to_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL", "Add to_department_id to entity_transfers")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entity_transfers_from_department_id ON entity_transfers(from_department_id)", "Index entity_transfers.from_department_id")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entity_transfers_to_department_id ON entity_transfers(to_department_id)", "Index entity_transfers.to_department_id")

    logger.info("=== DEPARTMENTS TABLES READY ===")

    # Add sub_admin to deptrole enum (for SUB_ADMIN role)
    await run_migration(engine, "ALTER TYPE deptrole ADD VALUE IF NOT EXISTS 'sub_admin'", "Add sub_admin to deptrole enum")

    # Entity transfer tracking columns
    await run_migration(engine, "ALTER TABLE entities ADD COLUMN IF NOT EXISTS is_transferred BOOLEAN DEFAULT FALSE", "Add is_transferred to entities")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_entities_is_transferred ON entities(is_transferred)", "Index entities.is_transferred")
    await run_migration(engine, "ALTER TABLE entities ADD COLUMN IF NOT EXISTS transferred_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL", "Add transferred_to_id to entities")
    await run_migration(engine, "ALTER TABLE entities ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMP", "Add transferred_at to entities")

    # Step 8: Invitations table
    logger.info("=== SETTING UP INVITATIONS ===")
    create_invitations = """
        CREATE TABLE IF NOT EXISTS invitations (
            id SERIAL PRIMARY KEY,
            token VARCHAR(64) UNIQUE NOT NULL,
            org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            email VARCHAR(255),
            name VARCHAR(255),
            org_role orgrole DEFAULT 'member',
            department_ids JSONB DEFAULT '[]'::jsonb,
            invited_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMP,
            used_at TIMESTAMP,
            used_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """
    await run_migration(engine, create_invitations, "Create invitations table")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_invitations_token ON invitations(token)", "Index invitations.token")
    await run_migration(engine, "CREATE INDEX IF NOT EXISTS ix_invitations_org_id ON invitations(org_id)", "Index invitations.org_id")

    logger.info("=== INVITATIONS TABLE READY ===")

    # Step 9: Create superadmin and default organization
    try:
        async with AsyncSessionLocal() as db:
            await create_superadmin_if_not_exists(db)
    except Exception as e:
        logger.warning(f"Superadmin creation: {e}")

    # Step 10: Fix chats with NULL org_id - assign them to the default organization
    logger.info("=== FIXING CHATS WITH NULL ORG_ID ===")
    try:
        async with engine.begin() as conn:
            # Get the first organization (default org)
            result = await conn.execute(text("SELECT id FROM organizations ORDER BY id LIMIT 1"))
            org_row = result.fetchone()
            if org_row:
                default_org_id = org_row[0]
                # Update all chats with NULL org_id
                update_result = await conn.execute(
                    text("UPDATE chats SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": default_org_id}
                )
                logger.info(f"Updated {update_result.rowcount} chats with NULL org_id to org_id={default_org_id}")

                # Also update entities and call_recordings with NULL org_id
                await conn.execute(
                    text("UPDATE entities SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": default_org_id}
                )
                await conn.execute(
                    text("UPDATE call_recordings SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": default_org_id}
                )
    except Exception as e:
        logger.warning(f"Fix NULL org_id: {e}")

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


async def check_playwright_status():
    """Check Playwright status at startup and log the result."""
    import os
    browsers_path = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', 'not set')
    logger.info(f"Playwright environment check - PLAYWRIGHT_BROWSERS_PATH: {browsers_path}")

    try:
        from api.services.external_links import ensure_playwright_installed
        is_ready = await ensure_playwright_installed()
        if is_ready:
            logger.info("✓ Playwright is ready for browser automation (Fireflies scraping)")
        else:
            logger.warning("✗ Playwright is NOT available - Fireflies links will fail. "
                         "Ensure Playwright is installed: pip install playwright && playwright install chromium")
    except Exception as e:
        logger.error(f"✗ Playwright check failed: {type(e).__name__}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - initialize database (wait for it to complete)
    try:
        await asyncio.wait_for(init_database(), timeout=120)
    except asyncio.TimeoutError:
        logger.error("Database initialization timed out")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")

    # Check Playwright status (for Fireflies link processing)
    try:
        await asyncio.wait_for(check_playwright_status(), timeout=30)
    except asyncio.TimeoutError:
        logger.warning("Playwright check timed out")
    except Exception as e:
        logger.warning(f"Playwright check failed: {e}")

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

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - use allowed origins from settings (not wildcard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

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
app.include_router(sharing.router, prefix="/api/sharing", tags=["sharing"])
app.include_router(departments.router, prefix="/api/departments", tags=["departments"])
app.include_router(invitations.router, prefix="/api/invitations", tags=["invitations"])
app.include_router(realtime.router, tags=["realtime"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(external_links.router, tags=["external-links"])


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/health/playwright")
async def playwright_health_check():
    """Check Playwright browser status for debugging Fireflies scraping issues."""
    import os

    result = {
        "browsers_path": os.environ.get('PLAYWRIGHT_BROWSERS_PATH', 'not set'),
        "playwright_installed": False,
        "chromium_available": False,
        "error": None
    }

    try:
        import playwright
        result["playwright_installed"] = True
        result["playwright_version"] = playwright.__version__
    except ImportError as e:
        result["error"] = f"Playwright not installed: {e}"
        return result

    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            result["chromium_available"] = True
            result["browser_version"] = browser.version
            await browser.close()
    except Exception as e:
        result["error"] = f"Chromium launch failed: {type(e).__name__}: {e}"

    return result


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
