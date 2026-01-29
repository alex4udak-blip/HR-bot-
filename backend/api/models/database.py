from datetime import datetime, time
from typing import Optional
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Enum as SQLEnum,
    ForeignKey, Index, Integer, String, Text, JSON, Time, func, text, UniqueConstraint
)
from sqlalchemy.orm import DeclarativeBase, relationship
from pgvector.sqlalchemy import Vector
import enum


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    # Names must be lowercase to match PostgreSQL enum values
    superadmin = "superadmin"  # Platform-wide admin (can access all orgs)
    admin = "admin"            # Legacy: kept for backwards compatibility
    sub_admin = "sub_admin"    # Legacy: kept for backwards compatibility
    member = "member"          # Regular user (access determined by OrgRole and DeptRole)


class ChatType(str, enum.Enum):
    # Names must be lowercase to match PostgreSQL enum values
    work = "work"                # General work chat
    hr = "hr"                    # Candidate evaluation
    project = "project"          # Team project chat
    client = "client"            # Client communication
    contractor = "contractor"    # External contractor
    sales = "sales"              # Sales negotiations
    support = "support"          # Customer support
    custom = "custom"            # Custom user-defined type


class EntityType(str, enum.Enum):
    candidate = "candidate"
    client = "client"
    contractor = "contractor"
    lead = "lead"
    partner = "partner"
    custom = "custom"


class EntityStatus(str, enum.Enum):
    """Status/stage for entities (especially candidates)

    HR Pipeline stages: new → screening → practice → tech_practice → is_interview → offer → hired/rejected
    """
    # HR Pipeline stages (match ApplicationStage for consistency)
    new = "new"                   # Новый - just added
    screening = "screening"       # Скрининг - initial review
    practice = "practice"         # Практика - practical task/test
    tech_practice = "tech_practice"  # Тех-практика - technical practice
    is_interview = "is_interview" # ИС - final interview
    offer = "offer"               # Оффер - offer extended
    hired = "hired"               # Принят - accepted and hired
    rejected = "rejected"         # Отказ - rejected

    # General entity statuses (for clients, partners, etc.)
    interview = "interview"       # Legacy: interview stage
    active = "active"
    paused = "paused"
    churned = "churned"
    converted = "converted"
    ended = "ended"
    negotiation = "negotiation"


class VacancyStatus(str, enum.Enum):
    """Status of a job vacancy"""
    draft = "draft"          # Not yet published
    open = "open"            # Actively hiring
    paused = "paused"        # Temporarily paused
    closed = "closed"        # Position filled
    cancelled = "cancelled"  # Cancelled/no longer needed


class ApplicationStage(str, enum.Enum):
    """Pipeline stage for candidate application

    HR Pipeline (using existing PostgreSQL enum values with HR labels):
    applied (Новый) → screening (Скрининг) → phone_screen (Практика) →
    interview (Тех-практика) → assessment (ИС) → offer (Оффер) → hired/rejected

    Note: We use the existing PostgreSQL enum values but display HR-friendly labels in the UI.
    """
    # HR Pipeline stages (these exist in PostgreSQL enum)
    applied = "applied"           # Новый - just added to vacancy (displayed as "Новый")
    screening = "screening"       # Скрининг - initial review
    phone_screen = "phone_screen" # Практика - practical task/test (displayed as "Практика")
    interview = "interview"       # Тех-практика - technical interview (displayed as "Тех-практика")
    assessment = "assessment"     # ИС - final interview (displayed as "ИС")
    offer = "offer"               # Оффер - offer extended
    hired = "hired"               # Принят - accepted and hired
    rejected = "rejected"         # Отказ - rejected at any stage
    withdrawn = "withdrawn"       # Отозван - candidate withdrew

    # Deprecated values (these do NOT exist in PostgreSQL enum and will cause errors)
    # DO NOT USE these - they were added but never migrated to the database:
    # new = "new"
    # practice = "practice"
    # tech_practice = "tech_practice"
    # is_interview = "is_interview"

# Sync mappings between EntityStatus and ApplicationStage
STATUS_SYNC_MAP = {
    EntityStatus.new: ApplicationStage.applied,
    EntityStatus.screening: ApplicationStage.screening,
    EntityStatus.practice: ApplicationStage.phone_screen,
    EntityStatus.tech_practice: ApplicationStage.interview,
    EntityStatus.is_interview: ApplicationStage.assessment,
    EntityStatus.offer: ApplicationStage.offer,
    EntityStatus.hired: ApplicationStage.hired,
    EntityStatus.rejected: ApplicationStage.rejected,
}

