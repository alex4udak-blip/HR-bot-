"""
Tests for similarity service - similar candidates search and duplicate detection.
"""
import pytest
import pytest_asyncio
from datetime import datetime

from api.models.database import Entity, EntityType, EntityStatus, Organization, Department, User
from api.services.similarity import (
    similarity_service,
    transliterate_ru_to_en,
    transliterate_en_to_ru,
    generate_name_variants,
    normalize_phone,
    normalize_email,
    extract_skills,
    extract_experience_years,
    extract_location,
    calculate_skills_similarity,
    calculate_salary_overlap,
    calculate_experience_similarity,
    calculate_location_similarity,
    SimilarCandidate,
    DuplicateCandidate,
)
from tests.conftest import auth_headers


class TestTransliteration:
    """Tests for transliteration functions."""

    def test_transliterate_ru_to_en_simple(self):
        """Test simple Russian to English transliteration."""
        assert transliterate_ru_to_en("Иван") == "ivan"
        assert transliterate_ru_to_en("Петров") == "petrov"
        assert transliterate_ru_to_en("Александр") == "aleksandr"

    def test_transliterate_ru_to_en_complex(self):
        """Test complex Russian to English transliteration."""
        assert transliterate_ru_to_en("Щукин") == "shchukin"
        assert transliterate_ru_to_en("Юрий") == "yuriy"
        assert transliterate_ru_to_en("Ёлка") == "yolka"

    def test_transliterate_en_to_ru_simple(self):
        """Test simple English to Russian transliteration."""
        assert transliterate_en_to_ru("ivan") == "иван"
        assert transliterate_en_to_ru("alex") == "алекс"

    def test_transliterate_en_to_ru_digraphs(self):
        """Test English digraphs transliteration."""
        assert transliterate_en_to_ru("shch") == "щ"
        assert transliterate_en_to_ru("yu") == "ю"
        assert transliterate_en_to_ru("ch") == "ч"


class TestNameVariants:
    """Tests for name variants generation."""

    def test_generate_russian_name_variants(self):
        """Test variants for Russian names."""
        variants = generate_name_variants("Иван Петров")
        assert "иван петров" in variants
        assert "ivan petrov" in variants
        assert "иванпетров" in variants
        assert "ivanpetrov" in variants

    def test_generate_english_name_variants(self):
        """Test variants for English names."""
        variants = generate_name_variants("Ivan Petrov")
        assert "ivan petrov" in variants
        # Russian transliteration
        assert any("иван" in v for v in variants)

    def test_generate_mixed_name_variants(self):
        """Test variants for mixed names."""
        variants = generate_name_variants("Александр Smith")
        assert "александр smith" in variants
        # Should contain both transliterations
        assert len(variants) > 2


class TestNormalization:
    """Tests for data normalization functions."""

    def test_normalize_phone_russian(self):
        """Test Russian phone normalization."""
        assert normalize_phone("+7 (999) 123-45-67") == "79991234567"
        assert normalize_phone("8-999-123-45-67") == "79991234567"
        assert normalize_phone("89991234567") == "79991234567"
        assert normalize_phone("79991234567") == "79991234567"

    def test_normalize_phone_empty(self):
        """Test empty phone normalization."""
        assert normalize_phone("") == ""
        assert normalize_phone(None) == ""

    def test_normalize_email(self):
        """Test email normalization."""
        assert normalize_email("Test@Example.COM") == "test@example.com"
        assert normalize_email("  user@test.ru  ") == "user@test.ru"
        assert normalize_email("") == ""


class TestSkillsExtraction:
    """Tests for skills extraction from extra_data."""

    def test_extract_skills_list(self):
        """Test skills extraction from list."""
        extra_data = {"skills": ["Python", "JavaScript", "React"]}
        skills = extract_skills(extra_data)
        assert skills == {"python", "javascript", "react"}

    def test_extract_skills_string(self):
        """Test skills extraction from string."""
        extra_data = {"skills": "Python, JavaScript, React"}
        skills = extract_skills(extra_data)
        assert "python" in skills
        assert "javascript" in skills
        assert "react" in skills

    def test_extract_skills_technologies(self):
        """Test skills extraction from technologies field."""
        extra_data = {"technologies": ["Docker", "Kubernetes"]}
        skills = extract_skills(extra_data)
        assert skills == {"docker", "kubernetes"}

    def test_extract_skills_empty(self):
        """Test skills extraction from empty data."""
        assert extract_skills({}) == set()
        assert extract_skills(None) == set()


