"""
Tests for vacancies API routes - Kanban board and vacancy management.
"""
import pytest
import pytest_asyncio
from datetime import datetime
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import (
    Vacancy, VacancyApplication, VacancyStatus, ApplicationStage,
    Entity, EntityType, EntityStatus, User, Organization, Department
)
from api.services.auth import create_access_token


# ============================================================================
# FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def vacancy(db_session: AsyncSession, organization: Organization, department: Department, admin_user: User) -> Vacancy:
    """Create a test vacancy."""
    vacancy = Vacancy(
        org_id=organization.id,
        department_id=department.id,
        title="Senior Python Developer",
        description="We are looking for an experienced Python developer",
        requirements="5+ years experience with Python, FastAPI, PostgreSQL",
        responsibilities="Develop and maintain backend services",
        salary_min=150000,
        salary_max=250000,
        salary_currency="RUB",
        location="Moscow",
        employment_type="full-time",
        experience_level="senior",
        status=VacancyStatus.open,
        priority=1,
        tags=["python", "backend", "fastapi"],
        hiring_manager_id=admin_user.id,
        created_by=admin_user.id,
        published_at=datetime.utcnow(),
        created_at=datetime.utcnow()
    )
    db_session.add(vacancy)
    await db_session.commit()
    await db_session.refresh(vacancy)
    return vacancy


@pytest_asyncio.fixture
async def draft_vacancy(db_session: AsyncSession, organization: Organization, admin_user: User) -> Vacancy:
    """Create a draft vacancy."""
    vacancy = Vacancy(
        org_id=organization.id,
        title="Junior Frontend Developer",
        description="Entry level frontend position",
        status=VacancyStatus.draft,
        created_by=admin_user.id,
        created_at=datetime.utcnow()
    )
    db_session.add(vacancy)
    await db_session.commit()
    await db_session.refresh(vacancy)
    return vacancy


@pytest_asyncio.fixture
async def candidate_for_vacancy(db_session: AsyncSession, organization: Organization, department: Department, admin_user: User) -> Entity:
    """Create a candidate entity for vacancy application."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="John Developer",
        email="john@example.com",
        phone="+79991234567",
        type=EntityType.candidate,
        status=EntityStatus.new,
        position="Python Developer",
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def second_candidate(db_session: AsyncSession, organization: Organization, department: Department, admin_user: User) -> Entity:
    """Create a second candidate entity."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Jane Smith",
        email="jane@example.com",
        type=EntityType.candidate,
        status=EntityStatus.new,
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def application(
    db_session: AsyncSession,
    vacancy: Vacancy,
    candidate_for_vacancy: Entity,
    admin_user: User
) -> VacancyApplication:
    """Create a vacancy application."""
    app = VacancyApplication(
        vacancy_id=vacancy.id,
        entity_id=candidate_for_vacancy.id,
        stage=ApplicationStage.applied,
        stage_order=1,
        source="linkedin",
        created_by=admin_user.id,
        applied_at=datetime.utcnow()
    )
    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)
    return app


def auth_headers(token: str) -> dict:
    """Create authorization headers with token."""
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# VACANCY CRUD TESTS
# ============================================================================