STAGE_SYNC_MAP = {v: k for k, v in STATUS_SYNC_MAP.items()}

class EntityFileType(str, enum.Enum):
    """Type of file attached to an entity"""
    resume = "resume"
    cover_letter = "cover_letter"
    test_assignment = "test_assignment"
    certificate = "certificate"
    portfolio = "portfolio"
    other = "other"


class CallSource(str, enum.Enum):
    meet = "meet"
    zoom = "zoom"
    teams = "teams"
    upload = "upload"
    telegram = "telegram"
    google_doc = "google_doc"  # Transcript from Google Docs
    google_drive = "google_drive"  # Media file from Google Drive
    direct_url = "direct_url"  # Direct link to audio/video
    fireflies = "fireflies"  # Fireflies.ai transcript


class CallStatus(str, enum.Enum):
    pending = "pending"
    connecting = "connecting"
    recording = "recording"
    processing = "processing"
    transcribing = "transcribing"
    analyzing = "analyzing"
    done = "done"
    failed = "failed"


class ReportType(str, enum.Enum):
    daily_hr = "daily_hr"
    weekly_summary = "weekly_summary"
    daily_calls = "daily_calls"
    weekly_pipeline = "weekly_pipeline"


class DeliveryMethod(str, enum.Enum):
    telegram = "telegram"
    email = "email"


class OrgRole(str, enum.Enum):
    owner = "owner"      # Full access, can delete org
    admin = "admin"      # Can manage members, full data access
    member = "member"    # Read/write own data only


class DeptRole(str, enum.Enum):
    lead = "lead"           # Department lead - sees all dept data, full management
    sub_admin = "sub_admin" # Sub-admin - sees all dept data, limited management
    member = "member"       # Regular member - sees own data + shared


class SubscriptionPlan(str, enum.Enum):
    free = "free"
    pro = "pro"
    enterprise = "enterprise"


class Organization(Base):
    """Organization for multi-tenancy"""
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False, index=True)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    subscription_plan = Column(SQLEnum(SubscriptionPlan), default=SubscriptionPlan.free)
    settings = Column(JSON, default=dict)  # {max_users, max_chats, features, etc}
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    members = relationship("OrgMember", back_populates="organization", cascade="all, delete-orphan")
    departments = relationship("Department", back_populates="organization", cascade="all, delete-orphan")
    entities = relationship("Entity", back_populates="organization", cascade="all, delete-orphan")
    chats = relationship("Chat", back_populates="organization", cascade="all, delete-orphan")
    calls = relationship("CallRecording", back_populates="organization", cascade="all, delete-orphan")


class OrgMember(Base):
    """Organization membership - links users to organizations"""
    __tablename__ = "org_members"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(SQLEnum(OrgRole), default=OrgRole.member)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'org_id', name='uq_org_member_user_org'),
    )

    organization = relationship("Organization", back_populates="members")
    user = relationship("User", foreign_keys=[user_id], back_populates="org_memberships")
    inviter = relationship("User", foreign_keys=[invited_by])


class Department(Base):
    """Department within an organization"""
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    color = Column(String(20), nullable=True)  # For UI display (e.g., "#3B82F6")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    organization = relationship("Organization", back_populates="departments")
    parent = relationship("Department", remote_side=[id], back_populates="children")
    children = relationship("Department", back_populates="parent", cascade="all, delete-orphan")
    members = relationship("DepartmentMember", back_populates="department", cascade="all, delete-orphan")
    entities = relationship("Entity", back_populates="department")


