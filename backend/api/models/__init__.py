from .database import (
    Base, User, Chat, Message, CriteriaPreset,
    ChatCriteria, AIConversation, AnalysisHistory
)
from .schemas import *

# Import new models for Alembic to detect
from .email_templates import EmailTemplate, EmailLog, EmailTemplateType, EmailStatus
from .analytics import HRAnalyticsSnapshot, VacancyMetrics, SnapshotPeriod
