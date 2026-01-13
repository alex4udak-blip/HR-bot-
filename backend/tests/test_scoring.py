"""
Tests for AI Scoring Service - Candidate-Vacancy Compatibility Scoring.

Tests cover:
- Scoring service core functionality
- API endpoints for scoring
- Score caching in applications
- Bulk scoring operations
"""
import pytest
import pytest_asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
import json

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import (
    Entity, Vacancy, VacancyApplication,
    EntityType, EntityStatus, VacancyStatus, ApplicationStage
)
from api.services.ai_scoring import (
    AIScoringService, CompatibilityScore, Recommendation, ai_scoring_service
)
from tests.conftest import auth_headers


# ============================================================================
# FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def vacancy(db_session: AsyncSession, organization, department) -> Vacancy:
    """Create a test vacancy."""
    vacancy = Vacancy(
        org_id=organization.id,
        department_id=department.id,
        title="Senior Python Developer",
        description="We are looking for an experienced Python developer to join our team.",
        requirements="5+ years of Python experience, FastAPI, SQLAlchemy, PostgreSQL",
        responsibilities="Design and develop backend services, code reviews, mentoring",
        salary_min=200000,
        salary_max=350000,
        salary_currency="RUB",
        location="Moscow",
        employment_type="full-time",
        experience_level="senior",
        status=VacancyStatus.open,
        tags=["python", "backend", "fastapi"],
        created_at=datetime.utcnow()
    )
    db_session.add(vacancy)
    await db_session.commit()
    await db_session.refresh(vacancy)
    return vacancy


@pytest_asyncio.fixture
async def candidate_for_scoring(db_session: AsyncSession, organization, department, admin_user) -> Entity:
    """Create a candidate entity with skills and experience data."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Ivan Petrov",
        email="ivan.petrov@example.com",
        phone="+7 999 123 4567",
        type=EntityType.candidate,
        status=EntityStatus.interview,
        position="Python Developer",
        company="Tech Corp",
        tags=["python", "django", "postgresql"],
        extra_data={
            "skills": ["Python", "FastAPI", "Django", "PostgreSQL", "Redis"],
            "experience_years": 6,
            "education": "Computer Science, MSc",
            "languages": ["Russian", "English"],
            "about": "Experienced backend developer focused on high-load systems"
        },
        expected_salary_min=250000,
        expected_salary_max=300000,
        expected_salary_currency="RUB",
        ai_summary="Experienced Python developer with 6 years in backend development. Strong skills in FastAPI and database optimization.",
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def second_candidate(db_session: AsyncSession, organization, department, admin_user) -> Entity:
    """Create a second candidate for bulk scoring tests."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Maria Ivanova",
        email="maria.ivanova@example.com",
        type=EntityType.candidate,
        status=EntityStatus.screening,
        position="Junior Developer",
        tags=["javascript", "react"],
        extra_data={
            "skills": ["JavaScript", "React", "Node.js"],
            "experience_years": 2
        },
        expected_salary_min=100000,
        expected_salary_max=150000,
        expected_salary_currency="RUB",
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def application(db_session: AsyncSession, vacancy, candidate_for_scoring) -> VacancyApplication:
    """Create a vacancy application."""
    app = VacancyApplication(
        vacancy_id=vacancy.id,
        entity_id=candidate_for_scoring.id,
        stage=ApplicationStage.interview,
        source="linkedin",
        applied_at=datetime.utcnow()
    )
    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)
    return app


# ============================================================================
# UNIT TESTS - AI SCORING SERVICE
# ============================================================================

