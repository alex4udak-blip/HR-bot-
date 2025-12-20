from fastapi import APIRouter
from .auth import router as auth_router
from .users import router as users_router
from .chats import router as chats_router
from .stats import router as stats_router

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(chats_router, prefix="/chats", tags=["chats"])
api_router.include_router(stats_router, prefix="/stats", tags=["stats"])