class DepartmentMember(Base):
    """Department membership - links users to departments"""
    __tablename__ = "department_members"

    id = Column(Integer, primary_key=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(SQLEnum(DeptRole), default=DeptRole.member)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'department_id', name='uq_dept_member_user_dept'),
    )

    department = relationship("Department", back_populates="members")
    user = relationship("User", back_populates="department_memberships")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False, index=True)
    role = Column(SQLEnum(UserRole), default=UserRole.member)
    telegram_id = Column(BigInteger, unique=True, nullable=True, index=True)
    telegram_username = Column(String(255), nullable=True)
    # Additional contact identifiers for speaker matching
    additional_emails = Column(JSON, default=list)  # List of additional email addresses
    additional_telegram_usernames = Column(JSON, default=list)  # List of additional telegram usernames
    is_active = Column(Boolean, default=True)
    token_version = Column(Integer, default=0, nullable=False)  # Increment on password change
    # Brute force protection
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    # Password reset by admin
    must_change_password = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    chats = relationship("Chat", back_populates="owner")
    criteria_presets = relationship("CriteriaPreset", back_populates="created_by_user")
    ai_conversations = relationship("AIConversation", back_populates="user")
    analyses = relationship("AnalysisHistory", back_populates="user")
    org_memberships = relationship("OrgMember", foreign_keys="OrgMember.user_id", back_populates="user", cascade="all, delete-orphan")
    department_memberships = relationship("DepartmentMember", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    # Additional back_populates relationships
    owned_calls = relationship("CallRecording", back_populates="owner")
    report_subscriptions = relationship("ReportSubscription", back_populates="user", cascade="all, delete-orphan")
    entity_ai_conversations = relationship("EntityAIConversation", back_populates="user", cascade="all, delete-orphan")
    entity_analyses = relationship("EntityAnalysis", back_populates="user")
    uploaded_files = relationship("EntityFile", back_populates="uploader")


class Chat(Base):
    __tablename__ = "chats"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    custom_name = Column(String(255), nullable=True)
    chat_type = Column(SQLEnum(ChatType), default=ChatType.work, index=True)
    custom_type_name = Column(String(255), nullable=True)  # For CUSTOM type
    custom_type_description = Column(Text, nullable=True)  # For CUSTOM type
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    last_activity = Column(DateTime, default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True, index=True)  # Soft delete timestamp

    __table_args__ = (
        # Composite index for filtering non-deleted chats by org (common list query)
        Index('ix_chat_org_deleted', 'org_id', 'deleted_at'),
        # Composite index for filtering by owner and activity
        Index('ix_chat_owner_activity', 'owner_id', 'last_activity'),
    )

    organization = relationship("Organization", back_populates="chats")
    owner = relationship("User", back_populates="chats")
    entity = relationship("Entity", back_populates="chats")
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")
    criteria = relationship("ChatCriteria", back_populates="chat", uselist=False, cascade="all, delete-orphan")
    ai_conversations = relationship("AIConversation", back_populates="chat", cascade="all, delete-orphan")
    analyses = relationship("AnalysisHistory", back_populates="chat", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    telegram_message_id = Column(BigInteger, nullable=True)
    telegram_user_id = Column(BigInteger, nullable=False, index=True)
    username = Column(String(255), nullable=True)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    content = Column(Text, nullable=False)
    content_type = Column(String(50), nullable=False, index=True)  # text, voice, video_note, document, photo, etc
    file_id = Column(String(255), nullable=True)  # Telegram Bot API file_id
    file_path = Column(String(512), nullable=True, index=True)  # Local file path for imported media
    file_name = Column(String(255), nullable=True)
    # Document parsing metadata
    document_metadata = Column(JSON, nullable=True)  # {file_type, pages_count, sheets, etc}
    parse_status = Column(String(20), nullable=True)  # parsed, partial, failed
    parse_error = Column(Text, nullable=True)
    is_imported = Column(Boolean, default=False)  # True if imported from file (not from bot)
    timestamp = Column(DateTime, default=func.now())

    __table_args__ = (
        # Composite index for message filtering by chat and user (common query pattern)
        Index('ix_message_chat_telegram_user', 'chat_id', 'telegram_user_id'),
        # Composite index for sorting messages by timestamp (common list query)
        Index('ix_message_chat_timestamp', 'chat_id', 'timestamp'),
    )

    chat = relationship("Chat", back_populates="messages")


class CriteriaPreset(Base):
    __tablename__ = "criteria_presets"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    criteria = Column(JSON, nullable=False)  # [{name, weight, description, category}]
    category = Column(String(100), nullable=True)  # basic, red_flags, green_flags, position
    chat_type = Column(SQLEnum(ChatType), nullable=True, index=True)  # Type-specific presets for chats
    entity_type = Column(SQLEnum(EntityType), nullable=True, index=True)  # Type-specific presets for entities
    is_global = Column(Boolean, default=False)  # True = visible to all
    is_default = Column(Boolean, default=False)  # True = default for chat/entity type
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=func.now())

    created_by_user = relationship("User", back_populates="criteria_presets")


class ChatCriteria(Base):
    __tablename__ = "chat_criteria"

    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), unique=True, nullable=False)
    criteria = Column(JSON, nullable=False)  # [{name, weight, description}]
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    chat = relationship("Chat", back_populates="criteria")