class TestExperienceExtraction:
    """Tests for experience extraction."""

    def test_extract_experience_int(self):
        """Test experience extraction from integer."""
        assert extract_experience_years({"experience": 5}) == 5
        assert extract_experience_years({"experience_years": 3}) == 3

    def test_extract_experience_string(self):
        """Test experience extraction from string."""
        assert extract_experience_years({"experience": "5 лет"}) == 5
        assert extract_experience_years({"experience": "более 3 years"}) == 3

    def test_extract_experience_empty(self):
        """Test experience extraction from empty data."""
        assert extract_experience_years({}) is None
        assert extract_experience_years(None) is None


class TestLocationExtraction:
    """Tests for location extraction."""

    def test_extract_location(self):
        """Test location extraction."""
        assert extract_location({"location": "Москва"}) == "москва"
        assert extract_location({"city": "Saint Petersburg"}) == "saint petersburg"

    def test_extract_location_empty(self):
        """Test location extraction from empty data."""
        assert extract_location({}) is None
        assert extract_location({"location": ""}) is None


class TestSimilarityCalculations:
    """Tests for similarity calculation functions."""

    def test_calculate_skills_similarity(self):
        """Test skills similarity calculation."""
        skills1 = {"python", "javascript", "react"}
        skills2 = {"python", "typescript", "react"}
        score, common = calculate_skills_similarity(skills1, skills2)
        assert 0 < score < 1
        assert set(common) == {"python", "react"}

    def test_calculate_skills_similarity_identical(self):
        """Test identical skills similarity."""
        skills = {"python", "javascript"}
        score, common = calculate_skills_similarity(skills, skills)
        assert score == 1.0
        assert set(common) == skills

    def test_calculate_skills_similarity_empty(self):
        """Test empty skills similarity."""
        score, common = calculate_skills_similarity(set(), {"python"})
        assert score == 0.0
        assert common == []

    def test_calculate_salary_overlap(self):
        """Test salary overlap calculation."""
        # Overlapping ranges
        assert calculate_salary_overlap(100000, 150000, 120000, 180000) is True
        # Non-overlapping ranges
        assert calculate_salary_overlap(100000, 150000, 200000, 250000) is False
        # Adjacent ranges
        assert calculate_salary_overlap(100000, 150000, 150000, 200000) is True

    def test_calculate_salary_overlap_none(self):
        """Test salary overlap with None values."""
        assert calculate_salary_overlap(None, 150000, 120000, 180000) is True
        assert calculate_salary_overlap(100000, None, None, 180000) is True

    def test_calculate_experience_similarity(self):
        """Test experience similarity calculation."""
        assert calculate_experience_similarity(5, 5) is True
        assert calculate_experience_similarity(5, 6) is True
        assert calculate_experience_similarity(5, 7) is True
        assert calculate_experience_similarity(5, 8) is False
        assert calculate_experience_similarity(None, 5) is False

    def test_calculate_location_similarity(self):
        """Test location similarity calculation."""
        assert calculate_location_similarity("москва", "Москва") is True
        assert calculate_location_similarity("moscow", "Moscow, Russia") is True
        assert calculate_location_similarity("москва", "санкт-петербург") is False


# ============================================================================
# INTEGRATION TESTS
# ============================================================================


