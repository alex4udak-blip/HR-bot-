"""
Tests for Vacancy Recommender Service.

Tests cover:
- VacancyRecommendation dataclass
- CandidateMatch dataclass
- VacancyRecommenderService methods
- API endpoints for recommendations
"""

import pytest
import pytest_asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient

from api.models.database import (
    Entity, EntityType, EntityStatus,
    Vacancy, VacancyStatus, VacancyApplication, ApplicationStage,
    Organization, Department, User
)
from api.services.vacancy_recommender import (
    VacancyRecommendation,
    CandidateMatch,
    VacancyRecommenderService,
    vacancy_recommender
)


# ============================================================================
# DATACLASS TESTS
# ============================================================================

class TestVacancyRecommendation:
    """Tests for VacancyRecommendation dataclass."""

    def test_vacancy_recommendation_creation(self):
        """Test creating a VacancyRecommendation instance."""
        rec = VacancyRecommendation(
            vacancy_id=1,
            vacancy_title="Python Developer",
            match_score=85,
            match_reasons=["Skills match", "Salary compatible"],
            missing_requirements=["Docker experience"],
            salary_compatible=True
        )

        assert rec.vacancy_id == 1
        assert rec.vacancy_title == "Python Developer"
        assert rec.match_score == 85
        assert len(rec.match_reasons) == 2
        assert len(rec.missing_requirements) == 1
        assert rec.salary_compatible is True
        assert rec.location_match is True  # Default value

    def test_vacancy_recommendation_to_dict(self):
        """Test converting VacancyRecommendation to dictionary."""
        rec = VacancyRecommendation(
            vacancy_id=1,
            vacancy_title="Python Developer",
            match_score=85,
            salary_min=100000,
            salary_max=200000,
            salary_currency="RUB"
        )

        data = rec.to_dict()

        assert data["vacancy_id"] == 1
        assert data["vacancy_title"] == "Python Developer"
        assert data["match_score"] == 85
        assert data["salary_min"] == 100000
        assert data["salary_max"] == 200000
        assert data["salary_currency"] == "RUB"

    def test_vacancy_recommendation_defaults(self):
        """Test default values in VacancyRecommendation."""
        rec = VacancyRecommendation(
            vacancy_id=1,
            vacancy_title="Test",
            match_score=50
        )

        assert rec.match_reasons == []
        assert rec.missing_requirements == []
        assert rec.salary_compatible is True
        assert rec.location_match is True
        assert rec.salary_currency == "RUB"
        assert rec.applications_count == 0


class TestCandidateMatch:
    """Tests for CandidateMatch dataclass."""

    def test_candidate_match_creation(self):
        """Test creating a CandidateMatch instance."""
        match = CandidateMatch(
            entity_id=1,
            entity_name="John Doe",
            match_score=75,
            match_reasons=["Python skills"],
            missing_skills=["Docker"],
            salary_compatible=True
        )

        assert match.entity_id == 1
        assert match.entity_name == "John Doe"
        assert match.match_score == 75
        assert "Python skills" in match.match_reasons
        assert "Docker" in match.missing_skills

    def test_candidate_match_to_dict(self):
        """Test converting CandidateMatch to dictionary."""
        match = CandidateMatch(
            entity_id=1,
            entity_name="John Doe",
            match_score=75,
            email="john@example.com",
            phone="+1234567890",
            position="Senior Developer"
        )

        data = match.to_dict()

        assert data["entity_id"] == 1
        assert data["entity_name"] == "John Doe"
        assert data["email"] == "john@example.com"
        assert data["phone"] == "+1234567890"
        assert data["position"] == "Senior Developer"


# ============================================================================
# SERVICE TESTS
# ============================================================================