class TestCompatibilityScore:
    """Tests for CompatibilityScore dataclass."""

    def test_create_default_score(self):
        """Test creating a default compatibility score."""
        score = CompatibilityScore()
        assert score.overall_score == 0
        assert score.skills_match == 0
        assert score.experience_match == 0
        assert score.salary_match == 0
        assert score.culture_fit == 0
        assert score.strengths == []
        assert score.weaknesses == []
        assert score.recommendation == Recommendation.MAYBE.value

    def test_create_full_score(self):
        """Test creating a fully populated score."""
        score = CompatibilityScore(
            overall_score=85,
            skills_match=90,
            experience_match=80,
            salary_match=95,
            culture_fit=75,
            strengths=["Strong Python skills", "Leadership experience"],
            weaknesses=["No FastAPI experience"],
            recommendation=Recommendation.HIRE.value,
            summary="Excellent candidate",
            key_factors=["Technical skills", "Team fit"]
        )
        assert score.overall_score == 85
        assert score.skills_match == 90
        assert len(score.strengths) == 2
        assert score.recommendation == "hire"

    def test_score_to_dict(self):
        """Test converting score to dictionary."""
        score = CompatibilityScore(
            overall_score=75,
            skills_match=80,
            strengths=["Good skills"]
        )
        d = score.to_dict()
        assert isinstance(d, dict)
        assert d["overall_score"] == 75
        assert d["skills_match"] == 80
        assert d["strengths"] == ["Good skills"]

    def test_score_from_dict(self):
        """Test creating score from dictionary."""
        data = {
            "overall_score": 70,
            "skills_match": 75,
            "experience_match": 80,
            "salary_match": 90,
            "culture_fit": 65,
            "strengths": ["Fast learner"],
            "weaknesses": ["Junior level"],
            "recommendation": "maybe",
            "summary": "Good potential",
            "key_factors": ["Growth potential"]
        }
        score = CompatibilityScore.from_dict(data)
        assert score.overall_score == 70
        assert score.recommendation == "maybe"


class TestAIScoringServiceHelpers:
    """Tests for AI Scoring Service helper methods."""

    def test_extract_entity_skills_from_list(self):
        """Test extracting skills from extra_data list."""
        service = AIScoringService()
        entity = MagicMock()
        entity.extra_data = {"skills": ["Python", "FastAPI", "SQL"]}
        entity.tags = []

        skills = service._extract_entity_skills(entity)
        assert "Python" in skills
        assert "FastAPI" in skills
        assert "SQL" in skills

    def test_extract_entity_skills_from_string(self):
        """Test extracting skills from comma-separated string."""
        service = AIScoringService()
        entity = MagicMock()
        entity.extra_data = {"skills": "Python, FastAPI, SQL"}
        entity.tags = []

        skills = service._extract_entity_skills(entity)
        assert "Python" in skills
        assert "FastAPI" in skills
        assert "SQL" in skills

    def test_extract_entity_skills_includes_tags(self):
        """Test that tags are included in skills."""
        service = AIScoringService()
        entity = MagicMock()
        entity.extra_data = {"skills": ["Python"]}
        entity.tags = ["backend", "senior"]

        skills = service._extract_entity_skills(entity)
        assert "Python" in skills
        assert "backend" in skills
        assert "senior" in skills

    def test_extract_entity_experience_from_int(self):
        """Test extracting experience years from integer."""
        service = AIScoringService()
        entity = MagicMock()
        entity.extra_data = {"experience_years": 5}

        exp = service._extract_entity_experience(entity)
        assert exp == 5

    def test_extract_entity_experience_from_string(self):
        """Test extracting experience years from string."""
        service = AIScoringService()
        entity = MagicMock()
        entity.extra_data = {"experience": "3 years"}

        exp = service._extract_entity_experience(entity)
        assert exp == 3

    def test_extract_entity_experience_none(self):
        """Test extracting experience when not available."""
        service = AIScoringService()
        entity = MagicMock()
        entity.extra_data = {}

        exp = service._extract_entity_experience(entity)
        assert exp is None


class TestAIScoringServiceProfiles:
    """Tests for profile building methods."""

    def test_build_entity_profile(self):
        """Test building entity profile string."""
        service = AIScoringService()
        entity = MagicMock()
        entity.name = "Test User"
        entity.position = "Developer"
        entity.company = "Tech Corp"
        entity.email = "test@example.com"
        entity.status = MagicMock(value="interview")
        entity.expected_salary_min = 100000
        entity.expected_salary_max = 150000
        entity.expected_salary_currency = "RUB"
        entity.extra_data = {"skills": ["Python"]}
        entity.tags = []
        entity.ai_summary = "Good candidate"

        profile = service._build_entity_profile(entity)
        assert "Test User" in profile
        assert "Developer" in profile
        assert "Tech Corp" in profile
        assert "Python" in profile
        assert "100,000" in profile or "100000" in profile

    def test_build_vacancy_profile(self):
        """Test building vacancy profile string."""
        service = AIScoringService()
        vacancy = MagicMock()
        vacancy.title = "Python Developer"
        vacancy.description = "Backend development role"
        vacancy.requirements = "5+ years Python"
        vacancy.responsibilities = "Develop APIs"
        vacancy.salary_min = 200000
        vacancy.salary_max = 300000
        vacancy.salary_currency = "RUB"
        vacancy.location = "Remote"
        vacancy.employment_type = "full-time"
        vacancy.experience_level = "senior"
        vacancy.tags = ["python", "backend"]

        profile = service._build_vacancy_profile(vacancy)
        assert "Python Developer" in profile
        assert "Backend development role" in profile
        assert "5+ years Python" in profile
        assert "200,000" in profile or "200000" in profile


