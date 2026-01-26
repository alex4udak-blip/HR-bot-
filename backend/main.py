"""
HR Candidate Analyzer API - Main Application Entry Point

This module contains the FastAPI application setup, middleware configuration,
route registration, and lifespan management.
"""

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
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from api.limiter import limiter
from api.routes import auth, users, chats, messages, criteria, ai, stats, entities, calls, entity_ai, organizations, sharing, departments, invitations, realtime, admin, external_links, vacancies, parser, search, scoring, currency, parse_jobs
from api.routes import email_templates, analytics
from api.config import settings
from api.db import init_database, run_alembic_migrations_sync
from api.middleware import SecurityHeadersMiddleware, CorrelationMiddleware
from api.utils.logging import setup_logging, get_logger
from api.services.redis_cache import get_redis, close_redis

# Configure structured logging
# Use JSON format in production, pretty format in development
is_production = settings.database_url.startswith("postgresql")
setup_logging(
    level="INFO",
    json_format=is_production,
)

# Our app logger
logger = get_logger("hr-analyzer")

# Static files directory (built frontend)
STATIC_DIR = Path(__file__).parent / "static"


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
            logger.info("Playwright is ready for browser automation (Fireflies scraping)")
        else:
            logger.warning("Playwright is NOT available - Fireflies links will fail. "
                         "Ensure Playwright is installed: pip install playwright && playwright install chromium")
    except Exception as e:
        logger.error(f"Playwright check failed: {type(e).__name__}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - initialize database (wait for it to complete)
    try:
        await asyncio.wait_for(init_database(), timeout=120)
    except asyncio.TimeoutError:
        logger.error("Database initialization timed out")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")

    # Run Alembic migrations after init_database
    try:
        await asyncio.get_event_loop().run_in_executor(None, run_alembic_migrations_sync)
    except Exception as e:
        logger.warning(f"Alembic migration failed: {e}")

    # Initialize Redis connection
    try:
        redis = await asyncio.wait_for(get_redis(), timeout=10)
        if redis:
            logger.info("Redis cache connected successfully")
        else:
            logger.warning("Redis unavailable, using in-memory cache fallback")
    except asyncio.TimeoutError:
        logger.warning("Redis connection timed out, using in-memory cache")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}, using in-memory cache")

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

    # Log all registered routes for debugging
    logger.info("=== REGISTERED API ROUTES ===")
    vacancy_routes = []
    for route in app.routes:
        if hasattr(route, 'path') and '/vacancies' in route.path:
            methods = list(route.methods) if hasattr(route, 'methods') and route.methods else ['?']
            vacancy_routes.append(f"{methods} {route.path}")
            logger.info(f"VACANCY ROUTE: {methods} {route.path}")
    logger.info(f"Total vacancy routes found: {len(vacancy_routes)}")
    if len(vacancy_routes) == 0:
        logger.error("!!! NO VACANCY ROUTES REGISTERED - CHECK IMPORT ERRORS !!!")

    yield

    # Shutdown
    if bot_task:
        bot_task.cancel()
    if cleanup_task:
        cleanup_task.cancel()

    # Close Redis connection
    try:
        await close_redis()
        logger.info("Redis connection closed")
    except Exception as e:
        logger.warning(f"Error closing Redis: {e}")

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
    redirect_slashes=False,  # Prevent 307 redirects that convert POST to GET
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - use allowed origins from settings (not wildcard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

# Security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# Correlation ID middleware for request tracing
app.add_middleware(CorrelationMiddleware)

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

# Register vacancies and parser routers with explicit logging
logger.info("=== REGISTERING VACANCIES ROUTER ===")
try:
    app.include_router(vacancies.router, prefix="/api/vacancies", tags=["vacancies"])
    logger.info("Vacancies router registered successfully at /api/vacancies")
except Exception as e:
    logger.error(f"FAILED to register vacancies router: {e}")
    raise

logger.info("=== REGISTERING PARSER ROUTER ===")
try:
    app.include_router(parser.router, prefix="/api/parser", tags=["parser"])
    logger.info("Parser router registered successfully at /api/parser")
except Exception as e:
    logger.error(f"FAILED to register parser router: {e}")
    raise

logger.info("=== REGISTERING PARSE JOBS ROUTER ===")
try:
    app.include_router(parse_jobs.router, prefix="/api/parse-jobs", tags=["parse-jobs"])
    logger.info("Parse jobs router registered successfully at /api/parse-jobs")
except Exception as e:
    logger.error(f"FAILED to register parse jobs router: {e}")
    raise

logger.info("=== REGISTERING SEARCH ROUTER ===")
try:
    app.include_router(search.router, prefix="/api/search", tags=["search"])
    logger.info("Search router registered successfully at /api/search")
except Exception as e:
    logger.error(f"FAILED to register search router: {e}")
    raise

logger.info("=== REGISTERING SCORING ROUTER ===")
try:
    app.include_router(scoring.router, prefix="/api/scoring", tags=["scoring"])
    logger.info("Scoring router registered successfully at /api/scoring")
except Exception as e:
    logger.error(f"FAILED to register scoring router: {e}")
    raise

logger.info("=== REGISTERING CURRENCY ROUTER ===")
try:
    app.include_router(currency.router, prefix="/api/currency", tags=["currency"])
    logger.info("Currency router registered successfully at /api/currency")
except Exception as e:
    logger.error(f"FAILED to register currency router: {e}")
    raise

logger.info("=== REGISTERING EMAIL TEMPLATES ROUTER ===")
try:
    app.include_router(email_templates.router, prefix="/api/email-templates", tags=["email-templates"])
    logger.info("Email templates router registered successfully at /api/email-templates")
except Exception as e:
    logger.error(f"FAILED to register email templates router: {e}")
    raise

logger.info("=== REGISTERING ANALYTICS ROUTER ===")
try:
    app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
    logger.info("Analytics router registered successfully at /api/analytics")
except Exception as e:
    logger.error(f"FAILED to register analytics router: {e}")
    raise


@app.get("/health")
async def health_check():
    """
    Health check endpoint for Railway.
    Always returns 200 OK for Railway healthcheck to pass.
    DB status is informational only.
    """
    from datetime import datetime
    from api.database import AsyncSessionLocal

    health = {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

    # Check database (informational, doesn't affect status code)
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        health["database"] = "connected"
    except Exception as e:
        health["database"] = f"degraded: {str(e)}"
        health["status"] = "degraded"  # Informational only

    # Always return 200 for Railway healthcheck
    return health


@app.get("/health/deep")
async def health_check_deep():
    """
    Deep health check that returns 503 if DB is unavailable.
    Use for monitoring/alerting, not for Railway healthcheck.
    """
    from datetime import datetime
    from api.database import AsyncSessionLocal

    health = {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        health["database"] = "connected"
    except Exception as e:
        health["database"] = f"error: {str(e)}"
        health["status"] = "unhealthy"
        raise HTTPException(status_code=503, detail=health)

    return health


@app.get("/debug/routes")
async def debug_routes():
    """Debug endpoint to list all registered routes."""
    routes = []
    for route in app.routes:
        if hasattr(route, 'methods') and hasattr(route, 'path'):
            routes.append({
                "path": route.path,
                "methods": list(route.methods) if route.methods else [],
                "name": route.name
            })
    # Filter to show only vacancy routes
    vacancy_routes = [r for r in routes if '/vacancies' in r['path'] or '/api/vacancy' in r['path']]
    return {
        "total_routes": len(routes),
        "vacancy_routes": vacancy_routes,
        "vacancy_count": len(vacancy_routes)
    }


@app.get("/health/redis")
async def redis_health_check():
    """Check Redis cache status and statistics."""
    from api.services.redis_cache import redis_cache

    stats = await redis_cache.get_stats()
    return stats


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
