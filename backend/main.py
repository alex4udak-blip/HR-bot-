import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.database import engine, Base, AsyncSessionLocal
from api.routes import auth, users, chats, messages, criteria, ai, stats
from api.bot import start_bot, stop_bot
from api.services.auth import create_superadmin_if_not_exists

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static files directory (built frontend)
STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting application...")

    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create superadmin if not exists
    async with AsyncSessionLocal() as db:
        await create_superadmin_if_not_exists(db)
        logger.info("Superadmin check completed")

    # Start Telegram bot in background
    bot_task = asyncio.create_task(start_bot())

    yield

    # Shutdown
    logger.info("Shutting down application...")
    bot_task.cancel()
    await stop_bot()


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
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    # Catch-all route for SPA - must be last
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Serve index.html for all non-API routes (SPA routing)
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