class TestAIScoringServiceParser:
    """Tests for AI response parsing."""

    def test_parse_valid_response(self):
        """Test parsing valid AI response."""
        service = AIScoringService()
        response = json.dumps({
            "overall_score": 85,
            "skills_match": 90,
            "experience_match": 80,
            "salary_match": 95,
            "culture_fit": 75,
            "strengths": ["Strong skills"],
            "weaknesses": ["Minor gaps"],
            "recommendation": "hire",
            "summary": "Great match",
            "key_factors": ["Technical"]
        })

        score = service._parse_ai_response(response)
        assert score.overall_score == 85
        assert score.recommendation == "hire"

    def test_parse_response_with_extra_text(self):
        """Test parsing response with surrounding text."""
        service = AIScoringService()
        response = """Here is the analysis:
        {"overall_score": 70, "skills_match": 75, "experience_match": 65,
         "salary_match": 80, "culture_fit": 70, "strengths": [],
         "weaknesses": [], "recommendation": "maybe", "summary": "OK",
         "key_factors": []}
        This is my assessment."""

        score = service._parse_ai_response(response)
        assert score.overall_score == 70

    def test_parse_invalid_response(self):
        """Test parsing invalid response returns default score."""
        service = AIScoringService()
        response = "This is not valid JSON"

        score = service._parse_ai_response(response)
        assert score.overall_score == 50  # Default fallback
        assert "parsing error" in score.summary.lower()

    def test_parse_normalizes_scores(self):
        """Test that scores are normalized to 0-100 range."""
        service = AIScoringService()
        response = json.dumps({
            "overall_score": 150,  # Over 100
            "skills_match": -10,  # Negative
            "experience_match": 80,
            "salary_match": 95,
            "culture_fit": 75,
            "strengths": [],
            "weaknesses": [],
            "recommendation": "hire",
            "summary": "Test",
            "key_factors": []
        })

        score = service._parse_ai_response(response)
        assert score.overall_score == 100  # Clamped to max
        assert score.skills_match == 0  # Clamped to min


# ============================================================================
# INTEGRATION TESTS - API ENDPOINTS
# ============================================================================