class EntityCriteria(Base):
    __tablename__ = "entity_criteria"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), unique=True, nullable=False)
    criteria = Column(JSON, nullable=False)  # [{name, weight, description, category}]
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    entity = relationship("Entity", back_populates="criteria")


class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    messages = Column(JSON, nullable=False, default=list)  # [{role, content, timestamp}]
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    chat = relationship("Chat", back_populates="ai_conversations")
    user = relationship("User", back_populates="ai_conversations")


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"

    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)
    result = Column(Text, nullable=False)
    report_type = Column(String(50), nullable=True)  # full, quick, red_flags, etc
    report_format = Column(String(20), nullable=True)  # pdf, docx, markdown
    criteria_used = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())

    chat = relationship("Chat", back_populates="analyses")
    user = relationship("User", back_populates="analyses")
    entity = relationship("Entity", back_populates="analyses")


class Entity(Base):
    __tablename__ = "entities"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    type = Column(SQLEnum(EntityType), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    status = Column(SQLEnum(EntityStatus), default=EntityStatus.new, index=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True, index=True)
    telegram_user_id = Column(BigInteger, nullable=True, index=True)
    company = Column(String(255), nullable=True)
    position = Column(String(255), nullable=True)
    tags = Column(JSON, default=list)
    extra_data = Column(JSON, default=dict)  # renamed from 'metadata' (reserved by SQLAlchemy)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Multiple identifiers support
    telegram_usernames = Column(JSON, default=list)  # List of telegram usernames (normalized, lowercase, without @)
    emails = Column(JSON, default=list)  # List of additional emails
    phones = Column(JSON, default=list)  # List of additional phone numbers

    # Transfer tracking fields
    is_transferred = Column(Boolean, default=False, index=True)
    transferred_to_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    transferred_at = Column(DateTime, nullable=True)

    organization = relationship("Organization", back_populates="entities")
    department = relationship("Department", back_populates="entities")
    creator = relationship("User", foreign_keys=[created_by])
    transferred_to = relationship("User", foreign_keys=[transferred_to_id])
    chats = relationship("Chat", back_populates="entity")
    calls = relationship("CallRecording", back_populates="entity")
    transfers = relationship("EntityTransfer", back_populates="entity", primaryjoin="Entity.id==EntityTransfer.entity_id")
    analyses = relationship("AnalysisHistory", back_populates="entity")
    ai_conversations = relationship("EntityAIConversation", back_populates="entity", cascade="all, delete-orphan")
    ai_analyses = relationship("EntityAnalysis", back_populates="entity", cascade="all, delete-orphan")
    criteria = relationship("EntityCriteria", back_populates="entity", uselist=False, cascade="all, delete-orphan")
    files = relationship("EntityFile", back_populates="entity", cascade="all, delete-orphan")

    # Expected salary for candidates
    expected_salary_min = Column(Integer, nullable=True)
    expected_salary_max = Column(Integer, nullable=True)
    expected_salary_currency = Column(String(10), default='RUB')

    # AI Long-term Memory
    # Auto-updated summary of all interactions with this entity
    ai_summary = Column(Text, nullable=True)
    ai_summary_updated_at = Column(DateTime, nullable=True)
    # Key events/milestones extracted from conversations
    # Format: [{"date": "2024-01-15", "event": "hired", "details": "Hired to development team"}]
    key_events = Column(JSON, default=list)

    # Vector embedding for similarity search (OpenAI text-embedding-3-small: 1536 dimensions)
    embedding = Column(Vector(1536), nullable=True)
    embedding_updated_at = Column(DateTime, nullable=True)

    # Optimistic locking version field
    # Incremented on each update to detect concurrent modifications
    version = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        # Composite indexes for common query patterns
        Index('ix_entity_org_status', 'org_id', 'status'),  # Filter by org + status
        Index('ix_entity_org_created_by', 'org_id', 'created_by'),  # Filter by org + creator
        Index('ix_entity_org_type', 'org_id', 'type'),  # Filter by org + entity type
    )


class EntityTransfer(Base):
    __tablename__ = "entity_transfers"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    from_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    to_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    from_department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    to_department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    # For cancel functionality
    copy_entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    cancel_deadline = Column(DateTime, nullable=True)  # Usually created_at + 1 hour

    entity = relationship("Entity", back_populates="transfers", foreign_keys=[entity_id])
    copy_entity = relationship("Entity", foreign_keys=[copy_entity_id])
    from_user = relationship("User", foreign_keys=[from_user_id])
    to_user = relationship("User", foreign_keys=[to_user_id])
    from_department = relationship("Department", foreign_keys=[from_department_id])
    to_department = relationship("Department", foreign_keys=[to_department_id])