@pytest_asyncio.fixture
async def candidate_with_skills(
    db_session, organization, department, admin_user
) -> Entity:
    """Create a candidate with skills for testing."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Иван Петров",
        email="ivan@test.com",
        phone="+79991234567",
        type=EntityType.candidate,
        status=EntityStatus.active,
        extra_data={
            "skills": ["Python", "JavaScript", "React", "PostgreSQL"],
            "experience": 5,
            "location": "Москва"
        },
        expected_salary_min=150000,
        expected_salary_max=200000,
        expected_salary_currency="RUB",
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def similar_candidate(
    db_session, organization, department, admin_user
) -> Entity:
    """Create a similar candidate for testing."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Петр Сидоров",
        email="petr@test.com",
        phone="+79998765432",
        type=EntityType.candidate,
        status=EntityStatus.active,
        extra_data={
            "skills": ["Python", "TypeScript", "React", "MongoDB"],
            "experience": 4,
            "location": "Москва"
        },
        expected_salary_min=140000,
        expected_salary_max=180000,
        expected_salary_currency="RUB",
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def duplicate_candidate(
    db_session, organization, department, admin_user
) -> Entity:
    """Create a duplicate candidate for testing."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Ivan Petrov",  # Same name, different transliteration
        email="ivan@test.com",  # Same email
        phone="+7 999 123-45-67",  # Same phone, different format
        type=EntityType.candidate,
        status=EntityStatus.new,
        extra_data={"skills": ["Python", "Django"]},
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


class TestSimilarityServiceIntegration:
    """Integration tests for SimilarityService."""

    @pytest.mark.asyncio
    async def test_find_similar_candidates(
        self, db_session, candidate_with_skills, similar_candidate
    ):
        """Test finding similar candidates."""
        results = await similarity_service.find_similar(
            db=db_session,
            entity=candidate_with_skills,
            limit=10
        )

        assert len(results) >= 1
        # Similar candidate should be found
        found_ids = [r.entity_id for r in results]
        assert similar_candidate.id in found_ids

        # Check result structure
        similar_result = next(r for r in results if r.entity_id == similar_candidate.id)
        assert similar_result.similarity_score > 0
        assert len(similar_result.common_skills) > 0
        assert "python" in [s.lower() for s in similar_result.common_skills]
        assert "react" in [s.lower() for s in similar_result.common_skills]

    @pytest.mark.asyncio
    async def test_calculate_similarity_between_two(
        self, db_session, candidate_with_skills, similar_candidate
    ):
        """Test calculating similarity between two candidates."""
        result = similarity_service.calculate_similarity(
            candidate_with_skills,
            similar_candidate
        )

        assert isinstance(result, SimilarCandidate)
        assert result.entity_id == similar_candidate.id
        assert result.similarity_score > 0
        assert result.similar_experience is True  # 5 vs 4 years
        assert result.similar_location is True  # Both in Moscow

    @pytest.mark.asyncio
    async def test_detect_duplicates(
        self, db_session, candidate_with_skills, duplicate_candidate
    ):
        """Test detecting duplicates."""
        results = await similarity_service.detect_duplicates(
            db=db_session,
            entity=candidate_with_skills
        )

        assert len(results) >= 1
        found_ids = [r.entity_id for r in results]
        assert duplicate_candidate.id in found_ids

        # Check duplicate details
        dup_result = next(r for r in results if r.entity_id == duplicate_candidate.id)
        assert dup_result.confidence >= 30  # Minimum threshold
        assert len(dup_result.match_reasons) > 0
        # Should match on name, email, and/or phone
        assert any(
            field in dup_result.matched_fields
            for field in ['name', 'email', 'phone']
        )


class TestSimilarityEndpoints:
    """Tests for similarity API endpoints."""

    @pytest.mark.asyncio
    async def test_get_similar_candidates_endpoint(
        self, client, admin_token, organization, department, admin_user,
        candidate_with_skills, similar_candidate, org_owner
    ):
        """Test GET /entities/{id}/similar endpoint."""
        response = await client.get(
            f"/api/entities/{candidate_with_skills.id}/similar",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_get_similar_candidates_not_candidate(
        self, client, admin_token, organization, department, admin_user, db_session, org_owner
    ):
        """Test that similar search only works for candidates."""
        # Create a non-candidate entity
        entity = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Client Company",
            type=EntityType.client,
            status=EntityStatus.active,
            created_at=datetime.utcnow()
        )
        db_session.add(entity)
        await db_session.commit()
        await db_session.refresh(entity)

        response = await client.get(
            f"/api/entities/{entity.id}/similar",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "только для кандидатов" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_get_duplicates_endpoint(
        self, client, admin_token, candidate_with_skills, duplicate_candidate, org_owner
    ):
        """Test GET /entities/{id}/duplicates endpoint."""
        response = await client.get(
            f"/api/entities/{candidate_with_skills.id}/duplicates",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_compare_candidates_endpoint(
        self, client, admin_token, candidate_with_skills, similar_candidate, org_owner
    ):
        """Test GET /entities/{id}/compare/{other_id} endpoint."""
        response = await client.get(
            f"/api/entities/{candidate_with_skills.id}/compare/{similar_candidate.id}",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert "similarity_score" in data
        assert "common_skills" in data
        assert data["entity_id"] == similar_candidate.id

    @pytest.mark.asyncio
    async def test_compare_same_candidate(
        self, client, admin_token, candidate_with_skills, org_owner
    ):
        """Test comparing candidate with itself."""
        response = await client.get(
            f"/api/entities/{candidate_with_skills.id}/compare/{candidate_with_skills.id}",
            headers=auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "саму с собой" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_merge_entities_endpoint(
        self, client, admin_token, candidate_with_skills, duplicate_candidate, org_owner
    ):
        """Test POST /entities/{id}/merge endpoint."""
        response = await client.post(
            f"/api/entities/{candidate_with_skills.id}/merge",
            headers=auth_headers(admin_token),
            json={
                "source_entity_id": duplicate_candidate.id,
                "keep_source_data": False
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["merged_entity_id"] == candidate_with_skills.id
        assert data["deleted_entity_id"] == duplicate_candidate.id

    @pytest.mark.asyncio
    async def test_merge_entities_same_id(
        self, client, admin_token, candidate_with_skills, org_owner
    ):
        """Test merging entity with itself."""
        response = await client.post(
            f"/api/entities/{candidate_with_skills.id}/merge",
            headers=auth_headers(admin_token),
            json={
                "source_entity_id": candidate_with_skills.id,
                "keep_source_data": False
            }
        )

        assert response.status_code == 400
        assert "саму с собой" in response.json()["detail"].lower()


class TestMergeEntities:
    """Tests for entity merging functionality."""

    @pytest.mark.asyncio
    async def test_merge_combines_phones(
        self, db_session, organization, department, admin_user
    ):
        """Test that merge combines phone numbers."""
        target = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Target Entity",
            phone="+79991111111",
            phones=["+79992222222"],
            type=EntityType.candidate,
            status=EntityStatus.active,
            extra_data={},
            created_at=datetime.utcnow()
        )
        source = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Source Entity",
            phone="+79993333333",
            phones=["+79994444444"],
            type=EntityType.candidate,
            status=EntityStatus.new,
            extra_data={},
            created_at=datetime.utcnow()
        )
        db_session.add_all([target, source])
        await db_session.commit()

        merged = await similarity_service.merge_entities(
            db=db_session,
            source_entity=source,
            target_entity=target
        )

        # All phones should be combined
        all_phones = set(merged.phones or [])
        assert "+79991111111" in all_phones
        assert "+79992222222" in all_phones
        assert "+79993333333" in all_phones
        assert "+79994444444" in all_phones

    @pytest.mark.asyncio
    async def test_merge_combines_skills(
        self, db_session, organization, department, admin_user
    ):
        """Test that merge combines skills."""
        target = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Target Entity",
            type=EntityType.candidate,
            status=EntityStatus.active,
            extra_data={"skills": ["Python", "React"]},
            created_at=datetime.utcnow()
        )
        source = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Source Entity",
            type=EntityType.candidate,
            status=EntityStatus.new,
            extra_data={"skills": ["Python", "Django", "PostgreSQL"]},
            created_at=datetime.utcnow()
        )
        db_session.add_all([target, source])
        await db_session.commit()

        merged = await similarity_service.merge_entities(
            db=db_session,
            source_entity=source,
            target_entity=target
        )

        merged_skills = set(merged.extra_data.get("skills", []))
        assert "python" in merged_skills
        assert "react" in merged_skills
        assert "django" in merged_skills
        assert "postgresql" in merged_skills

    @pytest.mark.asyncio
    async def test_merge_expands_salary_range(
        self, db_session, organization, department, admin_user
    ):
        """Test that merge expands salary range."""
        target = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Target Entity",
            type=EntityType.candidate,
            status=EntityStatus.active,
            expected_salary_min=150000,
            expected_salary_max=200000,
            extra_data={},
            created_at=datetime.utcnow()
        )
        source = Entity(
            org_id=organization.id,
            department_id=department.id,
            created_by=admin_user.id,
            name="Source Entity",
            type=EntityType.candidate,
            status=EntityStatus.new,
            expected_salary_min=120000,
            expected_salary_max=220000,
            extra_data={},
            created_at=datetime.utcnow()
        )
        db_session.add_all([target, source])
        await db_session.commit()

        merged = await similarity_service.merge_entities(
            db=db_session,
            source_entity=source,
            target_entity=target
        )

        # Should take min of mins and max of maxes
        assert merged.expected_salary_min == 120000
        assert merged.expected_salary_max == 220000
