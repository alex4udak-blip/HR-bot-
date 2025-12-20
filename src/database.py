import asyncpg
from datetime import datetime
from dataclasses import dataclass
from typing import Optional


@dataclass
class Chat:
    id: int
    chat_id: int
    title: str
    criteria: Optional[str]
    created_at: datetime


@dataclass
class Message:
    id: int
    chat_id: int
    user_id: int
    username: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    message_type: str  # text, voice, video_note, document
    content: str  # text content or transcription
    file_id: Optional[str]
    created_at: datetime


class Database:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(self.database_url)
        await self._create_tables()

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def _create_tables(self) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS chats (
                    id SERIAL PRIMARY KEY,
                    chat_id BIGINT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    criteria TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            await conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    chat_id BIGINT NOT NULL,
                    user_id BIGINT NOT NULL,
                    username TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    message_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    file_id TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Create indexes if they don't exist
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)
            """)
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)
            """)

    async def add_or_update_chat(self, chat_id: int, title: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO chats (chat_id, title) VALUES ($1, $2)
                ON CONFLICT(chat_id) DO UPDATE SET title = EXCLUDED.title
                """,
                chat_id, title,
            )

    async def get_chat(self, chat_id: int) -> Optional[Chat]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM chats WHERE chat_id = $1", chat_id
            )
            if row:
                return Chat(
                    id=row["id"],
                    chat_id=row["chat_id"],
                    title=row["title"],
                    criteria=row["criteria"],
                    created_at=row["created_at"],
                )
            return None

    async def get_all_chats(self) -> list[Chat]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM chats ORDER BY title")
            return [
                Chat(
                    id=row["id"],
                    chat_id=row["chat_id"],
                    title=row["title"],
                    criteria=row["criteria"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    async def set_criteria(self, chat_id: int, criteria: str) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE chats SET criteria = $1 WHERE chat_id = $2",
                criteria, chat_id,
            )
            return result != "UPDATE 0"

    async def add_message(
        self,
        chat_id: int,
        user_id: int,
        username: Optional[str],
        first_name: Optional[str],
        last_name: Optional[str],
        message_type: str,
        content: str,
        file_id: Optional[str] = None,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO messages (chat_id, user_id, username, first_name, last_name, message_type, content, file_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                chat_id, user_id, username, first_name, last_name, message_type, content, file_id,
            )

    async def get_messages_by_chat(self, chat_id: int) -> list[Message]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at",
                chat_id,
            )
            return [
                Message(
                    id=row["id"],
                    chat_id=row["chat_id"],
                    user_id=row["user_id"],
                    username=row["username"],
                    first_name=row["first_name"],
                    last_name=row["last_name"],
                    message_type=row["message_type"],
                    content=row["content"],
                    file_id=row["file_id"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    async def get_chat_statistics(self, chat_id: int) -> dict:
        """Get statistics for a chat."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT user_id) as unique_users
                FROM messages
                WHERE chat_id = $1
                """,
                chat_id,
            )

            type_rows = await conn.fetch(
                """
                SELECT message_type, COUNT(*) as count
                FROM messages
                WHERE chat_id = $1
                GROUP BY message_type
                """,
                chat_id,
            )

            return {
                "total_messages": row["total_messages"],
                "unique_users": row["unique_users"],
                "by_type": {r["message_type"]: r["count"] for r in type_rows},
            }

    async def get_users_in_chat(self, chat_id: int) -> list[dict]:
        """Get list of users who posted in a chat."""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    user_id,
                    username,
                    first_name,
                    last_name,
                    COUNT(*) as message_count
                FROM messages
                WHERE chat_id = $1
                GROUP BY user_id, username, first_name, last_name
                ORDER BY message_count DESC
                """,
                chat_id,
            )
            return [
                {
                    "user_id": row["user_id"],
                    "username": row["username"],
                    "first_name": row["first_name"],
                    "last_name": row["last_name"],
                    "message_count": row["message_count"],
                }
                for row in rows
            ]
