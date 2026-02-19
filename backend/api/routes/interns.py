"""
API routes for interns data — server-to-server proxy to Prometheus.

The frontend calls GET /api/interns, and this route fetches
from Prometheus with Authorization header (secret stays server-side).
"""
import logging

from fastapi import APIRouter, HTTPException
from api.config import settings
from api.utils.http_client import get_http_client

logger = logging.getLogger("hr-analyzer.interns")

router = APIRouter()


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
