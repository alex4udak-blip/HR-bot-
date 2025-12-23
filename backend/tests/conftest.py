"""
Pytest configuration and fixtures for HR-Bot backend tests.
"""
import asyncio
import pytest
import pytest_asyncio
from typing import AsyncGenerator, Generator
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

# Import models and app
import sys
sys.path.insert(0, '/home/user/HR-bot-/backend')

from api.models.database import Base, User, Organization, OrgMember, Department, DepartmentMember
from api.models.database import Entity, Chat, Message, CallRecording, SharedAccess
from api.models.database import UserRole, OrgRole, DeptRole, AccessLevel, ResourceType
from api.models.database import EntityType, EntityStatus, ChatType, CallStatus, CallSource
from api.database import get_db
from api.services.auth import get_password_hash, create_access_token
from main import app


# ============================================================================
# DATABASE FIXTURES
# ============================================================================

@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """Create an instance of the default event loop for each test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def async_engine():
    """Create async SQLite engine for testing."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(async_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create async database session for testing."""
    async_session = async_sessionmaker(
        async_engine,
        class_=AsyncSession,
        expire_on_commit=False
    )

    async with async_session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create async test client with database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ============================================================================
# USER FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def superadmin_user(db_session: AsyncSession) -> User:
    """Create a superadmin user."""
    user = User(
        email="superadmin@test.com",
        password_hash=get_password_hash("superadmin123"),
        name="Super Admin",
        role=UserRole.SUPERADMIN,
        is_active=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """Create an admin user."""
    user = User(
        email="admin@test.com",
        password_hash=get_password_hash("admin123"),
        name="Admin User",
        role=UserRole.ADMIN,
        is_active=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def regular_user(db_session: AsyncSession) -> User:
    """Create a regular user."""
    user = User(
        email="user@test.com",
        password_hash=get_password_hash("user123"),
        name="Regular User",
        role=UserRole.USER,
        is_active=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def second_user(db_session: AsyncSession) -> User:
    """Create a second regular user for sharing tests."""
    user = User(
        email="user2@test.com",
        password_hash=get_password_hash("user123"),
        name="Second User",
        role=UserRole.USER,
        is_active=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


# ============================================================================
# ORGANIZATION FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def organization(db_session: AsyncSession) -> Organization:
    """Create a test organization."""
    org = Organization(
        name="Test Organization",
        created_at=datetime.utcnow()
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest_asyncio.fixture
async def second_organization(db_session: AsyncSession) -> Organization:
    """Create a second test organization for cross-org tests."""
    org = Organization(
        name="Second Organization",
        created_at=datetime.utcnow()
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest_asyncio.fixture
async def org_owner(db_session: AsyncSession, organization: Organization, admin_user: User) -> OrgMember:
    """Create an organization owner membership."""
    member = OrgMember(
        org_id=organization.id,
        user_id=admin_user.id,
        role=OrgRole.owner,
        joined_at=datetime.utcnow()
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


@pytest_asyncio.fixture
async def org_admin(db_session: AsyncSession, organization: Organization, regular_user: User) -> OrgMember:
    """Create an organization admin membership."""
    member = OrgMember(
        org_id=organization.id,
        user_id=regular_user.id,
        role=OrgRole.admin,
        joined_at=datetime.utcnow()
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


@pytest_asyncio.fixture
async def org_member(db_session: AsyncSession, organization: Organization, second_user: User) -> OrgMember:
    """Create a regular organization member."""
    member = OrgMember(
        org_id=organization.id,
        user_id=second_user.id,
        role=OrgRole.member,
        joined_at=datetime.utcnow()
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


# ============================================================================
# DEPARTMENT FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def department(db_session: AsyncSession, organization: Organization) -> Department:
    """Create a test department."""
    dept = Department(
        name="Test Department",
        org_id=organization.id,
        members_count=0,
        entities_count=0,
        children_count=0,
        created_at=datetime.utcnow()
    )
    db_session.add(dept)
    await db_session.commit()
    await db_session.refresh(dept)
    return dept


@pytest_asyncio.fixture
async def second_department(db_session: AsyncSession, organization: Organization) -> Department:
    """Create a second test department."""
    dept = Department(
        name="Second Department",
        org_id=organization.id,
        members_count=0,
        entities_count=0,
        children_count=0,
        created_at=datetime.utcnow()
    )
    db_session.add(dept)
    await db_session.commit()
    await db_session.refresh(dept)
    return dept


@pytest_asyncio.fixture
async def dept_lead(db_session: AsyncSession, department: Department, admin_user: User) -> DepartmentMember:
    """Create a department lead membership."""
    member = DepartmentMember(
        department_id=department.id,
        user_id=admin_user.id,
        role=DeptRole.lead,
        added_at=datetime.utcnow()
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


@pytest_asyncio.fixture
async def dept_member(db_session: AsyncSession, department: Department, regular_user: User) -> DepartmentMember:
    """Create a department member."""
    member = DepartmentMember(
        department_id=department.id,
        user_id=regular_user.id,
        role=DeptRole.member,
        added_at=datetime.utcnow()
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


# ============================================================================
# ENTITY FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def entity(db_session: AsyncSession, organization: Organization, department: Department, admin_user: User) -> Entity:
    """Create a test entity (contact)."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=admin_user.id,
        name="Test Contact",
        email="contact@test.com",
        phone="+1234567890",
        type=EntityType.candidate,
        status=EntityStatus.active,
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


@pytest_asyncio.fixture
async def second_entity(db_session: AsyncSession, organization: Organization, department: Department, regular_user: User) -> Entity:
    """Create a second test entity owned by regular user."""
    entity = Entity(
        org_id=organization.id,
        department_id=department.id,
        created_by=regular_user.id,
        name="Second Contact",
        email="contact2@test.com",
        type=EntityType.client,
        status=EntityStatus.active,
        created_at=datetime.utcnow()
    )
    db_session.add(entity)
    await db_session.commit()
    await db_session.refresh(entity)
    return entity


# ============================================================================
# CHAT FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def chat(db_session: AsyncSession, organization: Organization, admin_user: User) -> Chat:
    """Create a test chat."""
    chat = Chat(
        org_id=organization.id,
        owner_id=admin_user.id,
        telegram_chat_id=123456789,
        chat_type=ChatType.hr,
        is_active=True,
        created_at=datetime.utcnow()
    )
    db_session.add(chat)
    await db_session.commit()
    await db_session.refresh(chat)
    return chat


@pytest_asyncio.fixture
async def second_chat(db_session: AsyncSession, organization: Organization, regular_user: User) -> Chat:
    """Create a second test chat owned by regular user."""
    chat = Chat(
        org_id=organization.id,
        owner_id=regular_user.id,
        telegram_chat_id=987654321,
        chat_type=ChatType.sales,
        is_active=True,
        created_at=datetime.utcnow()
    )
    db_session.add(chat)
    await db_session.commit()
    await db_session.refresh(chat)
    return chat


# ============================================================================
# CALL FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def call_recording(db_session: AsyncSession, organization: Organization, admin_user: User) -> CallRecording:
    """Create a test call recording."""
    call = CallRecording(
        org_id=organization.id,
        owner_id=admin_user.id,
        title="Test Call",
        source_type=CallSource.upload,
        status=CallStatus.done,
        duration=300,
        created_at=datetime.utcnow()
    )
    db_session.add(call)
    await db_session.commit()
    await db_session.refresh(call)
    return call


@pytest_asyncio.fixture
async def second_call(db_session: AsyncSession, organization: Organization, regular_user: User) -> CallRecording:
    """Create a second test call owned by regular user."""
    call = CallRecording(
        org_id=organization.id,
        owner_id=regular_user.id,
        title="Second Call",
        source_type=CallSource.meet,
        status=CallStatus.done,
        duration=600,
        created_at=datetime.utcnow()
    )
    db_session.add(call)
    await db_session.commit()
    await db_session.refresh(call)
    return call


# ============================================================================
# SHARING FIXTURES
# ============================================================================

@pytest_asyncio.fixture
async def entity_share_view(
    db_session: AsyncSession,
    entity: Entity,
    admin_user: User,
    second_user: User
) -> SharedAccess:
    """Create a view-only share for entity."""
    share = SharedAccess(
        resource_type=ResourceType.entity,
        resource_id=entity.id,
        shared_by_id=admin_user.id,
        shared_with_id=second_user.id,
        access_level=AccessLevel.view,
        created_at=datetime.utcnow()
    )
    db_session.add(share)
    await db_session.commit()
    await db_session.refresh(share)
    return share


@pytest_asyncio.fixture
async def entity_share_edit(
    db_session: AsyncSession,
    entity: Entity,
    admin_user: User,
    second_user: User
) -> SharedAccess:
    """Create an edit share for entity."""
    share = SharedAccess(
        resource_type=ResourceType.entity,
        resource_id=entity.id,
        shared_by_id=admin_user.id,
        shared_with_id=second_user.id,
        access_level=AccessLevel.edit,
        created_at=datetime.utcnow()
    )
    db_session.add(share)
    await db_session.commit()
    await db_session.refresh(share)
    return share


@pytest_asyncio.fixture
async def chat_share_view(
    db_session: AsyncSession,
    chat: Chat,
    admin_user: User,
    second_user: User
) -> SharedAccess:
    """Create a view-only share for chat."""
    share = SharedAccess(
        resource_type=ResourceType.chat,
        resource_id=chat.id,
        shared_by_id=admin_user.id,
        shared_with_id=second_user.id,
        access_level=AccessLevel.view,
        created_at=datetime.utcnow()
    )
    db_session.add(share)
    await db_session.commit()
    await db_session.refresh(share)
    return share


@pytest_asyncio.fixture
async def call_share_view(
    db_session: AsyncSession,
    call_recording: CallRecording,
    admin_user: User,
    second_user: User
) -> SharedAccess:
    """Create a view-only share for call."""
    share = SharedAccess(
        resource_type=ResourceType.call,
        resource_id=call_recording.id,
        shared_by_id=admin_user.id,
        shared_with_id=second_user.id,
        access_level=AccessLevel.view,
        created_at=datetime.utcnow()
    )
    db_session.add(share)
    await db_session.commit()
    await db_session.refresh(share)
    return share


@pytest_asyncio.fixture
async def expired_share(
    db_session: AsyncSession,
    entity: Entity,
    admin_user: User,
    second_user: User
) -> SharedAccess:
    """Create an expired share."""
    share = SharedAccess(
        resource_type=ResourceType.entity,
        resource_id=entity.id,
        shared_by_id=admin_user.id,
        shared_with_id=second_user.id,
        access_level=AccessLevel.edit,
        expires_at=datetime.utcnow() - timedelta(days=1),  # Expired
        created_at=datetime.utcnow() - timedelta(days=2)
    )
    db_session.add(share)
    await db_session.commit()
    await db_session.refresh(share)
    return share


# ============================================================================
# AUTH TOKEN FIXTURES
# ============================================================================

@pytest.fixture
def superadmin_token(superadmin_user: User) -> str:
    """Generate JWT token for superadmin."""
    return create_access_token(data={"sub": superadmin_user.email, "user_id": superadmin_user.id})


@pytest.fixture
def admin_token(admin_user: User) -> str:
    """Generate JWT token for admin."""
    return create_access_token(data={"sub": admin_user.email, "user_id": admin_user.id})


@pytest.fixture
def user_token(regular_user: User) -> str:
    """Generate JWT token for regular user."""
    return create_access_token(data={"sub": regular_user.email, "user_id": regular_user.id})


@pytest.fixture
def second_user_token(second_user: User) -> str:
    """Generate JWT token for second user."""
    return create_access_token(data={"sub": second_user.email, "user_id": second_user.id})


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def auth_headers(token: str) -> dict:
    """Create authorization headers with token."""
    return {"Authorization": f"Bearer {token}"}


# Make helper available to tests
@pytest.fixture
def get_auth_headers():
    """Return auth_headers function for use in tests."""
    return auth_headers