class TestVacancyRecommenderService:
    """Tests for VacancyRecommenderService."""

    @pytest.fixture
    def service(self):
        """Create a VacancyRecommenderService instance."""
        return VacancyRecommenderService()

    def test_extract_skills_from_text(self, service):
        """Test extracting skills from text."""
        text = "Looking for Python developer with Docker and Kubernetes experience"
        skills = service._extract_skills_from_text(text)

        assert "python" in skills
        assert "docker" in skills
        assert "kubernetes" in skills

    def test_extract_skills_from_empty_text(self, service):
        """Test extracting skills from empty/None text."""
        assert service._extract_skills_from_text(None) == []
        assert service._extract_skills_from_text("") == []

    def test_extract_skills_case_insensitive(self, service):
        """Test that skill extraction is case insensitive."""
        text = "PYTHON, JavaScript, React"
        skills = service._extract_skills_from_text(text)

        assert "python" in skills
        assert "javascript" in skills
        assert "react" in skills

    def test_calculate_match_score_full_match(self, service):
        """Test match score calculation with full skill match."""
        candidate_skills = ["python", "docker", "sql"]
        vacancy_skills = ["python", "docker", "sql"]

        score = service._calculate_match_score(
            candidate_skills,
            vacancy_skills,
            salary_compatible=True,
            location_match=True
        )

        # Full skills (60) + salary (25) + location (15) = 100
        assert score == 100

    def test_calculate_match_score_partial_match(self, service):
        """Test match score calculation with partial skill match."""
        candidate_skills = ["python", "sql"]
        vacancy_skills = ["python", "docker", "sql", "kubernetes"]

        score = service._calculate_match_score(
            candidate_skills,
            vacancy_skills,
            salary_compatible=True,
            location_match=True
        )

        # 2/4 skills (30) + salary (25) + location (15) = 70
        assert score == 70

    def test_calculate_match_score_no_skills(self, service):
        """Test match score calculation when vacancy has no skills."""
        candidate_skills = ["python"]
        vacancy_skills = []

        score = service._calculate_match_score(
            candidate_skills,
            vacancy_skills,
            salary_compatible=True,
            location_match=True
        )

        # Base score (30) + salary (25) + location (15) = 70
        assert score == 70

    def test_calculate_match_score_salary_incompatible(self, service):
        """Test match score with incompatible salary."""
        candidate_skills = ["python"]
        vacancy_skills = ["python"]

        score = service._calculate_match_score(
            candidate_skills,
            vacancy_skills,
            salary_compatible=False,
            location_match=True
        )

        # Skills (60) + location (15) = 75
        assert score == 75


# ============================================================================
# DATABASE INTEGRATION TESTS
# ============================================================================

@pytest_asyncio.fixture
async def test_vacancy(
    db_session: AsyncSession,
    organization: Organization,
    admin_user: User
) -> Vacancy:
    """Create a test vacancy."""
    vacancy = Vacancy(
        org_id=organization.id,
        title="Python Developer",
        description="Looking for experienced Python developer",
        requirements="Python, Docker, SQL, Kubernetes",
        status=VacancyStatus.open,
        salary_min=150000,
        salary_max=250000,
        salary_currency="RUB",
        created_by=admin_user.id
    )
    db_session.add(vacancy)
    await db_session.commit()
    await db_session.refresh(vacancy)
    return vacancy


@pytest_asyncio.fixture
async def candidate_with_skills(
    db_session: AsyncSession,
    organization: Organization,
    department: Department,
    admin_user: User
) -> Entity:
    """Create a candidate entity with skills."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Skilled Candidate",
        email="skilled@test.com",
        type=EntityType.candidate,
        status=EntityStatus.active,
        position="Python Backend Developer",
        tags=["python", "docker", "sql"],
        expected_salary_min=140000,
        expected_salary_max=220000,
        expected_salary_currency="RUB",
        extra_data={"skills": ["python", "docker", "sql", "fastapi"]}
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def candidate_without_skills(
    db_session: AsyncSession,
    organization: Organization,
    department: Department,
    admin_user: User
) -> Entity:
    """Create a candidate entity without matching skills."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Junior Candidate",
        email="junior@test.com",
        type=EntityType.candidate,
        status=EntityStatus.active,
        position="Junior Developer"
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


