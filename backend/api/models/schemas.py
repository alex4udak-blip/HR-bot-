from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr


# Auth
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class LinkTelegramRequest(BaseModel):
    telegram_id: int
    telegram_username: Optional[str] = None


# Users
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "admin"
    telegram_id: Optional[int] = None
    telegram_username: Optional[str] = None


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    role: Optional[str] = None
    telegram_id: Optional[int] = None
    telegram_username: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    telegram_id: Optional[int]
    telegram_username: Optional[str]
    is_active: bool
    created_at: datetime
    chats_count: int = 0

    class Config:
        from_attributes = True


# Chat Types
class ChatTypeInfo(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    color: str


class QuickAction(BaseModel):
    id: str
    label: str
    icon: str


class ChatTypeConfig(BaseModel):
    type_info: ChatTypeInfo
    quick_actions: List[QuickAction]
    suggested_questions: List[str]
    default_criteria: List[dict]


# Chats
class ChatResponse(BaseModel):
    id: int
    telegram_chat_id: int
    title: str
    custom_name: Optional[str]
    chat_type: str = "hr"
    custom_type_name: Optional[str] = None
    custom_type_description: Optional[str] = None
    owner_id: Optional[int]
    owner_name: Optional[str] = None
    is_active: bool
    messages_count: int = 0
    participants_count: int = 0
    last_activity: Optional[datetime]
    created_at: datetime
    has_criteria: bool = False

    class Config:
        from_attributes = True


class ChatUpdate(BaseModel):
    custom_name: Optional[str] = None
    chat_type: Optional[str] = None
    custom_type_name: Optional[str] = None
    custom_type_description: Optional[str] = None
    owner_id: Optional[int] = None
    is_active: Optional[bool] = None


# Messages
class MessageResponse(BaseModel):
    id: int
    telegram_user_id: int
    username: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    content: str
    content_type: str
    file_name: Optional[str]
    document_metadata: Optional[dict] = None  # {file_type, pages_count, sheets, etc}
    parse_status: Optional[str] = None  # parsed, partial, failed
    parse_error: Optional[str] = None
    timestamp: datetime

    class Config:
        from_attributes = True


class ParticipantResponse(BaseModel):
    telegram_user_id: int
    username: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    messages_count: int


# Criteria
class CriterionItem(BaseModel):
    name: str
    weight: int = 5  # 1-10
    description: Optional[str] = None
    category: Optional[str] = None  # basic, red_flag, green_flag


class CriteriaPresetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    criteria: List[CriterionItem]
    category: Optional[str] = None
    is_global: bool = False


class CriteriaPresetResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    criteria: List[dict]
    category: Optional[str]
    is_global: bool
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class ChatCriteriaUpdate(BaseModel):
    criteria: List[CriterionItem]


class ChatCriteriaResponse(BaseModel):
    id: int
    chat_id: int
    criteria: List[dict]
    updated_at: datetime

    class Config:
        from_attributes = True


# AI Chat
class AIMessageRequest(BaseModel):
    message: str
    quick_action: Optional[str] = None  # full_analysis, red_flags, strengths, recommendation


class AIMessageResponse(BaseModel):
    role: str
    content: str
    timestamp: datetime


class AIConversationResponse(BaseModel):
    id: int
    chat_id: int
    messages: List[dict]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Analysis & Reports
class AnalyzeRequest(BaseModel):
    report_type: str = "standard"  # quick, standard, detailed
    include_quotes: bool = True
    include_scores: bool = True
    include_red_flags: bool = True
    include_green_flags: bool = True
    include_recommendation: bool = True


class ReportRequest(BaseModel):
    format: str = "pdf"  # pdf, docx, markdown
    report_type: str = "standard"
    include_full_conversation: bool = False


class AnalysisResponse(BaseModel):
    id: int
    chat_id: int
    result: str
    report_type: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# Stats
class StatsResponse(BaseModel):
    total_chats: int
    total_messages: int
    total_participants: int
    total_analyses: int
    active_chats: int
    messages_today: int
    messages_this_week: int
    activity_by_day: List[dict]
    messages_by_type: dict
    top_chats: List[dict]


# Update forward refs
TokenResponse.model_rebuild()
