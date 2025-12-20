import os
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://localhost/hr_bot"

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Telegram
    telegram_bot_token: str = ""

    # AI Services
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # Superadmin
    superadmin_email: str = "admin@example.com"
    superadmin_password: str = "changeme"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
