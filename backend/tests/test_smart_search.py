"""
Tests for Smart Search service and API endpoint.

Tests cover:
- Query parsing (rule-based and AI)
- Filter building
- Result ranking
- API endpoint behavior
"""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient

from api.models.database import (
    Entity, EntityType, EntityStatus, Organization, User, OrgMember, Department
)
from api.services.smart_search import SmartSearchService, ParsedSearchQuery, smart_search_service
from tests.conftest import auth_headers


class TestParsedSearchQuery:
    """Tests for ParsedSearchQuery dataclass."""

    def test_to_dict_empty(self):
        """Test to_dict with empty query."""
        parsed = ParsedSearchQuery()
        result = parsed.to_dict()
        # Should return empty dict (no None values, empty lists excluded)
        assert result == {}

    def test_to_dict_with_values(self):
        """Test to_dict with populated values."""
        parsed = ParsedSearchQuery(
            skills=["Python", "React"],
            experience_min_years=3,
            salary_max=200000,
            location="Moscow",
            original_query="Python developers"
        )
        result = parsed.to_dict()

        assert result["skills"] == ["Python", "React"]
        assert result["experience_min_years"] == 3
        assert result["salary_max"] == 200000
        assert result["location"] == "Moscow"
        assert result["original_query"] == "Python developers"
        # None values should not be included
        assert "experience_max_years" not in result
        assert "salary_min" not in result


class TestRuleBasedParsing:
    """Tests for rule-based query parsing."""

    def test_parse_experience_years(self):
        """Test parsing experience requirements."""
        service = SmartSearchService()

        # Test "от 3 лет опыта"
        parsed = service._rule_based_parse("Python с опытом от 3 лет")
        assert parsed.experience_min_years == 3

        # Test "3+ years"
        parsed = service._rule_based_parse("Developer 5+ years experience")
        assert parsed.experience_min_years == 5

        # Test "до 5 лет"
        parsed = service._rule_based_parse("Junior до 2 лет опыта")
        assert parsed.experience_max_years == 2

    def test_parse_salary(self):
        """Test parsing salary requirements."""
        service = SmartSearchService()

        # Test "зарплата до 200000"
        parsed = service._rule_based_parse("Frontend зарплата до 200000")
        assert parsed.salary_max == 200000

        # Test "от 100000 руб"
        parsed = service._rule_based_parse("Backend от 100000 рублей")
        assert parsed.salary_min == 100000

        # Test with USD
        parsed = service._rule_based_parse("Senior до 5000 $")
        assert parsed.salary_max == 5000
        assert parsed.salary_currency == "USD"

    def test_parse_experience_level(self):
        """Test parsing experience level."""
        service = SmartSearchService()

        # Test junior
        parsed = service._rule_based_parse("Junior Python developer")
        assert parsed.experience_level == "junior"

        # Test senior
        parsed = service._rule_based_parse("Senior Java разработчик")
        assert parsed.experience_level == "senior"

        # Test middle
        parsed = service._rule_based_parse("Middle backend developer")
        assert parsed.experience_level == "middle"

        # Test lead
        parsed = service._rule_based_parse("Team Lead Python")
        assert parsed.experience_level == "lead"

    def test_parse_skills(self):
        """Test parsing skills/technologies."""
        service = SmartSearchService()

        # Single skill
        parsed = service._rule_based_parse("Python разработчик")
        assert "Python" in parsed.skills

        # Multiple skills
        parsed = service._rule_based_parse("React TypeScript Node.js developer")
        assert "React" in parsed.skills
        assert "Typescript" in parsed.skills
        assert "Nodejs" in parsed.skills

        # Case insensitive
        parsed = service._rule_based_parse("GOLANG developer")
        assert "Golang" in parsed.skills

    def test_parse_location(self):
        """Test parsing location."""
        service = SmartSearchService()

        # Moscow
        parsed = service._rule_based_parse("Python разработчик Москва")
        assert parsed.location == "Москва"

        # Saint Petersburg (SPB)
        parsed = service._rule_based_parse("Java developer СПб")
        assert parsed.location == "Санкт-Петербург"

        # Remote
        parsed = service._rule_based_parse("Python удалённо")
        assert parsed.remote_ok is True

    def test_parse_status(self):
        """Test parsing entity status."""
        service = SmartSearchService()

        # New
        parsed = service._rule_based_parse("новые кандидаты Python")
        assert parsed.status == "new"

        # Interview
        parsed = service._rule_based_parse("кандидаты на собеседовании")
        assert parsed.status == "interview"

    def test_parse_complex_query(self):
        """Test parsing complex multi-criteria query."""
        service = SmartSearchService()

        query = "Senior Python разработчик Москва зарплата до 300000 рублей опыт от 5 лет"
        parsed = service._rule_based_parse(query)

        assert parsed.experience_level == "senior"
        assert "Python" in parsed.skills
        assert parsed.location == "Москва"
        assert parsed.salary_max == 300000
        assert parsed.salary_currency == "RUB"
        assert parsed.experience_min_years == 5


