from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Enum as SQLEnum,
    ForeignKey, Integer, String, Text, JSON, func
)
from sqlalchemy.orm import DeclarativeBase, relationship
import enum


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"


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


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.ADMIN)
    telegram_id = Column(BigInteger, unique=True, nullable=True, index=True)
    telegram_username = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())

    chats = relationship("Chat", back_populates="owner")
    criteria_presets = relationship("CriteriaPreset", back_populates="created_by_user")
    ai_conversations = relationship("AIConversation", back_populates="user")
    analyses = relationship("AnalysisHistory", back_populates="user")


class Chat(Base):
    __tablename__ = "chats"

    id = Column(Integer, primary_key=True)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    custom_name = Column(String(255), nullable=True)
    chat_type = Column(SQLEnum(ChatType), default=ChatType.work, index=True)
    custom_type_name = Column(String(255), nullable=True)  # For CUSTOM type
    custom_type_description = Column(Text, nullable=True)  # For CUSTOM type
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    last_activity = Column(DateTime, default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True, index=True)  # Soft delete timestamp

    owner = relationship("User", back_populates="chats")
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
    content_type = Column(String(50), nullable=False)  # text, voice, video_note, document, photo, etc
    file_id = Column(String(255), nullable=True)  # Telegram Bot API file_id
    file_path = Column(String(512), nullable=True)  # Local file path for imported media
    file_name = Column(String(255), nullable=True)
    # Document parsing metadata
    document_metadata = Column(JSON, nullable=True)  # {file_type, pages_count, sheets, etc}
    parse_status = Column(String(20), nullable=True)  # parsed, partial, failed
    parse_error = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=func.now())

    chat = relationship("Chat", back_populates="messages")


class CriteriaPreset(Base):
    __tablename__ = "criteria_presets"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    criteria = Column(JSON, nullable=False)  # [{name, weight, description, category}]
    category = Column(String(100), nullable=True)  # basic, red_flags, green_flags, position
    chat_type = Column(SQLEnum(ChatType), nullable=True, index=True)  # Type-specific presets
    is_global = Column(Boolean, default=False)  # True = visible to all
    is_default = Column(Boolean, default=False)  # True = default for chat type
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
    result = Column(Text, nullable=False)
    report_type = Column(String(50), nullable=True)  # full, quick, red_flags, etc
    report_format = Column(String(20), nullable=True)  # pdf, docx, markdown
    criteria_used = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())

    chat = relationship("Chat", back_populates="analyses")
    user = relationship("User", back_populates="analyses")