class TestVacancyRecommenderIntegration:
    """Integration tests for VacancyRecommenderService with database."""

    @pytest.mark.asyncio
    async def test_get_recommendations_for_candidate(
        self,
        db_session: AsyncSession,
        candidate_with_skills: Entity,
        test_vacancy: Vacancy,
        organization: Organization
    ):
        """Test getting recommendations for a candidate."""
        recommendations = await vacancy_recommender.get_recommendations(
            db=db_session,
            entity=candidate_with_skills,
            limit=5,
            org_id=organization.id
        )

        assert len(recommendations) > 0
        # First recommendation should be our test vacancy
        rec = recommendations[0]
        assert rec.vacancy_id == test_vacancy.id
        assert rec.match_score > 0
        assert rec.salary_compatible is True

    @pytest.mark.asyncio
    async def test_get_recommendations_non_candidate(
        self,
        db_session: AsyncSession,
        entity: Entity,  # This is a client entity from conftest
        organization: Organization
    ):
        """Test that non-candidates get empty recommendations."""
        # Entity from conftest is a candidate, so let's modify it
        entity.type = EntityType.client
        await db_session.commit()

        recommendations = await vacancy_recommender.get_recommendations(
            db=db_session,
            entity=entity,
            limit=5,
            org_id=organization.id
        )

        assert len(recommendations) == 0

    @pytest.mark.asyncio
    async def test_find_matching_candidates(
        self,
        db_session: AsyncSession,
        test_vacancy: Vacancy,
        candidate_with_skills: Entity,
        candidate_without_skills: Entity
    ):
        """Test finding matching candidates for a vacancy."""
        matches = await vacancy_recommender.find_matching_candidates(
            db=db_session,
            vacancy=test_vacancy,
            limit=10,
            exclude_applied=True
        )

        assert len(matches) >= 2
        # Skilled candidate should have higher score
        skilled_match = next((m for m in matches if m.entity_id == candidate_with_skills.id), None)
        unskilled_match = next((m for m in matches if m.entity_id == candidate_without_skills.id), None)

        assert skilled_match is not None
        assert unskilled_match is not None
        assert skilled_match.match_score > unskilled_match.match_score

    @pytest.mark.asyncio
    async def test_auto_apply(
        self,
        db_session: AsyncSession,
        candidate_with_skills: Entity,
        test_vacancy: Vacancy,
        admin_user: User
    ):
        """Test auto-applying a candidate to a vacancy."""
        application = await vacancy_recommender.auto_apply(
            db=db_session,
            entity=candidate_with_skills,
            vacancy=test_vacancy,
            source="test_auto_apply",
            created_by=admin_user.id
        )

        assert application is not None
        assert application.vacancy_id == test_vacancy.id
        assert application.entity_id == candidate_with_skills.id
        assert application.stage == ApplicationStage.applied
        assert application.source == "test_auto_apply"

    @pytest.mark.asyncio
    async def test_auto_apply_duplicate(
        self,
        db_session: AsyncSession,
        candidate_with_skills: Entity,
        test_vacancy: Vacancy,
        admin_user: User
    ):
        """Test that auto-apply doesn't create duplicate applications."""
        # First application
        first_app = await vacancy_recommender.auto_apply(
            db=db_session,
            entity=candidate_with_skills,
            vacancy=test_vacancy,
            created_by=admin_user.id
        )
        assert first_app is not None

        # Second application should return None
        second_app = await vacancy_recommender.auto_apply(
            db=db_session,
            entity=candidate_with_skills,
            vacancy=test_vacancy,
            created_by=admin_user.id
        )
        assert second_app is None

    @pytest.mark.asyncio
    async def test_notify_new_vacancy(
        self,
        db_session: AsyncSession,
        test_vacancy: Vacancy,
        candidate_with_skills: Entity,
        candidate_without_skills: Entity
    ):
        """Test finding candidates to notify about a new vacancy."""
        candidates = await vacancy_recommender.notify_new_vacancy(
            db=db_session,
            vacancy=test_vacancy,
            match_threshold=30,
            limit=20
        )

        assert len(candidates) >= 1
        # Should include at least the skilled candidate
        entity_ids = [c.entity_id for c in candidates]
        assert candidate_with_skills.id in entity_ids