class TestFilterBuilding:
    """Tests for SQLAlchemy filter building."""

    def test_build_filters_skills(self):
        """Test filter building for skills."""
        service = SmartSearchService()
        parsed = ParsedSearchQuery(skills=["Python", "React"])

        conditions = service.build_search_filters(parsed, org_id=1)

        # Should have org_id filter and skills filter
        assert len(conditions) >= 2

    def test_build_filters_salary(self):
        """Test filter building for salary."""
        service = SmartSearchService()

        # Min salary
        parsed = ParsedSearchQuery(salary_min=100000)
        conditions = service.build_search_filters(parsed)
        assert len(conditions) >= 1

        # Max salary
        parsed = ParsedSearchQuery(salary_max=200000)
        conditions = service.build_search_filters(parsed)
        assert len(conditions) >= 1

        # Both
        parsed = ParsedSearchQuery(salary_min=100000, salary_max=200000)
        conditions = service.build_search_filters(parsed)
        assert len(conditions) >= 2

    def test_build_filters_empty(self):
        """Test filter building with empty query."""
        service = SmartSearchService()
        parsed = ParsedSearchQuery()

        conditions = service.build_search_filters(parsed, org_id=1)

        # Should only have org_id filter
        assert len(conditions) == 1


class TestResultRanking:
    """Tests for result ranking."""

    def test_rank_results_skill_match(self):
        """Test ranking with skill matches."""
        service = SmartSearchService()

        # Create mock entities
        entity1 = MagicMock(spec=Entity)
        entity1.id = 1
        entity1.extra_data = {"skills": ["Python", "Django"]}
        entity1.tags = []
        entity1.ai_summary = None
        entity1.position = "Python Developer"
        entity1.name = "John"
        entity1.expected_salary_min = None
        entity1.expected_salary_max = None
        entity1.email = "john@test.com"
        entity1.phone = "+1234567890"
        entity1.updated_at = datetime.utcnow()

        entity2 = MagicMock(spec=Entity)
        entity2.id = 2
        entity2.extra_data = {"skills": ["Java"]}
        entity2.tags = []
        entity2.ai_summary = None
        entity2.position = "Java Developer"
        entity2.name = "Jane"
        entity2.expected_salary_min = None
        entity2.expected_salary_max = None
        entity2.email = "jane@test.com"
        entity2.phone = None
        entity2.updated_at = datetime.utcnow() - timedelta(days=60)

        parsed = ParsedSearchQuery(skills=["Python"])
        ranked = service.rank_results([entity1, entity2], parsed)

        # Entity1 should have higher score due to Python skill match
        assert ranked[0][0].id == 1
        assert ranked[0][1] > ranked[1][1]

    def test_rank_results_recent_activity_bonus(self):
        """Test ranking bonus for recent activity."""
        service = SmartSearchService()

        # Entity updated recently
        entity1 = MagicMock(spec=Entity)
        entity1.id = 1
        entity1.extra_data = {}
        entity1.tags = []
        entity1.ai_summary = "Good candidate"
        entity1.position = None
        entity1.name = "Recent"
        entity1.expected_salary_min = None
        entity1.expected_salary_max = None
        entity1.email = "recent@test.com"
        entity1.phone = "+1234567890"
        entity1.updated_at = datetime.utcnow()

        # Entity updated long ago
        entity2 = MagicMock(spec=Entity)
        entity2.id = 2
        entity2.extra_data = {}
        entity2.tags = []
        entity2.ai_summary = None
        entity2.position = None
        entity2.name = "Old"
        entity2.expected_salary_min = None
        entity2.expected_salary_max = None
        entity2.email = None
        entity2.phone = None
        entity2.updated_at = datetime.utcnow() - timedelta(days=120)

        parsed = ParsedSearchQuery()
        ranked = service.rank_results([entity1, entity2], parsed)

        # Entity1 should have higher score due to recent update and complete profile
        assert ranked[0][0].id == 1


