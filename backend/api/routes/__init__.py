from fastapi import APIRouter
from .auth import router as auth_router
from .users import router as users_router
from .chats import router as chats_router
from .messages import router as messages_router
from .criteria import router as criteria_router
from .ai import router as ai_router
from .stats import router as stats_router
from .admin import router as admin_router

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(chats_router, prefix="/chats", tags=["chats"])
api_router.include_router(messages_router, prefix="/chats", tags=["messages"])
api_router.include_router(criteria_router, prefix="/criteria", tags=["criteria"])
api_router.include_router(ai_router, prefix="/chats", tags=["ai"])
api_router.include_router(stats_router, prefix="/stats", tags=["stats"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