class TestScoringEndpoints:
    """Tests for scoring API endpoints."""

    @pytest.mark.asyncio
    async def test_calculate_score_success(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        vacancy,
        candidate_for_scoring,
        mock_anthropic_client
    ):
        """Test calculating compatibility score via API."""
        # Mock AI response for scoring
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "overall_score": 85,
            "skills_match": 90,
            "experience_match": 80,
            "salary_match": 95,
            "culture_fit": 75,
            "strengths": ["Strong Python skills", "Good experience"],
            "weaknesses": ["Could improve communication"],
            "recommendation": "hire",
            "summary": "Excellent match for the position",
            "key_factors": ["Technical skills", "Experience level"]
        }))]
        mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

        response = await client.post(
            "/api/scoring/calculate",
            json={
                "entity_id": candidate_for_scoring.id,
                "vacancy_id": vacancy.id
            },
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert "score" in data
        assert data["score"]["overall_score"] == 85
        assert data["score"]["recommendation"] == "hire"
        assert len(data["score"]["strengths"]) > 0

    @pytest.mark.asyncio
    async def test_calculate_score_unauthorized(
        self,
        client: AsyncClient,
        vacancy,
        candidate_for_scoring
    ):
        """Test that unauthorized requests are rejected."""
        response = await client.post(
            "/api/scoring/calculate",
            json={
                "entity_id": candidate_for_scoring.id,
                "vacancy_id": vacancy.id
            }
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_calculate_score_entity_not_found(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        vacancy
    ):
        """Test handling of non-existent entity."""
        response = await client.post(
            "/api/scoring/calculate",
            json={
                "entity_id": 99999,
                "vacancy_id": vacancy.id
            },
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_calculate_score_vacancy_not_found(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        candidate_for_scoring
    ):
        """Test handling of non-existent vacancy."""
        response = await client.post(
            "/api/scoring/calculate",
            json={
                "entity_id": candidate_for_scoring.id,
                "vacancy_id": 99999
            },
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_calculate_score_non_candidate(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        vacancy,
        second_entity  # This is a client, not candidate
    ):
        """Test that scoring only works for candidates."""
        response = await client.post(
            "/api/scoring/calculate",
            json={
                "entity_id": second_entity.id,
                "vacancy_id": vacancy.id
            },
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "кандидатов" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_get_application_score_cached(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        db_session,
        vacancy,
        candidate_for_scoring,
        application
    ):
        """Test getting cached score from application."""
        # Set cached score on application
        application.compatibility_score = {
            "overall_score": 75,
            "skills_match": 80,
            "experience_match": 70,
            "salary_match": 85,
            "culture_fit": 70,
            "strengths": ["Cached strength"],
            "weaknesses": ["Cached weakness"],
            "recommendation": "maybe",
            "summary": "Cached summary",
            "key_factors": ["Cached factor"]
        }
        await db_session.commit()

        response = await client.get(
            f"/api/scoring/application/{application.id}",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["cached"] is True
        assert data["score"]["overall_score"] == 75

    @pytest.mark.asyncio
    async def test_recalculate_application_score(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        vacancy,
        candidate_for_scoring,
        application,
        mock_anthropic_client
    ):
        """Test forcing recalculation of application score."""
        # Mock AI response
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "overall_score": 90,
            "skills_match": 95,
            "experience_match": 85,
            "salary_match": 90,
            "culture_fit": 85,
            "strengths": ["Recalculated strength"],
            "weaknesses": [],
            "recommendation": "hire",
            "summary": "Recalculated summary",
            "key_factors": []
        }))]
        mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

        response = await client.post(
            f"/api/scoring/application/{application.id}/recalculate",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["cached"] is False
        assert data["score"]["overall_score"] == 90


class TestBestMatchesEndpoint:
    """Tests for finding best matches endpoint."""

    @pytest.mark.asyncio
    async def test_find_best_matches_for_vacancy(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        vacancy,
        candidate_for_scoring,
        second_candidate,
        mock_anthropic_client
    ):
        """Test finding best matching candidates for a vacancy."""
        # Mock AI responses for both candidates
        call_count = 0

        async def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            score = 85 if call_count == 1 else 60
            mock_response = MagicMock()
            mock_response.content = [MagicMock(text=json.dumps({
                "overall_score": score,
                "skills_match": score,
                "experience_match": score,
                "salary_match": score,
                "culture_fit": score,
                "strengths": [f"Strength {call_count}"],
                "weaknesses": [],
                "recommendation": "hire" if score > 70 else "maybe",
                "summary": f"Summary {call_count}",
                "key_factors": []
            }))]
            return mock_response

        mock_anthropic_client.messages.create = mock_create

        response = await client.post(
            f"/api/scoring/vacancy/{vacancy.id}/matches",
            json={"limit": 10, "min_score": 0},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["vacancy_id"] == vacancy.id
        assert "matches" in data
        # Results should be sorted by score descending
        if len(data["matches"]) > 1:
            scores = [m["score"]["overall_score"] for m in data["matches"]]
            assert scores == sorted(scores, reverse=True)


class TestMatchingVacanciesEndpoint:
    """Tests for finding matching vacancies endpoint."""

    @pytest.mark.asyncio
    async def test_find_matching_vacancies_for_entity(
        self,
        client: AsyncClient,
        admin_user,
        admin_token,
        org_owner,
        vacancy,
        candidate_for_scoring,
        mock_anthropic_client
    ):
        """Test finding matching vacancies for a candidate."""
        # Mock AI response
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "overall_score": 80,
            "skills_match": 85,
            "experience_match": 75,
            "salary_match": 90,
            "culture_fit": 70,
            "strengths": ["Good match"],
            "weaknesses": [],
            "recommendation": "hire",
            "summary": "Good vacancy match",
            "key_factors": []
        }))]
        mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

        response = await client.post(
            f"/api/scoring/entity/{candidate_for_scoring.id}/vacancies",
            json={"limit": 10, "min_score": 0},
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["entity_id"] == candidate_for_scoring.id
        assert "matches" in data


# ============================================================================
# SERVICE INTEGRATION TESTS
# ============================================================================

class TestAIScoringServiceIntegration:
    """Integration tests for AI Scoring Service."""

    @pytest.mark.asyncio
    async def test_calculate_compatibility_mocked(
        self,
        candidate_for_scoring,
        vacancy,
        mock_anthropic_client
    ):
        """Test full scoring flow with mocked AI."""
        # Mock AI response
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "overall_score": 82,
            "skills_match": 88,
            "experience_match": 78,
            "salary_match": 85,
            "culture_fit": 75,
            "strengths": ["Strong Python", "FastAPI experience"],
            "weaknesses": ["Could improve soft skills"],
            "recommendation": "hire",
            "summary": "Very good candidate for this role",
            "key_factors": ["Technical match", "Experience level"]
        }))]
        mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

        service = AIScoringService()
        # Override client to use mock
        service._client = mock_anthropic_client

        score = await service.calculate_compatibility(candidate_for_scoring, vacancy)

        assert score.overall_score == 82
        assert score.skills_match == 88
        assert score.recommendation == "hire"
        assert len(score.strengths) == 2

    @pytest.mark.asyncio
    async def test_bulk_score_mocked(
        self,
        candidate_for_scoring,
        second_candidate,
        vacancy,
        mock_anthropic_client
    ):
        """Test bulk scoring with mocked AI."""
        call_count = 0

        async def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            score = 85 if call_count == 1 else 55
            mock_response = MagicMock()
            mock_response.content = [MagicMock(text=json.dumps({
                "overall_score": score,
                "skills_match": score,
                "experience_match": score,
                "salary_match": score,
                "culture_fit": score,
                "strengths": [],
                "weaknesses": [],
                "recommendation": "hire" if score > 70 else "maybe",
                "summary": f"Candidate {call_count}",
                "key_factors": []
            }))]
            return mock_response

        mock_anthropic_client.messages.create = mock_create

        service = AIScoringService()
        service._client = mock_anthropic_client

        results = await service.bulk_score(
            [candidate_for_scoring, second_candidate],
            vacancy
        )

        assert len(results) == 2
        # Should be sorted by score descending
        assert results[0]["score"]["overall_score"] >= results[1]["score"]["overall_score"]