class CallRecording(Base):
    __tablename__ = "call_recordings"
    __table_args__ = (
        # Partial unique index to prevent duplicate source_url imports per organization
        # Only applies when source_url is NOT NULL (direct uploads don't have source_url)
        Index('ix_call_recordings_org_source_url', 'org_id', 'source_url', unique=True,
              postgresql_where=text("source_url IS NOT NULL")),
    )

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(255), nullable=True)  # Custom name for the call
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    source_type = Column(SQLEnum(CallSource), nullable=False)
    source_url = Column(String(500), nullable=True)
    bot_name = Column(String(100), default="HR Recorder")
    status = Column(SQLEnum(CallStatus), default=CallStatus.pending, index=True)
    progress = Column(Integer, default=0)  # 0-100 progress percentage
    progress_stage = Column(String(100), nullable=True)  # Current processing stage description
    duration_seconds = Column(Integer, nullable=True)
    audio_file_path = Column(String(500), nullable=True)
    fireflies_transcript_id = Column(String(100), nullable=True, index=True)  # Fireflies transcript ID
    transcript = Column(Text, nullable=True)
    speakers = Column(JSON, nullable=True)  # [{speaker: "Speaker 1", start: 0.0, end: 5.2, text: "..."}, ...]
    summary = Column(Text, nullable=True)
    action_items = Column(JSON, nullable=True)
    key_points = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)

    # Smart context fields for AI analysis
    participant_roles = Column(JSON, nullable=True)  # {evaluator: {user_id, name}, target: {entity_id, name}, others: [...]}
    speaker_stats = Column(JSON, nullable=True)  # {"Speaker 1": {total_seconds: 900, role: "hr", user_id: 5}, ...}
    segments = Column(JSON, nullable=True)  # [{start, end, summary, key_quotes: [], speaker_breakdown: {}}]
    created_at = Column(DateTime, default=func.now())
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    processed_at = Column(DateTime, nullable=True)

    organization = relationship("Organization", back_populates="calls")
    entity = relationship("Entity", back_populates="calls")
    owner = relationship("User", back_populates="owned_calls")


class ReportSubscription(Base):
    __tablename__ = "report_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    report_type = Column(SQLEnum(ReportType), nullable=False)
    delivery_method = Column(SQLEnum(DeliveryMethod), nullable=False)
    delivery_time = Column(Time, default=time(18, 0))
    filters = Column(JSON, default=dict)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())

    user = relationship("User", back_populates="report_subscriptions")


class EntityAIConversation(Base):
    """AI conversation history for Entity (contact card)"""
    __tablename__ = "entity_ai_conversations"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    messages = Column(JSON, default=list)  # [{role, content, timestamp}]
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    entity = relationship("Entity", back_populates="ai_conversations")
    user = relationship("User", back_populates="entity_ai_conversations")


class EntityAnalysis(Base):
    """Saved AI analysis results for Entity"""
    __tablename__ = "entity_analyses"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    analysis_type = Column(String(50))  # full_analysis, red_flags, prediction, etc
    result = Column(Text, nullable=False)
    scores = Column(JSON, default=dict)  # {success_rate: 75, risk_level: "medium"}
    created_at = Column(DateTime, default=func.now())

    entity = relationship("Entity", back_populates="ai_analyses")
    user = relationship("User", back_populates="entity_analyses")


class ResourceType(str, enum.Enum):
    """Type of resource that can be shared"""
    chat = "chat"
    entity = "entity"
    call = "call"
    vacancy = "vacancy"  # Job vacancy


class AccessLevel(str, enum.Enum):
    """Level of access granted"""
    view = "view"      # Can only view
    edit = "edit"      # Can view and edit
    full = "full"      # Full access (can share with others)


