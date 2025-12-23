import os
from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):
    # Database URL - Railway provides this as DATABASE_URL
    database_url: str = Field(
        default="postgresql://localhost/hr_bot",
        alias="DATABASE_URL"
    )

    # JWT Settings - Railway uses SECRET_KEY
    jwt_secret: str = Field(
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

    # Redis (optional, for future use)
    redis_url: str = Field(
        default="redis://localhost:6379",
        alias="REDIS_URL"
    )

    # Fireflies.ai API for call recording & transcription
    fireflies_api_key: str = Field(
        default="",
        alias="FIREFLIES_API_KEY"
    )

    # Superadmin credentials - MUST be set in Railway Variables
    superadmin_email: str = Field(
        default="admin@example.com",
        alias="SUPERADMIN_EMAIL"
    )
    superadmin_password: str = Field(
        alias="SUPERADMIN_PASSWORD"
    )

    class Config:
        env_file = ".env"
        extra = "ignore"
        populate_by_name = True  # Allow both alias and field name

    def validate_required_secrets(self) -> None:
        """Validate that required secrets are set (no default fallback)"""
        if not self.jwt_secret or self.jwt_secret == "":
            raise ValueError("SECRET_KEY environment variable must be set")
        if not self.superadmin_password or self.superadmin_password == "":
            raise ValueError("SUPERADMIN_PASSWORD environment variable must be set")


# Global settings instance (for bot.py compatibility)
settings = Settings()
# Validate required secrets at startup
settings.validate_required_secrets()


@lru_cache()
def get_settings() -> Settings:
    return settings