# ============================================================================
# ERROR HANDLING TESTS
# ============================================================================

class TestScoringErrorHandling:
    """Tests for error handling in scoring service."""

    @pytest.mark.asyncio
    async def test_ai_error_returns_default_score(
        self,
        candidate_for_scoring,
        vacancy,
        mock_anthropic_client
    ):
        """Test that AI errors return a default score."""
        mock_anthropic_client.messages.create = AsyncMock(
            side_effect=Exception("API Error")
        )

        service = AIScoringService()
        service._client = mock_anthropic_client

        score = await service.calculate_compatibility(candidate_for_scoring, vacancy)

        # Should return default score on error
        assert score.overall_score == 50
        assert "error" in score.summary.lower() or "Could not" in score.summary

    @pytest.mark.asyncio
    async def test_invalid_json_response(
        self,
        candidate_for_scoring,
        vacancy,
        mock_anthropic_client
    ):
        """Test handling of invalid JSON from AI."""
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="This is not valid JSON at all")]
        mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

        service = AIScoringService()
        service._client = mock_anthropic_client

        score = await service.calculate_compatibility(candidate_for_scoring, vacancy)

        # Should return default score on parse error
        assert score.overall_score == 50


# ============================================================================
# RECOMMENDATION TESTS
# ============================================================================

class TestRecommendation:
    """Tests for recommendation enum."""

    def test_recommendation_values(self):
        """Test recommendation enum values."""
        assert Recommendation.HIRE.value == "hire"
        assert Recommendation.MAYBE.value == "maybe"
        assert Recommendation.REJECT.value == "reject"

    def test_recommendation_is_string(self):
        """Test that recommendation can be used as string."""
        rec = Recommendation.HIRE
        assert str(rec.value) == "hire"
        assert rec.value == "hire"
