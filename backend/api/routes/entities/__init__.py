"""
Entities module - combines all entity-related routers.

This module provides a combined router that aggregates all entity endpoints:
- CRUD operations (create, read, update, delete)
- Transfer operations
- File upload/download operations
- Memory/notes operations (profiles, sharing, linking)
- Search and filter operations
- Bulk operations (resume parsing, profile generation)
"""
from fastapi import APIRouter

from .crud import router as crud_router
from .transfers import router as transfers_router
from .files import router as files_router
from .memory import router as memory_router
from .search import router as search_router
from .bulk import router as bulk_router

# Re-export common items for backwards compatibility with tests
from .common import (
    EntityCreate,
    EntityUpdate,
    EntityResponse,
    TransferCreate,
    TransferResponse,
    StatusUpdate,
    normalize_telegram_username,
    validate_email,
    normalize_and_validate_identifiers,
    check_entity_access,
    OwnershipFilter,
)

from .files import (
    validate_file_upload,
    check_disk_space,
    get_entity_file_count,
    ENTITY_FILES_DIR,
    MAX_FILE_SIZE,
    MAX_FILES_PER_ENTITY,
    MIN_DISK_SPACE_MB,
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    DANGEROUS_PATTERNS,
)

# Create the combined router
router = APIRouter()

# Include all sub-routers
# CRUD operations (basic entity operations)
router.include_router(crud_router, tags=["entities-crud"])

# Transfer operations
router.include_router(transfers_router, tags=["entities-transfers"])

# File operations
router.include_router(files_router, tags=["entities-files"])

# Memory/notes operations (profiles, sharing, linking chats/calls)
router.include_router(memory_router, tags=["entities-memory"])

# Search operations (smart search, red flags, recommendations, similar, duplicates)
router.include_router(search_router, tags=["entities-search"])

# Bulk operations (resume parsing, bulk profile generation)
router.include_router(bulk_router, tags=["entities-bulk"])


# Add aliases for root path without trailing slash (for backwards compatibility)
# This is needed because tests and clients may call /api/entities without trailing slash
from .crud import list_entities, create_entity
router.add_api_route("", list_entities, methods=["GET"], tags=["entities-crud"])
router.add_api_route("", create_entity, methods=["POST"], status_code=201, tags=["entities-crud"])

__all__ = [
    "router",
    # Schemas
    "EntityCreate",
    "EntityUpdate",
    "EntityResponse",
    "TransferCreate",
    "TransferResponse",
    "StatusUpdate",
    "OwnershipFilter",
    # Helper functions
    "normalize_telegram_username",
    "validate_email",
    "normalize_and_validate_identifiers",
    "check_entity_access",
    # File validation
    "validate_file_upload",
    "check_disk_space",
    "get_entity_file_count",
    # File constants
    "ENTITY_FILES_DIR",
    "MAX_FILE_SIZE",
    "MAX_FILES_PER_ENTITY",
    "MIN_DISK_SPACE_MB",
    "ALLOWED_EXTENSIONS",
    "ALLOWED_MIME_TYPES",
    "DANGEROUS_PATTERNS",
]
