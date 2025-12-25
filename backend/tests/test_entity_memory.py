"""
Tests for Entity Long-term Memory Service.

Tests cover:
- should_update_summary logic
- build_memory_context formatting
- Memory context integration with entity AI
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, AsyncMock, patch

import sys
sys.path.insert(0, '/home/user/HR-bot-/backend')


class TestEntityMemoryService:
    """Tests for EntityMemoryService."""

    def test_should_update_summary_no_summary(self):
        """Should update if entity has no summary and enough content."""
        from api.services.entity_memory import entity_memory_service, MIN_NEW_CONTENT_LENGTH

        entity = MagicMock()
        entity.ai_summary = None

        # Not enough content
        assert entity_memory_service.should_update_summary(entity, 100) is False

        # Enough content
        assert entity_memory_service.should_update_summary(entity, MIN_NEW_CONTENT_LENGTH) is True

    def test_should_update_summary_old_summary(self):
        """Should update if summary is older than threshold."""
        from api.services.entity_memory import entity_memory_service, SUMMARY_UPDATE_INTERVAL

        entity = MagicMock()
        entity.ai_summary = "Existing summary"
        entity.ai_summary_updated_at = datetime.utcnow() - SUMMARY_UPDATE_INTERVAL - timedelta(hours=1)

        assert entity_memory_service.should_update_summary(entity, 0) is True

    def test_should_update_summary_recent_summary(self):
        """Should not update if summary is recent and not much new content."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = "Existing summary"
        entity.ai_summary_updated_at = datetime.utcnow() - timedelta(hours=1)

        # Not enough new content
        assert entity_memory_service.should_update_summary(entity, 100) is False

    def test_build_memory_context_empty(self):
        """Should return empty string for entity without memory."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = None
        entity.key_events = None

        result = entity_memory_service.build_memory_context(entity)
        assert result == ""

    def test_build_memory_context_with_summary(self):
        """Should include summary in context."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = "Кандидат с опытом разработки на Python"
        entity.key_events = None

        result = entity_memory_service.build_memory_context(entity)

        assert "📋 Резюме контакта" in result
        assert "Кандидат с опытом разработки на Python" in result

    def test_build_memory_context_with_events(self):
        """Should include key events in context."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = None
        entity.key_events = [
            {"date": "2024-01-15", "event": "hired", "details": "Нанят в отдел разработки"},
            {"date": "2024-03-20", "event": "promotion", "details": "Повышен до Senior"}
        ]

        result = entity_memory_service.build_memory_context(entity)

        assert "📅 Ключевые события" in result
        assert "2024-01-15" in result
        assert "Нанят в отдел разработки" in result
        assert "Повышен до Senior" in result

    def test_build_memory_context_with_both(self):
        """Should include both summary and events."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = "Опытный разработчик"
        entity.key_events = [
            {"date": "2024-01-15", "event": "hired", "details": "Нанят"}
        ]

        result = entity_memory_service.build_memory_context(entity)

        assert "📋 Резюме контакта" in result
        assert "📅 Ключевые события" in result

    def test_build_memory_context_limits_events(self):
        """Should only show last 10 events."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = None
        entity.key_events = [
            {"date": f"2024-{i:02d}-01", "event": "meeting", "details": f"Meeting {i}"}
            for i in range(1, 15)  # 14 events
        ]

        result = entity_memory_service.build_memory_context(entity)

        # Should contain last 10, not first 4
        assert "Meeting 14" in result
        assert "Meeting 5" in result
        # Should not contain first events
        assert "Meeting 1" not in result

    def test_event_emojis(self):
        """Should use correct emojis for event types."""
        from api.services.entity_memory import entity_memory_service

        entity = MagicMock()
        entity.ai_summary = None
        entity.key_events = [
            {"date": "2024-01-01", "event": "hired", "details": "Test"},
            {"date": "2024-01-02", "event": "promotion", "details": "Test"},
            {"date": "2024-01-03", "event": "warning", "details": "Test"},
            {"date": "2024-01-04", "event": "achievement", "details": "Test"},
        ]

        result = entity_memory_service.build_memory_context(entity)

        assert "✅" in result  # hired
        assert "⬆️" in result  # promotion
        assert "⚠️" in result  # warning
        assert "🏆" in result  # achievement


class TestEntityAIIntegration:
    """Tests for entity AI integration with memory."""

    def test_entity_context_includes_memory(self):
        """Verify entity AI context includes memory when available."""
        from api.services.entity_ai import EntityAIService

        service = EntityAIService()

        entity = MagicMock()
        entity.name = "Test User"
        entity.type.value = "candidate"
        entity.status.value = "active"
        entity.company = "Test Corp"
        entity.position = "Developer"
        entity.email = "test@test.com"
        entity.phone = "+123"
        entity.tags = ["python"]
        entity.ai_summary = "Experienced Python developer"
        entity.key_events = [
            {"date": "2024-01-15", "event": "hired", "details": "Hired as developer"}
        ]

        context = service._build_entity_context(entity, [], [])

        # Should include memory sections
        assert "📋 Резюме контакта" in context
        assert "Experienced Python developer" in context
        assert "📅 Ключевые события" in context
        assert "Hired as developer" in context

    def test_entity_context_without_memory(self):
        """Verify entity AI works without memory."""
        from api.services.entity_ai import EntityAIService

        service = EntityAIService()

        entity = MagicMock()
        entity.name = "Test User"
        entity.type.value = "candidate"
        entity.status.value = "active"
        entity.company = None
        entity.position = None
        entity.email = None
        entity.phone = None
        entity.tags = []
        entity.ai_summary = None
        entity.key_events = None

        context = service._build_entity_context(entity, [], [])

        # Should not include memory sections
        assert "📋 Резюме контакта" not in context
        assert "📅 Ключевые события" not in context
        # But should still have basic info
        assert "Test User" in context