class SharedAccess(Base):
    """Shared access to resources (chats, entities, calls)"""
    __tablename__ = "shared_access"

    id = Column(Integer, primary_key=True)
    resource_type = Column(SQLEnum(ResourceType), nullable=False, index=True)
    resource_id = Column(Integer, nullable=False, index=True)  # ID of chat/entity/call/vacancy
    # Proper foreign keys for cascade delete - only one should be set based on resource_type
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), nullable=True, index=True)
    call_id = Column(Integer, ForeignKey("call_recordings.id", ondelete="CASCADE"), nullable=True, index=True)
    vacancy_id = Column(Integer, ForeignKey("vacancies.id", ondelete="CASCADE"), nullable=True, index=True)
    shared_by_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    shared_with_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    access_level = Column(SQLEnum(AccessLevel), default=AccessLevel.view)
    note = Column(String(500), nullable=True)  # Optional note about sharing
    expires_at = Column(DateTime, nullable=True)  # Optional expiration
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint('resource_type', 'resource_id', 'shared_with_id', 'shared_by_id', name='uq_shared_access_resource_user'),
        # Composite index for fast permission lookups
        Index('ix_shared_access_user_resource', 'shared_with_id', 'resource_type', 'resource_id'),
    )

    shared_by = relationship("User", foreign_keys=[shared_by_id])
    shared_with = relationship("User", foreign_keys=[shared_with_id])
    entity = relationship("Entity", foreign_keys=[entity_id])
    chat = relationship("Chat", foreign_keys=[chat_id])
    call = relationship("CallRecording", foreign_keys=[call_id])
    vacancy = relationship("Vacancy", foreign_keys=[vacancy_id])


class Invitation(Base):
    """User invitation for onboarding new members"""
    __tablename__ = "invitations"

    id = Column(Integer, primary_key=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=True)  # Pre-filled email
    name = Column(String(255), nullable=True)  # Pre-filled name
    org_role = Column(SQLEnum(OrgRole), default=OrgRole.member)
    department_ids = Column(JSON, default=list)  # [{"id": 1, "role": "member"}, ...]
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime, nullable=True)  # When invitation expires
    used_at = Column(DateTime, nullable=True)  # When invitation was used
    used_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=func.now())

    organization = relationship("Organization")
    invited_by = relationship("User", foreign_keys=[invited_by_id])
    used_by = relationship("User", foreign_keys=[used_by_id])


class ImpersonationLog(Base):
    """Audit log for user impersonation sessions"""
    __tablename__ = "impersonation_logs"

    id = Column(Integer, primary_key=True)
    superadmin_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    impersonated_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime, default=func.now(), nullable=False)
    ended_at = Column(DateTime, nullable=True)
    ip_address = Column(String(45), nullable=True)  # IPv6 support
    user_agent = Column(String(512), nullable=True)

    superadmin = relationship("User", foreign_keys=[superadmin_id])
    impersonated_user = relationship("User", foreign_keys=[impersonated_user_id])


class CustomRole(Base):
    """Custom roles created by superadmin"""
    __tablename__ = "custom_roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False)
    description = Column(String(255), nullable=True)
    base_role = Column(String(20), nullable=False)  # inherits from: owner, admin, sub_admin, member
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)  # null = system-wide
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=func.now())
    is_active = Column(Boolean, default=True)

    # Unique constraint: name unique per org (or globally if org_id is null)
    __table_args__ = (
        UniqueConstraint('name', 'org_id', name='uq_custom_role_name_org'),
    )

    # Relationships
    organization = relationship("Organization")
    creator = relationship("User", foreign_keys=[created_by])
    permission_overrides = relationship("RolePermissionOverride", back_populates="role", cascade="all, delete-orphan")
    user_assignments = relationship("UserCustomRole", back_populates="role", cascade="all, delete-orphan")
    audit_logs = relationship("PermissionAuditLog", back_populates="role", cascade="all, delete-orphan")


class RolePermissionOverride(Base):
    """Permission overrides for custom roles"""
    __tablename__ = "role_permission_overrides"

    id = Column(Integer, primary_key=True)
    role_id = Column(Integer, ForeignKey("custom_roles.id", ondelete="CASCADE"), nullable=False, index=True)
    permission = Column(String(50), nullable=False)  # e.g. "can_delete_users", "can_share_resources"
    allowed = Column(Boolean, nullable=False)

    __table_args__ = (
        UniqueConstraint('role_id', 'permission', name='uq_role_permission'),
    )

    # Relationships
    role = relationship("CustomRole", back_populates="permission_overrides")