class TestVacancyCRUD:
    """Tests for vacancy CRUD operations."""

    async def test_list_vacancies_empty(
        self,
        client: AsyncClient,
        admin_user: User,
        organization: Organization,
        org_owner
    ):
        """Test listing vacancies when none exist."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            "/api/vacancies/",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        assert response.json() == []

    async def test_create_vacancy(
        self,
        client: AsyncClient,
        admin_user: User,
        organization: Organization,
        department: Department,
        org_owner
    ):
        """Test creating a new vacancy."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        vacancy_data = {
            "title": "Backend Developer",
            "description": "Build amazing APIs",
            "requirements": "Python, FastAPI",
            "salary_min": 100000,
            "salary_max": 200000,
            "location": "Remote",
            "employment_type": "full-time",
            "experience_level": "middle",
            "status": "open",
            "department_id": department.id,
            "tags": ["python", "api"]
        }
        response = await client.post(
            "/api/vacancies/",
            json=vacancy_data,
            headers=auth_headers(token)
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Backend Developer"
        assert data["status"] == "open"
        assert data["salary_min"] == 100000
        assert data["published_at"] is not None  # Should be set when status is open

    async def test_create_draft_vacancy(
        self,
        client: AsyncClient,
        admin_user: User,
        organization: Organization,
        org_owner
    ):
        """Test creating a draft vacancy (not published)."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        vacancy_data = {
            "title": "Draft Position",
            "status": "draft"
        }
        response = await client.post(
            "/api/vacancies/",
            json=vacancy_data,
            headers=auth_headers(token)
        )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "draft"
        assert data["published_at"] is None

    async def test_get_vacancy(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        org_owner
    ):
        """Test getting a single vacancy."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            f"/api/vacancies/{vacancy.id}",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == vacancy.id
        assert data["title"] == vacancy.title
        assert "stage_counts" in data

    async def test_get_vacancy_not_found(
        self,
        client: AsyncClient,
        admin_user: User,
        org_owner
    ):
        """Test getting non-existent vacancy."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            "/api/vacancies/99999",
            headers=auth_headers(token)
        )
        assert response.status_code == 404

    async def test_update_vacancy(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        org_owner
    ):
        """Test updating a vacancy."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        update_data = {
            "title": "Updated Title",
            "salary_max": 300000,
            "priority": 2
        }
        response = await client.put(
            f"/api/vacancies/{vacancy.id}",
            json=update_data,
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Title"
        assert data["salary_max"] == 300000
        assert data["priority"] == 2

    async def test_update_vacancy_status_to_open(
        self,
        client: AsyncClient,
        admin_user: User,
        draft_vacancy: Vacancy,
        org_owner
    ):
        """Test publishing a draft vacancy (sets published_at)."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.put(
            f"/api/vacancies/{draft_vacancy.id}",
            json={"status": "open"},
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "open"
        assert data["published_at"] is not None

    async def test_delete_vacancy(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        org_owner
    ):
        """Test deleting a vacancy."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.delete(
            f"/api/vacancies/{vacancy.id}",
            headers=auth_headers(token)
        )
        assert response.status_code == 204

        # Verify deleted
        response = await client.get(
            f"/api/vacancies/{vacancy.id}",
            headers=auth_headers(token)
        )
        assert response.status_code == 404

    async def test_list_vacancies_with_filter(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        draft_vacancy: Vacancy,
        org_owner
    ):
        """Test listing vacancies with status filter."""
        token = create_access_token(data={"sub": str(admin_user.id)})

        # Filter by open status
        response = await client.get(
            "/api/vacancies/?status=open",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["status"] == "open"

        # Filter by draft status
        response = await client.get(
            "/api/vacancies/?status=draft",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["status"] == "draft"

    async def test_search_vacancies(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        org_owner
    ):
        """Test searching vacancies by title."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            "/api/vacancies/?search=Python",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert "Python" in data[0]["title"]


# ============================================================================
# APPLICATION TESTS
# ============================================================================

class TestVacancyApplications:
    """Tests for vacancy application management."""

    async def test_add_candidate_to_vacancy(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        candidate_for_vacancy: Entity,
        org_owner
    ):
        """Test adding a candidate to vacancy pipeline."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.post(
            f"/api/vacancies/{vacancy.id}/applications",
            json={
                "vacancy_id": vacancy.id,
                "entity_id": candidate_for_vacancy.id,
                "source": "referral"
            },
            headers=auth_headers(token)
        )
        assert response.status_code == 201
        data = response.json()
        assert data["entity_id"] == candidate_for_vacancy.id
        assert data["stage"] == "applied"
        assert data["source"] == "referral"

    async def test_cannot_add_duplicate_application(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        candidate_for_vacancy: Entity,
        application: VacancyApplication,
        org_owner
    ):
        """Test that duplicate applications are rejected."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.post(
            f"/api/vacancies/{vacancy.id}/applications",
            json={
                "vacancy_id": vacancy.id,
                "entity_id": candidate_for_vacancy.id
            },
            headers=auth_headers(token)
        )
        assert response.status_code == 400
        assert "already applied" in response.json()["detail"].lower()

    async def test_list_applications(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        application: VacancyApplication,
        org_owner
    ):
        """Test listing applications for a vacancy."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            f"/api/vacancies/{vacancy.id}/applications",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert data[0]["vacancy_id"] == vacancy.id

    async def test_update_application_stage(
        self,
        client: AsyncClient,
        admin_user: User,
        application: VacancyApplication,
        org_owner
    ):
        """Test moving candidate to next stage."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.put(
            f"/api/vacancies/applications/{application.id}",
            json={"stage": "screening"},
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["stage"] == "screening"

    async def test_update_application_rating(
        self,
        client: AsyncClient,
        admin_user: User,
        application: VacancyApplication,
        org_owner
    ):
        """Test adding rating to application."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.put(
            f"/api/vacancies/applications/{application.id}",
            json={"rating": 5, "notes": "Great candidate!"},
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["rating"] == 5
        assert data["notes"] == "Great candidate!"

    async def test_reject_application(
        self,
        client: AsyncClient,
        admin_user: User,
        application: VacancyApplication,
        org_owner
    ):
        """Test rejecting a candidate."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.put(
            f"/api/vacancies/applications/{application.id}",
            json={
                "stage": "rejected",
                "rejection_reason": "Not enough experience"
            },
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["stage"] == "rejected"
        assert data["rejection_reason"] == "Not enough experience"

    async def test_delete_application(
        self,
        client: AsyncClient,
        admin_user: User,
        application: VacancyApplication,
        org_owner
    ):
        """Test removing candidate from pipeline."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.delete(
            f"/api/vacancies/applications/{application.id}",
            headers=auth_headers(token)
        )
        assert response.status_code == 204


