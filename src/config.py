import os
from dataclasses import dataclass


@dataclass
class Config:
    telegram_token: str
    anthropic_api_key: str
    openai_api_key: str
    admin_ids: list[int]
    database_url: str

    @classmethod
    def from_env(cls) -> "Config":
        telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")
        if not telegram_token:
            raise ValueError("TELEGRAM_BOT_TOKEN is required")

        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        if not anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")

        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY is required")

        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise ValueError("DATABASE_URL is required")

        admin_ids_str = os.getenv("ADMIN_IDS", "")
        admin_ids = []
        if admin_ids_str:
            admin_ids = [int(id.strip()) for id in admin_ids_str.split(",") if id.strip()]

        return cls(
            telegram_token=telegram_token,
            anthropic_api_key=anthropic_api_key,
            openai_api_key=openai_api_key,
            admin_ids=admin_ids,
            database_url=database_url,
        )

    def is_admin(self, user_id: int) -> bool:
        """Check if user is an admin. If no admins configured, allow everyone."""
        if not self.admin_ids:
            return True
        return user_id in self.admin_ids
