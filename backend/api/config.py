import os
import logging
from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # Database URL - Railway provides this as DATABASE_URL
    database_url: str = Field(
        default="postgresql://localhost/hr_bot",
        alias="DATABASE_URL"
    )

    # JWT Settings - Railway uses SECRET_KEY
    jwt_secret: str = Field(
        default="change-me-in-production",
        alias="SECRET_KEY"
    )
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    # Telegram Bot Token
    telegram_bot_token: str = Field(
        default="",
        alias="TELEGRAM_BOT_TOKEN"
    )

    # AI API Keys
    anthropic_api_key: str = Field(
        default="",
        alias="ANTHROPIC_API_KEY"
    )
    openai_api_key: str = Field(
        default="",
        alias="OPENAI_API_KEY"
    )

    # Superadmin credentials - MUST be set in Railway Variables
    superadmin_email: str = Field(
        default="admin@example.com",
        alias="SUPERADMIN_EMAIL"
    )
    superadmin_password: str = Field(
        default="changeme",
        alias="SUPERADMIN_PASSWORD"
    )

    class Config:
        env_file = ".env"
        extra = "ignore"
        populate_by_name = True  # Allow both alias and field name


# Global settings instance (for bot.py compatibility)
settings = Settings()

# Log configuration on startup (hide sensitive data)
logger.info(f"Config loaded: DATABASE_URL={'***' if settings.database_url else 'NOT SET'}")
logger.info(f"Config loaded: TELEGRAM_BOT_TOKEN={'***' if settings.telegram_bot_token else 'NOT SET'}")
logger.info(f"Config loaded: SUPERADMIN_EMAIL={settings.superadmin_email}")


@lru_cache()
def get_settings() -> Settings:
    return settings
