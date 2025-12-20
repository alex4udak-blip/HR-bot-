from datetime import datetime
from typing import Optional, List
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


# Users
class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str = "admin"
    telegram_id: Optional[int] = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    role: Optional[str] = None
    telegram_id: Optional[int] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    telegram_id: Optional[int]
    is_active: bool
    created_at: datetime
    chats_count: int = 0

    class Config:
        from_attributes = True


# Chats
class ChatResponse(BaseModel):
    id: int
    chat_id: int
    title: str
    criteria: Optional[str]
    owner_id: Optional[int]
    owner_name: Optional[str] = None
    is_active: bool
    messages_count: int = 0
    users_count: int = 0
    last_message_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatUpdate(BaseModel):
    criteria: Optional[str] = None
    owner_id: Optional[int] = None
    is_active: Optional[bool] = None


# Messages
class MessageResponse(BaseModel):
    id: int
    user_id: int
    username: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    message_type: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatParticipant(BaseModel):
    user_id: int
    username: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    messages_count: int


# Analysis
class AnalysisRequest(BaseModel):
    analysis_type: str = "full"  # full, question
    question: Optional[str] = None


class AnalysisResponse(BaseModel):
    id: int
    analysis_type: str
    question: Optional[str]
    result: str
    created_at: datetime

    class Config:
        from_attributes = True


# Stats
class StatsResponse(BaseModel):
    total_chats: int
    total_messages: int
    total_users: int
    total_analyses: int
    active_chats: int
    messages_today: int
    messages_this_week: int
    chats_by_day: List[dict]
    messages_by_type: dict


# Update forward refs
TokenResponse.model_rebuild()