class PermissionAuditLog(Base):
    """Audit log for permission changes"""
    __tablename__ = "permission_audit_logs"

    id = Column(Integer, primary_key=True)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    role_id = Column(Integer, ForeignKey("custom_roles.id", ondelete="CASCADE"), nullable=True)
    action = Column(String(20), nullable=False)  # 'create', 'update', 'delete'
    permission = Column(String(50), nullable=True)
    old_value = Column(Boolean, nullable=True)
    new_value = Column(Boolean, nullable=True)
    details = Column(JSON, nullable=True)  # additional context
    created_at = Column(DateTime, default=func.now(), index=True)

    # Relationships
    changed_by_user = relationship("User", foreign_keys=[changed_by])
    role = relationship("CustomRole", back_populates="audit_logs")


class UserCustomRole(Base):
    """Assignment of custom roles to users"""
    __tablename__ = "user_custom_roles"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("custom_roles.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'role_id', name='uq_user_custom_role'),
    )

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    role = relationship("CustomRole", back_populates="user_assignments")
    assigned_by_user = relationship("User", foreign_keys=[assigned_by])


class Vacancy(Base):
    """Job vacancy/position opening"""
    __tablename__ = "vacancies"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    requirements = Column(Text, nullable=True)  # Job requirements
    responsibilities = Column(Text, nullable=True)  # Key responsibilities
    salary_min = Column(Integer, nullable=True)  # Minimum salary
    salary_max = Column(Integer, nullable=True)  # Maximum salary
    salary_currency = Column(String(10), default="RUB")  # Currency code
    location = Column(String(255), nullable=True)  # Work location
    employment_type = Column(String(50), nullable=True)  # full-time, part-time, contract, remote
    experience_level = Column(String(50), nullable=True)  # junior, middle, senior, lead
    status = Column(SQLEnum(VacancyStatus), default=VacancyStatus.draft, index=True)
    priority = Column(Integer, default=0)  # 0=normal, 1=high, 2=urgent
    tags = Column(JSON, default=list)
    extra_data = Column(JSON, default=dict)  # Additional custom fields
    # Hiring team
    hiring_manager_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Dates
    published_at = Column(DateTime, nullable=True)
    closes_at = Column(DateTime, nullable=True)  # Application deadline
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Vector embedding for similarity search (OpenAI text-embedding-3-small: 1536 dimensions)
    embedding = Column(Vector(1536), nullable=True)
    embedding_updated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        # Composite index for filtering vacancies by org and status (common list query)
        Index('ix_vacancy_org_status', 'org_id', 'status'),
        # Composite index for filtering by department
        Index('ix_vacancy_dept_status', 'department_id', 'status'),
    )

    # Relationships
    organization = relationship("Organization")
    department = relationship("Department")
    hiring_manager = relationship("User", foreign_keys=[hiring_manager_id])
    creator = relationship("User", foreign_keys=[created_by])
    applications = relationship("VacancyApplication", back_populates="vacancy", cascade="all, delete-orphan")


class VacancyApplication(Base):
    """Candidate application to a vacancy (pipeline tracking)"""
    __tablename__ = "vacancy_applications"

    id = Column(Integer, primary_key=True)
    vacancy_id = Column(Integer, ForeignKey("vacancies.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    stage = Column(SQLEnum(ApplicationStage), default=ApplicationStage.applied, index=True)  # HR pipeline default (using 'applied' which exists in DB enum)
    stage_order = Column(Integer, default=0)  # For custom ordering within a stage
    rating = Column(Integer, nullable=True)  # 1-5 rating
    notes = Column(Text, nullable=True)  # Internal notes about candidate
    rejection_reason = Column(String(255), nullable=True)  # Reason for rejection
    source = Column(String(100), nullable=True)  # How candidate was sourced (linkedin, referral, etc)
    # Interview scheduling
    next_interview_at = Column(DateTime, nullable=True)
    # AI Compatibility Score (cached from AI scoring service)
    # Format: {overall_score, skills_match, experience_match, salary_match, culture_fit,
    #          strengths: [], weaknesses: [], recommendation, summary, key_factors: []}
    compatibility_score = Column(JSON, nullable=True)
    # Timestamps for analytics
    applied_at = Column(DateTime, default=func.now())
    last_stage_change_at = Column(DateTime, default=func.now())
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        # One application per candidate per vacancy
        UniqueConstraint('vacancy_id', 'entity_id', name='uq_vacancy_application'),
        # Index for kanban queries
        Index('ix_vacancy_application_stage', 'vacancy_id', 'stage'),
        # Composite index for entity lookup across vacancies
        Index('ix_vacancy_application_entity_vacancy', 'entity_id', 'vacancy_id'),
    )

    # Relationships
    vacancy = relationship("Vacancy", back_populates="applications")
    entity = relationship("Entity")
    created_by_user = relationship("User", foreign_keys=[created_by])


class DepartmentFeature(Base):
    """Controls which features are available to which departments.

    Features can be enabled/disabled at:
    - Organization level (department_id is NULL): applies to all departments as default
    - Department level (department_id is set): overrides org-wide setting for specific department

    Feature names include: 'vacancies', 'ai_analysis', 'calls', etc.
    Default features (chats, contacts, dashboard) are always available.
    """
    __tablename__ = "department_features"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True)
    # If department_id is NULL, it's an org-wide default
    feature_name = Column(String(50), nullable=False)  # "vacancies", "calls", "ai_analysis", etc
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('org_id', 'department_id', 'feature_name', name='uq_dept_feature'),
        Index('ix_department_features_lookup', 'org_id', 'feature_name'),
    )

    organization = relationship("Organization")
    department = relationship("Department")