class TestSmartSearchEndpoint:
    """Tests for /api/entities/search endpoint."""

    @pytest_asyncio.fixture
    async def search_entities(
        self,
        db_session: AsyncSession,
        organization: Organization,
        department: Department,
        admin_user: User
    ):
        """Create test entities for search."""
        entities = []

        # Python developer
        e1 = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Ivan Python",
            email="ivan@test.com",
            position="Senior Python Developer",
            type=EntityType.candidate,
            status=EntityStatus.interview,
            extra_data={"skills": ["Python", "Django", "FastAPI"]},
            tags=["backend", "senior"],
            expected_salary_min=200000,
            expected_salary_max=300000,
            expected_salary_currency="RUB",
            ai_summary="Experienced Python developer with 5+ years"
        )
        db_session.add(e1)

        # React developer
        e2 = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Anna React",
            email="anna@test.com",
            position="Frontend Developer",
            type=EntityType.candidate,
            status=EntityStatus.screening,
            extra_data={"skills": ["React", "TypeScript", "CSS"]},
            tags=["frontend", "middle"],
            expected_salary_min=150000,
            expected_salary_max=200000,
            expected_salary_currency="RUB"
        )
        db_session.add(e2)

        # Java developer
        e3 = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Petr Java",
            email="petr@test.com",
            position="Java Backend Developer",
            type=EntityType.candidate,
            status=EntityStatus.new,
            extra_data={"skills": ["Java", "Spring", "Kubernetes"]},
            tags=["backend", "devops"]
        )
        db_session.add(e3)

        await db_session.commit()
        for e in [e1, e2, e3]:
            await db_session.refresh(e)
            entities.append(e)

        return entities

    @pytest.mark.asyncio
    async def test_search_by_skill(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner,
        search_entities
    ):
        """Test searching by skill name."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "Python developer"},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        assert "results" in data
        assert "total" in data
        assert "parsed_query" in data

        # Should find the Python developer
        results = data["results"]
        assert len(results) >= 1
        python_dev = next((r for r in results if "Python" in r["name"]), None)
        assert python_dev is not None

    @pytest.mark.asyncio
    async def test_search_with_salary_filter(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner,
        search_entities
    ):
        """Test searching with salary filter."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "developer зарплата до 180000"},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        # Check parsed query
        parsed = data["parsed_query"]
        assert parsed.get("salary_max") == 180000

    @pytest.mark.asyncio
    async def test_search_empty_query(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner
    ):
        """Test search with empty query returns error."""
        response = await client.get(
            "/api/entities/search",
            params={"query": ""},
            headers=auth_headers(admin_token)
        )

        # Should return 422 for validation error
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_search_no_results(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner
    ):
        """Test search with no matching results."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "Cobol programmer from 1960"},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        assert data["results"] == []
        assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_search_pagination(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner,
        search_entities
    ):
        """Test search pagination."""
        # Request with limit
        response = await client.get(
            "/api/entities/search",
            params={"query": "developer", "limit": 2, "offset": 0},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        assert data["limit"] == 2
        assert data["offset"] == 0
        assert len(data["results"]) <= 2

    @pytest.mark.asyncio
    async def test_search_with_type_filter(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner,
        search_entities
    ):
        """Test search with entity type filter."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "developer", "type": "candidate"},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        # All results should be candidates
        for result in data["results"]:
            assert result["type"] == "candidate"

    @pytest.mark.asyncio
    async def test_search_relevance_score(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner,
        search_entities
    ):
        """Test that results include relevance scores."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "Python backend senior"},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        for result in data["results"]:
            assert "relevance_score" in result
            assert isinstance(result["relevance_score"], (int, float))

    @pytest.mark.asyncio
    async def test_search_unauthorized(self, client: AsyncClient):
        """Test search without authentication."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "Python developer"}
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_search_returns_parsed_query(
        self,
        client: AsyncClient,
        admin_user: User,
        admin_token: str,
        org_owner,
        search_entities
    ):
        """Test that search returns parsed query info."""
        response = await client.get(
            "/api/entities/search",
            params={"query": "Senior Python Москва зарплата до 250000"},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        parsed = data["parsed_query"]
        # Should have parsed skills
        assert "Python" in parsed.get("skills", [])
        # Should have parsed experience level
        assert parsed.get("experience_level") == "senior"
        # Should have parsed location
        assert parsed.get("location") == "Москва"
        # Should have parsed salary
        assert parsed.get("salary_max") == 250000


class TestAIParsing:
    """Tests for AI query parsing (with mocked AI)."""

    @pytest.mark.asyncio
    async def test_ai_parse_query(self, mock_anthropic_client):
        """Test AI parsing with mocked response."""
        service = SmartSearchService()

        # Configure mock to return JSON
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text='{"skills": ["Python", "Django"], "experience_min_years": 3}')]
        mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

        parsed = await service._ai_parse_query("Python разработчик с опытом от 3 лет")

        assert "Python" in parsed.skills
        assert parsed.experience_min_years == 3

    @pytest.mark.asyncio
    async def test_ai_parse_fallback_on_error(self, mock_anthropic_client):
        """Test that parsing falls back gracefully on AI error."""
        service = SmartSearchService()

        # Configure mock to raise error
        mock_anthropic_client.messages.create = AsyncMock(side_effect=Exception("API Error"))

        # Should not raise, should return empty ParsedSearchQuery
        parsed = await service._ai_parse_query("test query")

        assert parsed.skills == []
        assert parsed.experience_min_years is None

    def test_needs_ai_parsing(self):
        """Test detection of queries needing AI parsing."""
        service = SmartSearchService()

        # Short simple query - rule-based sufficient
        parsed_simple = ParsedSearchQuery(skills=["Python"], experience_min_years=3)
        assert service._needs_ai_parsing("Python 3 года", parsed_simple) is False

        # Long complex query - needs AI
        assert service._needs_ai_parsing(
            "Ищу кандидата который умеет работать с Python и имеет опыт в машинном обучении",
            ParsedSearchQuery()
        ) is True

        # Query with complex patterns
        assert service._needs_ai_parsing(
            "developers who can work with React",
            ParsedSearchQuery()
        ) is True

    def test_merge_parsed_queries(self):
        """Test merging rule-based and AI parsed results."""
        service = SmartSearchService()

        rule_based = ParsedSearchQuery(
            skills=["Python"],
            experience_min_years=3,
            location="Moscow",
            original_query="test"
        )

        ai_parsed = ParsedSearchQuery(
            skills=["Django", "FastAPI"],
            experience_level="senior",
            salary_max=200000
        )

        merged = service._merge_parsed_queries(rule_based, ai_parsed)

        # Should combine skills
        assert "Python" in merged.skills
        assert "Django" in merged.skills
        assert "FastAPI" in merged.skills

        # Should prefer AI values
        assert merged.experience_level == "senior"
        assert merged.salary_max == 200000

        # Should keep rule-based values when AI doesn't have them
        assert merged.experience_min_years == 3
        assert merged.location == "Moscow"


