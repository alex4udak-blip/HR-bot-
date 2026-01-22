"""
Correlation ID middleware for request tracing.

Adds a correlation ID to each request for log tracing across services.
"""

import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..utils.logging import set_correlation_id, get_correlation_id, log_request


class CorrelationMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds correlation ID to each request.

    The correlation ID is:
    1. Extracted from X-Correlation-ID header if present
    2. Generated as a new UUID if not present
    3. Added to response headers
    4. Available in logs via correlation_id context var
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Get or generate correlation ID
        correlation_id = request.headers.get("X-Correlation-ID")
        if not correlation_id:
            correlation_id = str(uuid.uuid4())[:8]

        # Set in context for logging
        set_correlation_id(correlation_id)

        # Track request timing
        start_time = time.perf_counter()

        # Process request
        response = await call_next(request)

        # Calculate duration
        duration_ms = (time.perf_counter() - start_time) * 1000

        # Add correlation ID to response
        response.headers["X-Correlation-ID"] = correlation_id

        # Log request (skip health checks and static files)
        if not request.url.path.startswith(("/health", "/static", "/favicon")):
            log_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

        return response
