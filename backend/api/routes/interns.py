"""
API routes for interns data — server-to-server proxy to Prometheus.

The frontend calls GET /api/interns/*, and these routes fetch
from Prometheus with Authorization header (secret stays server-side).
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from api.config import settings
from api.utils.http_client import get_http_client

logger = logging.getLogger("hr-analyzer.interns")

router = APIRouter()


async def _proxy_prometheus(path: str, params: Optional[dict] = None):
    """
    Shared helper: proxy a GET request to Prometheus.

    - Validates that PROMETHEUS_BASE_URL and COMMUNICATION_API_KEY are set.
    - Adds Bearer token to the request.
    - Maps Prometheus HTTP errors to appropriate backend responses.
    - Returns parsed JSON on success.
    """
    base_url = settings.prometheus_base_url
    api_key = settings.communication_api_key

    if not base_url or not api_key:
        missing = []
        if not base_url:
            missing.append("PROMETHEUS_BASE_URL")
        if not api_key:
            missing.append("COMMUNICATION_API_KEY")
        logger.warning("Prometheus integration not configured — missing env vars: %s", ", ".join(missing))
        raise HTTPException(
            status_code=503,
            detail=f"Prometheus integration is not configured (missing: {', '.join(missing)})",
        )

    url = f"{base_url.rstrip('/')}{path}"

    client = get_http_client()
    try:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            params=params,
        )
    except Exception as exc:
        logger.error("Failed to connect to Prometheus (%s): %s", path, type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Failed to connect to Prometheus service",
        )

    if response.status_code == 401:
        logger.error("Prometheus returned 401 for %s — check COMMUNICATION_API_KEY", path)
        raise HTTPException(
            status_code=502,
            detail="Prometheus authentication failed",
        )

    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail="Resource not found in Prometheus",
        )

    if response.status_code != 200:
        logger.error("Prometheus returned %d for %s", response.status_code, path)
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus returned status {response.status_code}",
        )

    return response.json()


@router.get("")
async def get_interns():
    """
    Proxy endpoint: fetches interns list from Prometheus.

    Returns the JSON payload from Prometheus as-is.
    The COMMUNICATION_API_KEY is never exposed to the client.
    """
    import os
    base_url = settings.prometheus_base_url
    api_key = settings.communication_api_key

    # Diagnostic: log raw env vs settings value on every request
    raw_env = os.environ.get("PROMETHEUS_BASE_URL")
    logger.info(
        "Prometheus check: raw_env present=%s raw_env_repr=%r settings_value_repr=%r api_key_present=%s",
        raw_env is not None,
        raw_env[:40] if raw_env else raw_env,
        base_url[:40] if base_url else base_url,
        bool(api_key),
    )

    if not base_url or not api_key:
        missing = []
        if not base_url:
            missing.append("PROMETHEUS_BASE_URL")
        if not api_key:
            missing.append("COMMUNICATION_API_KEY")
        logger.warning("Prometheus integration not configured — missing env vars: %s", ", ".join(missing))
        raise HTTPException(
            status_code=503,
            detail=f"Prometheus integration is not configured (missing: {', '.join(missing)})",
        )

    url = f"{base_url.rstrip('/')}/api/external/interns"

    client = get_http_client()
    try:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
        )
    except Exception as exc:
        # Log error without leaking the API key
        logger.error("Failed to connect to Prometheus: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Failed to connect to Prometheus service",
        )

    if response.status_code == 401:
        logger.error("Prometheus returned 401 — check COMMUNICATION_API_KEY")
        raise HTTPException(
            status_code=502,
            detail="Prometheus authentication failed",
        )

    if response.status_code != 200:
        logger.error("Prometheus returned %d", response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus returned status {response.status_code}",
        )

    return response.json()


@router.get("/analytics")
async def get_analytics(
    trail: str = Query(default="all", description="Trail ID or 'all'"),
    period: str = Query(default="30", description="Number of days for analysis"),
):
    """
    Proxy endpoint: fetches platform analytics from Prometheus.

    Query params are forwarded to Prometheus /api/external/analytics.
    """
    return await _proxy_prometheus(
        "/api/external/analytics",
        params={"trail": trail, "period": period},
    )


@router.get("/student-achievements/{student_id}")
async def get_student_achievements(student_id: str):
    """
    Proxy endpoint: fetches achievements for a specific student from Prometheus.

    The student_id is part of the URL path.
    Returns 404 if student not found in Prometheus.
    """
    return await _proxy_prometheus(
        f"/api/external/student-achievements/{student_id}",
    )
