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
    base_url = settings.prometheus_base_url
    api_key = settings.communication_api_key

    if not base_url or not api_key:
        logger.warning("Prometheus integration not configured (missing PROMETHEUS_BASE_URL or COMMUNICATION_API_KEY)")
        raise HTTPException(
            status_code=503,
            detail="Prometheus integration is not configured",
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