# ============================================================================
# KANBAN BOARD TESTS
# ============================================================================

class TestKanbanBoard:
    """Tests for Kanban board functionality."""

    async def test_get_kanban_board(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        application: VacancyApplication,
        org_owner
    ):
        """Test getting Kanban board data."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            f"/api/vacancies/{vacancy.id}/kanban",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["vacancy_id"] == vacancy.id
        assert data["vacancy_title"] == vacancy.title
        assert "columns" in data
        assert len(data["columns"]) > 0

        # Check that all stages are present
        stages = [col["stage"] for col in data["columns"]]
        assert "applied" in stages
        assert "screening" in stages
        assert "interview" in stages
        assert "hired" in stages
        assert "rejected" in stages

    async def test_kanban_shows_candidates_in_correct_column(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        application: VacancyApplication,
        org_owner
    ):
        """Test that candidates appear in correct Kanban column."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            f"/api/vacancies/{vacancy.id}/kanban",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()

        # Find the 'applied' column
        applied_column = next(
            (col for col in data["columns"] if col["stage"] == "applied"),
            None
        )
        assert applied_column is not None
        assert applied_column["count"] >= 1
        assert len(applied_column["applications"]) >= 1

    async def test_bulk_move_applications(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        vacancy: Vacancy,
        candidate_for_vacancy: Entity,
        second_candidate: Entity,
        org_owner
    ):
        """Test moving multiple candidates to a new stage."""
        token = create_access_token(data={"sub": str(admin_user.id)})

        # Create two applications
        app1 = VacancyApplication(
            vacancy_id=vacancy.id,
            entity_id=candidate_for_vacancy.id,
            stage=ApplicationStage.applied,
            created_by=admin_user.id
        )
        app2 = VacancyApplication(
            vacancy_id=vacancy.id,
            entity_id=second_candidate.id,
            stage=ApplicationStage.applied,
            created_by=admin_user.id
        )
        db_session.add_all([app1, app2])
        await db_session.commit()
        await db_session.refresh(app1)
        await db_session.refresh(app2)

        # Bulk move to screening
        response = await client.post(
            "/api/vacancies/applications/bulk-move",
            json={
                "application_ids": [app1.id, app2.id],
                "stage": "screening"
            },
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert all(app["stage"] == "screening" for app in data)


# ============================================================================
# STATS TESTS
# ============================================================================

class TestVacancyStats:
    """Tests for vacancy statistics."""

    async def test_get_vacancies_stats(
        self,
        client: AsyncClient,
        admin_user: User,
        vacancy: Vacancy,
        application: VacancyApplication,
        org_owner
    ):
        """Test getting vacancy overview statistics."""
        token = create_access_token(data={"sub": str(admin_user.id)})
        response = await client.get(
            "/api/vacancies/stats/overview",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert "vacancies_by_status" in data
        assert "applications_by_stage" in data
        assert "applications_this_week" in data


# ============================================================================
# AUTHORIZATION TESTS
# ============================================================================

class TestVacancyAuthorization:
    """Tests for vacancy authorization."""

    async def test_unauthorized_access(self, client: AsyncClient):
        """Test that unauthorized requests are rejected."""
        response = await client.get("/api/vacancies/")
        assert response.status_code == 401

    async def test_vacancy_with_stage_counts(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        admin_user: User,
        vacancy: Vacancy,
        candidate_for_vacancy: Entity,
        second_candidate: Entity,
        org_owner
    ):
        """Test that vacancy response includes accurate stage counts."""
        token = create_access_token(data={"sub": str(admin_user.id)})

        # Create applications at different stages
        app1 = VacancyApplication(
            vacancy_id=vacancy.id,
            entity_id=candidate_for_vacancy.id,
            stage=ApplicationStage.applied,
            created_by=admin_user.id
        )
        app2 = VacancyApplication(
            vacancy_id=vacancy.id,
            entity_id=second_candidate.id,
            stage=ApplicationStage.interview,
            created_by=admin_user.id
        )
        db_session.add_all([app1, app2])
        await db_session.commit()

        response = await client.get(
            f"/api/vacancies/{vacancy.id}",
            headers=auth_headers(token)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["applications_count"] == 2
        assert data["stage_counts"]["applied"] == 1
        assert data["stage_counts"]["interview"] == 1