class TestSmartSearchService:
    """Integration tests for SmartSearchService.search method."""

    @pytest_asyncio.fixture
    async def searchable_entities(
        self,
        db_session: AsyncSession,
        organization: Organization,
        department: Department,
        admin_user: User
    ):
        """Create entities for service integration tests."""
        entities = []

        # Fullstack developer
        e1 = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Alex Fullstack",
            email="alex@test.com",
            position="Fullstack Developer",
            type=EntityType.candidate,
            status=EntityStatus.active,
            extra_data={"skills": ["Python", "React", "PostgreSQL"]},
            ai_summary="Versatile developer with backend and frontend experience"
        )
        db_session.add(e1)

        # DevOps engineer
        e2 = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Boris DevOps",
            email="boris@test.com",
            position="DevOps Engineer",
            type=EntityType.candidate,
            status=EntityStatus.screening,
            extra_data={"skills": ["Docker", "Kubernetes", "AWS", "Terraform"]},
            expected_salary_min=250000,
            expected_salary_max=350000,
            expected_salary_currency="RUB"
        )
        db_session.add(e2)

        await db_session.commit()
        for e in [e1, e2]:
            await db_session.refresh(e)
            entities.append(e)

        return entities

    @pytest.mark.asyncio
    async def test_search_service_basic(
        self,
        db_session: AsyncSession,
        organization: Organization,
        admin_user: User,
        searchable_entities
    ):
        """Test basic search through service."""
        result = await smart_search_service.search(
            db=db_session,
            query="Python developer",
            org_id=organization.id,
            user_id=admin_user.id,
            limit=10
        )

        assert "results" in result
        assert "total" in result
        assert "parsed_query" in result
        assert isinstance(result["results"], list)

    @pytest.mark.asyncio
    async def test_search_service_with_scores(
        self,
        db_session: AsyncSession,
        organization: Organization,
        admin_user: User,
        searchable_entities
    ):
        """Test that search returns relevance scores."""
        result = await smart_search_service.search(
            db=db_session,
            query="DevOps AWS Kubernetes",
            org_id=organization.id,
            user_id=admin_user.id
        )

        assert "scores" in result
        if result["results"]:
            # DevOps entity should be found
            devops_entity = next(
                (e for e in result["results"] if "DevOps" in e.name),
                None
            )
            if devops_entity:
                assert devops_entity.id in result["scores"]
                assert result["scores"][devops_entity.id] > 0

    @pytest.mark.asyncio
    async def test_search_service_org_isolation(
        self,
        db_session: AsyncSession,
        organization: Organization,
        second_organization: Organization,
        admin_user: User,
        searchable_entities
    ):
        """Test that search respects org boundaries."""
        # Search in second org should find nothing
        result = await smart_search_service.search(
            db=db_session,
            query="Python developer",
            org_id=second_organization.id,
            user_id=admin_user.id
        )

        assert result["total"] == 0
        assert result["results"] == []