# ============================================================================
# API ENDPOINT TESTS
# ============================================================================

class TestVacancyRecommendationEndpoints:
    """Tests for vacancy recommendation API endpoints."""

    @pytest.mark.asyncio
    async def test_get_recommended_vacancies_endpoint(
        self,
        client: AsyncClient,
        admin_token: str,
        candidate_with_skills: Entity,
        test_vacancy: Vacancy,
        org_owner  # Ensure admin is in org
    ):
        """Test GET /api/entities/{id}/recommended-vacancies endpoint."""
        response = await client.get(
            f"/api/entities/{candidate_with_skills.id}/recommended-vacancies",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"limit": 5}
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            rec = data[0]
            assert "vacancy_id" in rec
            assert "match_score" in rec
            assert "match_reasons" in rec

    @pytest.mark.asyncio
    async def test_get_recommended_vacancies_non_candidate(
        self,
        client: AsyncClient,
        admin_token: str,
        entity: Entity,  # Client entity
        db_session: AsyncSession,
        org_owner
    ):
        """Test that non-candidates get 400 error."""
        # Change entity type to client
        entity.type = EntityType.client
        await db_session.commit()

        response = await client.get(
            f"/api/entities/{entity.id}/recommended-vacancies",
            headers={"Authorization": f"Bearer {admin_token}"}
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_get_matching_candidates_endpoint(
        self,
        client: AsyncClient,
        admin_token: str,
        test_vacancy: Vacancy,
        candidate_with_skills: Entity,
        org_owner
    ):
        """Test GET /api/vacancies/{id}/matching-candidates endpoint."""
        response = await client.get(
            f"/api/vacancies/{test_vacancy.id}/matching-candidates",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"limit": 10, "min_score": 0}
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_auto_apply_endpoint(
        self,
        client: AsyncClient,
        admin_token: str,
        candidate_with_skills: Entity,
        test_vacancy: Vacancy,
        org_owner
    ):
        """Test POST /api/entities/{id}/auto-apply/{vacancy_id} endpoint."""
        response = await client.post(
            f"/api/entities/{candidate_with_skills.id}/auto-apply/{test_vacancy.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["vacancy_id"] == test_vacancy.id
        assert data["entity_id"] == candidate_with_skills.id
        assert "message" in data

    @pytest.mark.asyncio
    async def test_auto_apply_duplicate_returns_error(
        self,
        client: AsyncClient,
        admin_token: str,
        candidate_with_skills: Entity,
        test_vacancy: Vacancy,
        org_owner
    ):
        """Test that duplicate auto-apply returns 400."""
        # First apply
        response1 = await client.post(
            f"/api/entities/{candidate_with_skills.id}/auto-apply/{test_vacancy.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response1.status_code == 200

        # Second apply should fail
        response2 = await client.post(
            f"/api/entities/{candidate_with_skills.id}/auto-apply/{test_vacancy.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response2.status_code == 400

    @pytest.mark.asyncio
    async def test_notify_candidates_endpoint(
        self,
        client: AsyncClient,
        admin_token: str,
        test_vacancy: Vacancy,
        candidate_with_skills: Entity,
        org_owner
    ):
        """Test POST /api/vacancies/{id}/notify-candidates endpoint."""
        response = await client.post(
            f"/api/vacancies/{test_vacancy.id}/notify-candidates",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"min_score": 20, "limit": 10}
        )

        assert response.status_code == 200
        data = response.json()
        assert "vacancy_id" in data
        assert "candidates_found" in data
        assert "candidates_notified" in data
        assert "message" in data

    @pytest.mark.asyncio
    async def test_invite_candidate_endpoint(
        self,
        client: AsyncClient,
        admin_token: str,
        test_vacancy: Vacancy,
        candidate_with_skills: Entity,
        org_owner
    ):
        """Test POST /api/vacancies/{id}/invite-candidate/{entity_id} endpoint."""
        response = await client.post(
            f"/api/vacancies/{test_vacancy.id}/invite-candidate/{candidate_with_skills.id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"stage": "screening", "notes": "Great candidate"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["vacancy_id"] == test_vacancy.id
        assert data["entity_id"] == candidate_with_skills.id
        assert data["stage"] == "screening"


# ============================================================================
# EDGE CASE TESTS
# ============================================================================

class TestEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.fixture
    def service(self):
        return VacancyRecommenderService()

    def test_salary_compatibility_no_entity_salary(self, service):
        """Test salary check when entity has no salary expectations."""
        entity = MagicMock()
        entity.expected_salary_min = None
        entity.expected_salary_max = None

        vacancy = MagicMock()
        vacancy.salary_min = 100000
        vacancy.salary_max = 200000
        vacancy.salary_currency = "RUB"

        is_compatible, reason = service._check_salary_compatibility(entity, vacancy)
        assert is_compatible is True

    def test_salary_compatibility_no_vacancy_salary(self, service):
        """Test salary check when vacancy has no salary info."""
        entity = MagicMock()
        entity.expected_salary_min = 150000
        entity.expected_salary_max = 200000
        entity.expected_salary_currency = "RUB"

        vacancy = MagicMock()
        vacancy.salary_min = None
        vacancy.salary_max = None
        vacancy.salary_currency = "RUB"

        is_compatible, reason = service._check_salary_compatibility(entity, vacancy)
        assert is_compatible is True

    def test_salary_compatibility_currency_mismatch(self, service):
        """Test salary check with different currencies."""
        entity = MagicMock()
        entity.expected_salary_min = 3000
        entity.expected_salary_max = 5000
        entity.expected_salary_currency = "USD"

        vacancy = MagicMock()
        vacancy.salary_min = 150000
        vacancy.salary_max = 250000
        vacancy.salary_currency = "RUB"

        is_compatible, reason = service._check_salary_compatibility(entity, vacancy)
        assert is_compatible is False
        assert "Валюта" in reason

    def test_salary_compatibility_entity_too_high(self, service):
        """Test when entity expects more than vacancy offers."""
        entity = MagicMock()
        entity.expected_salary_min = 300000
        entity.expected_salary_max = 400000
        entity.expected_salary_currency = "RUB"

        vacancy = MagicMock()
        vacancy.salary_min = 100000
        vacancy.salary_max = 200000
        vacancy.salary_currency = "RUB"

        is_compatible, reason = service._check_salary_compatibility(entity, vacancy)
        assert is_compatible is False
        assert "Ожидания кандидата" in reason

    def test_extract_candidate_skills_from_extra_data(self, service):
        """Test extracting skills from extra_data."""
        entity = MagicMock()
        entity.position = "Developer"
        entity.tags = ["backend"]
        entity.extra_data = {
            "skills": ["python", "javascript", "docker"],
            "resume_text": "Experience with SQL and PostgreSQL"
        }

        skills = service._extract_candidate_skills(entity)

        assert "python" in skills
        assert "javascript" in skills
        assert "docker" in skills
        assert "sql" in skills
        assert "postgresql" in skills

    def test_extract_vacancy_requirements(self, service):
        """Test extracting requirements from vacancy."""
        vacancy = MagicMock()
        vacancy.title = "Senior Python Developer"
        vacancy.description = "We are looking for an experienced backend developer"
        vacancy.requirements = "Python, FastAPI, Docker, Kubernetes, SQL"
        vacancy.tags = ["remote", "fullstack"]

        skills = service._extract_vacancy_requirements(vacancy)

        assert "python" in skills
        assert "docker" in skills
        assert "kubernetes" in skills
        assert "sql" in skills
        assert "backend" in skills
        assert "fullstack" in skills
