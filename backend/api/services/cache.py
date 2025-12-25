"""
Cache Service for AI analysis results.

Provides:
- Hash-based caching to avoid re-analyzing unchanged data
- Automatic cache invalidation on new messages
- Memory-efficient context management
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

logger = logging.getLogger("hr-analyzer.cache")


class AnalysisCacheService:
    """Service for caching AI analysis results with hash-based invalidation."""

    # In-memory cache for quick lookups (will be replaced with Redis later)
    _cache: Dict[str, Dict[str, Any]] = {}

    # Default TTL for cached results (1 hour)
    DEFAULT_TTL_SECONDS = 3600

    @staticmethod
    def compute_messages_hash(messages: list, criteria: list = None) -> str:
        """
        Compute hash of messages + criteria for cache key.

        Hash changes when:
        - Any message content changes
        - Messages are added/removed
        - Criteria change
        """
        # Extract essential data for hashing
        messages_data = []
        for msg in messages:
            if hasattr(msg, 'id'):
                # SQLAlchemy Message object
                messages_data.append({
                    'id': msg.id,
                    'content': msg.content[:200] if msg.content else '',  # First 200 chars
                    'timestamp': msg.timestamp.isoformat() if msg.timestamp else ''
                })
            elif isinstance(msg, dict):
                # Dict message
                messages_data.append({
                    'content': str(msg.get('content', ''))[:200],
                    'role': msg.get('role', '')
                })

        # Include criteria in hash
        criteria_data = json.dumps(criteria or [], sort_keys=True)

        # Combine and hash
        combined = json.dumps({
            'messages': messages_data,
            'criteria': criteria_data,
            'count': len(messages_data)
        }, sort_keys=True, default=str)

        return hashlib.md5(combined.encode()).hexdigest()

    @staticmethod
    def compute_entity_hash(
        entity,
        chats: list,
        calls: list
    ) -> str:
        """
        Compute hash for entity context (all chats + calls).

        Hash changes when:
        - Entity info changes
        - Any chat messages change
        - Any call transcripts change
        """
        entity_data = {
            'id': entity.id,
            'name': entity.name,
            'status': entity.status.value if entity.status else '',
            'type': entity.type.value if entity.type else ''
        }

        # Hash all chats
        chats_data = []
        for chat in chats:
            msg_count = len(chat.messages) if hasattr(chat, 'messages') and chat.messages else 0
            last_msg_ts = ''
            if msg_count > 0:
                last_msg = max(chat.messages, key=lambda m: m.timestamp if m.timestamp else datetime.min)
                last_msg_ts = last_msg.timestamp.isoformat() if last_msg.timestamp else ''

            chats_data.append({
                'id': chat.id,
                'msg_count': msg_count,
                'last_msg': last_msg_ts
            })

        # Hash all calls
        calls_data = []
        for call in calls:
            calls_data.append({
                'id': call.id,
                'status': call.status.value if call.status else '',
                'transcript_len': len(call.transcript) if call.transcript else 0
            })

        combined = json.dumps({
            'entity': entity_data,
            'chats': chats_data,
            'calls': calls_data
        }, sort_keys=True, default=str)

        return hashlib.md5(combined.encode()).hexdigest()

    @classmethod
    def get_cached_analysis(
        cls,
        cache_key: str,
        content_hash: str
    ) -> Optional[str]:
        """
        Get cached analysis if hash matches.

        Returns None if:
        - No cache exists
        - Hash doesn't match (content changed)
        - Cache expired
        """
        cache_entry = cls._cache.get(cache_key)

        if not cache_entry:
            logger.debug(f"Cache miss: {cache_key} (no entry)")
            return None

        # Check hash match
        if cache_entry.get('hash') != content_hash:
            logger.info(f"Cache invalidated: {cache_key} (hash mismatch)")
            del cls._cache[cache_key]
            return None

        # Check expiry
        expires_at = cache_entry.get('expires_at')
        if expires_at and datetime.utcnow() > expires_at:
            logger.info(f"Cache expired: {cache_key}")
            del cls._cache[cache_key]
            return None

        logger.info(f"Cache hit: {cache_key}")
        return cache_entry.get('result')

    @classmethod
    def set_cached_analysis(
        cls,
        cache_key: str,
        content_hash: str,
        result: str,
        ttl_seconds: int = None
    ):
        """Store analysis result in cache with hash for validation."""
        ttl = ttl_seconds or cls.DEFAULT_TTL_SECONDS

        cls._cache[cache_key] = {
            'hash': content_hash,
            'result': result,
            'created_at': datetime.utcnow(),
            'expires_at': datetime.utcnow() + timedelta(seconds=ttl)
        }

        logger.info(f"Cached: {cache_key} (TTL: {ttl}s)")

    @classmethod
    def invalidate_chat_cache(cls, chat_id: int):
        """Invalidate all cache entries for a chat."""
        keys_to_delete = [k for k in cls._cache.keys() if f"chat:{chat_id}" in k]
        for key in keys_to_delete:
            del cls._cache[key]
            logger.info(f"Invalidated: {key}")

    @classmethod
    def invalidate_entity_cache(cls, entity_id: int):
        """Invalidate all cache entries for an entity."""
        keys_to_delete = [k for k in cls._cache.keys() if f"entity:{entity_id}" in k]
        for key in keys_to_delete:
            del cls._cache[key]
            logger.info(f"Invalidated: {key}")

    @classmethod
    def clear_all(cls):
        """Clear entire cache."""
        count = len(cls._cache)
        cls._cache.clear()
        logger.info(f"Cleared {count} cache entries")


def smart_truncate(content: str, max_length: int = 500) -> str:
    """
    Smart truncate that preserves beginning and end of content.

    Unlike simple truncation, this keeps:
    - First 60% of max_length (important context)
    - Last 30% of max_length (recent info)
    - Marker showing how much was skipped
    """
    if not content or len(content) <= max_length:
        return content or ""

    # Calculate split points
    start_len = int(max_length * 0.6)
    end_len = int(max_length * 0.3)

    start = content[:start_len].strip()
    end = content[-end_len:].strip()

    skipped = len(content) - start_len - end_len

    return f"{start}\n... [пропущено {skipped} символов] ...\n{end}"


def format_messages_optimized(messages: list, max_per_message: int = 500) -> str:
    """
    Format messages with optimized token usage.

    Optimizations:
    - Smart truncate long messages
    - Skip media without text content
    - Compact timestamp format
    """
    lines = []

    for msg in messages:
        # Skip media-only messages (they don't add value to text analysis)
        if msg.content_type in ('photo', 'video', 'sticker') and not msg.content:
            continue

        # Build name
        name = f"{msg.first_name or ''} {msg.last_name or ''}".strip() or msg.username or "?"

        # Compact timestamp (just time if today, date+time otherwise)
        ts = msg.timestamp.strftime("%d.%m %H:%M") if msg.timestamp else ""

        # Content with type prefix
        content = msg.content or ""

        if msg.content_type == "voice":
            prefix = "[🎤] "
        elif msg.content_type == "video_note":
            prefix = "[📹] "
        elif msg.content_type == "document":
            prefix = f"[📄 {msg.file_name or 'файл'}] "
        else:
            prefix = ""

        # Smart truncate content
        content = smart_truncate(content, max_per_message)

        lines.append(f"[{ts}] {name}: {prefix}{content}")

    return "\n".join(lines)


# Singleton instance
cache_service = AnalysisCacheService()