class FeatureAuditLog(Base):
    """Audit log for feature access changes.

    Tracks who changed feature access settings, when, and what was changed.
    Used for compliance and debugging access issues.
    """
    __tablename__ = "feature_audit_logs"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    feature_name = Column(String(50), nullable=False)
    action = Column(String(20), nullable=False)  # 'enable', 'disable', 'delete'
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    # NULL department_id means org-wide change
    old_value = Column(Boolean, nullable=True)  # Previous enabled state
    new_value = Column(Boolean, nullable=True)  # New enabled state
    details = Column(JSON, nullable=True)  # Additional context (e.g., affected department names)
    created_at = Column(DateTime, default=func.now(), index=True)

    __table_args__ = (
        Index('ix_feature_audit_logs_lookup', 'org_id', 'feature_name', 'created_at'),
    )

    # Relationships
    organization = relationship("Organization")
    changed_by_user = relationship("User", foreign_keys=[changed_by])
    department = relationship("Department")


class EntityFile(Base):
    """Files attached to an entity (resumes, certificates, etc.)"""
    __tablename__ = "entity_files"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    file_type = Column(SQLEnum(EntityFileType), default=EntityFileType.other)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_size = Column(Integer, nullable=True)  # Size in bytes
    mime_type = Column(String(100), nullable=True)
    description = Column(String(500), nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        # Composite index for listing files by entity and type
        Index('ix_entity_file_entity_type', 'entity_id', 'file_type'),
    )

    # Relationships
    entity = relationship("Entity", back_populates="files")
    organization = relationship("Organization")
    uploader = relationship("User", back_populates="uploaded_files")


class RefreshToken(Base):
    """Refresh tokens for secure session management.

    Refresh tokens are stored with hashed values for security.
    They allow obtaining new access tokens without re-authentication.
    """
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)  # SHA-256 hash of token
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_name = Column(String(255), nullable=True)  # e.g., "Chrome on Windows", "Mobile App"
    ip_address = Column(String(45), nullable=True)  # IPv6 support
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    revoked_at = Column(DateTime, nullable=True)  # NULL = not revoked, set = revoked

    __table_args__ = (
        Index('ix_refresh_tokens_user_expires', 'user_id', 'expires_at'),
    )

    # Relationships
    user = relationship("User", back_populates="refresh_tokens")


class ParseJobStatus(str, enum.Enum):
    """Status of a background parsing job"""
    pending = "pending"        # Job created, waiting to be processed
    processing = "processing"  # Currently being parsed
    completed = "completed"    # Successfully parsed and entity created
    failed = "failed"          # Parsing failed


class ParseJob(Base):
    """Background parsing job for resumes.

    Allows users to start parsing without waiting for completion.
    The job runs in the background and creates an entity when done.
    """
    __tablename__ = "parse_jobs"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(SQLEnum(ParseJobStatus), default=ParseJobStatus.pending, index=True)

    # File info (stored temporarily for processing)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)  # Temporary file path
    file_size = Column(Integer, nullable=True)

    # Result
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)
    error_message = Column(Text, nullable=True)

    # Progress tracking
    progress = Column(Integer, default=0)  # 0-100 percentage
    progress_stage = Column(String(100), nullable=True)  # "Extracting text", "Parsing with AI", etc.

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index('ix_parse_job_user_status', 'user_id', 'status'),
        Index('ix_parse_job_org_created', 'org_id', 'created_at'),
    )

    # Relationships
    organization = relationship("Organization")
    user = relationship("User")
    entity = relationship("Entity")
