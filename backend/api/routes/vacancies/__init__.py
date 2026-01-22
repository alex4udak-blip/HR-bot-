"""
Vacancy management API routes package.

This package contains all vacancy-related endpoints split into modules:
- common: Shared schemas, imports, and helper functions
- crud: Basic CRUD operations for vacancies
- applications: Application management endpoints
- kanban: Kanban board endpoints
- matching: Candidate matching and notification endpoints
- sharing: Vacancy sharing endpoints
"""
from fastapi import APIRouter

# Import common schemas and helpers for backwards compatibility
from .common import (
    # Schemas
    VacancyCreate,
    VacancyUpdate,
    VacancyResponse,
    ApplicationCreate,
    ApplicationUpdate,
    ApplicationResponse,
    KanbanColumn,
    KanbanBoard,
    BulkStageUpdate,
    # Helper functions
    is_org_owner,
    has_full_database_access,
    get_user_department_ids,
    is_dept_lead_or_admin,
    has_shared_vacancy_access,
    get_shared_vacancy_ids,
    can_access_vacancy,
    can_edit_vacancy,
    can_share_vacancy,
    check_vacancy_access,
    # Logger
    logger,
)

# Create the combined router
# Note: This router is mounted at /api/vacancies in main.py
router = APIRouter()

# Import route handlers from submodules and add them to the router
# We need to import them after creating the router and add routes manually
# to avoid issues with multiple routers having overlapping paths

# Import CRUD handlers
from .crud import (
    list_vacancies,
    create_vacancy,
    get_vacancy,
    update_vacancy,
    delete_vacancy,
)

# Import application handlers
from .applications import (
    list_applications,
    create_application,
    update_application,
    delete_application,
)

# Import kanban handlers
from .kanban import (
    get_kanban_board,
    get_kanban_column,
    rebalance_stage_orders,
    bulk_move_applications,
)

# Import matching handlers
from .matching import (
    get_vacancies_stats,
    get_matching_candidates,
    notify_matching_candidates,
    invite_candidate_to_vacancy,
    CandidateMatchResponse,
    NotifyCandidatesResponse,
)

# Import sharing handlers
from .sharing import (
    share_vacancy,
    get_vacancy_shares,
    revoke_vacancy_share,
    get_vacancies_shared_with_me,
    VacancyShareRequest,
    VacancyShareResponse,
)

# Register routes in the correct order
# More specific routes must come before generic ones (like /{vacancy_id})

# Sharing: /shared-with-me must be before /{vacancy_id}
router.add_api_route("/shared-with-me", get_vacancies_shared_with_me, methods=["GET"], tags=["vacancy-sharing"])

# Stats: /stats/overview must be before /{vacancy_id}
router.add_api_route("/stats/overview", get_vacancies_stats, methods=["GET"], tags=["vacancy-stats"])

# Applications bulk-move: /applications/bulk-move must be before /applications/{application_id}
router.add_api_route("/applications/bulk-move", bulk_move_applications, methods=["POST"], tags=["vacancy-kanban"])

# Applications update/delete by ID: /applications/{application_id}
router.add_api_route("/applications/{application_id}", update_application, methods=["PUT"], tags=["vacancy-applications"])
router.add_api_route("/applications/{application_id}", delete_application, methods=["DELETE"], tags=["vacancy-applications"])

# CRUD: list and create vacancies (root path)
router.add_api_route("", list_vacancies, methods=["GET"], tags=["vacancies"])
router.add_api_route("", create_vacancy, methods=["POST"], status_code=201, tags=["vacancies"])

# Vacancy-specific routes: /{vacancy_id}/...
router.add_api_route("/{vacancy_id}", get_vacancy, methods=["GET"], tags=["vacancies"])
router.add_api_route("/{vacancy_id}", update_vacancy, methods=["PUT"], tags=["vacancies"])
router.add_api_route("/{vacancy_id}", delete_vacancy, methods=["DELETE"], status_code=204, tags=["vacancies"])

# Vacancy applications
router.add_api_route("/{vacancy_id}/applications", list_applications, methods=["GET"], tags=["vacancy-applications"])
router.add_api_route("/{vacancy_id}/applications", create_application, methods=["POST"], status_code=201, tags=["vacancy-applications"])

# Vacancy kanban
router.add_api_route("/{vacancy_id}/kanban", get_kanban_board, methods=["GET"], tags=["vacancy-kanban"])
router.add_api_route("/{vacancy_id}/kanban/column/{stage}", get_kanban_column, methods=["GET"], tags=["vacancy-kanban"])

# Vacancy matching
router.add_api_route("/{vacancy_id}/matching-candidates", get_matching_candidates, methods=["GET"], tags=["vacancy-matching"])
router.add_api_route("/{vacancy_id}/notify-candidates", notify_matching_candidates, methods=["POST"], tags=["vacancy-matching"])
router.add_api_route("/{vacancy_id}/invite-candidate/{entity_id}", invite_candidate_to_vacancy, methods=["POST"], tags=["vacancy-matching"])

# Vacancy sharing
router.add_api_route("/{vacancy_id}/share", share_vacancy, methods=["POST"], tags=["vacancy-sharing"])
router.add_api_route("/{vacancy_id}/shares", get_vacancy_shares, methods=["GET"], tags=["vacancy-sharing"])
router.add_api_route("/{vacancy_id}/share/{share_id}", revoke_vacancy_share, methods=["DELETE"], tags=["vacancy-sharing"])

# Re-export everything for backwards compatibility
__all__ = [
    # Main router
    "router",
    # Schemas
    "VacancyCreate",
    "VacancyUpdate",
    "VacancyResponse",
    "ApplicationCreate",
    "ApplicationUpdate",
    "ApplicationResponse",
    "KanbanColumn",
    "KanbanBoard",
    "BulkStageUpdate",
    "VacancyShareRequest",
    "VacancyShareResponse",
    "CandidateMatchResponse",
    "NotifyCandidatesResponse",
    # Helper functions
    "is_org_owner",
    "has_full_database_access",
    "get_user_department_ids",
    "is_dept_lead_or_admin",
    "has_shared_vacancy_access",
    "get_shared_vacancy_ids",
    "can_access_vacancy",
    "can_edit_vacancy",
    "can_share_vacancy",
    "check_vacancy_access",
    # Logger
    "logger",
]
