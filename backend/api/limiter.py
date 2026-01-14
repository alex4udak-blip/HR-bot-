"""Rate limiter configuration for the application."""
import os
from slowapi import Limiter
from slowapi.util import get_remote_address


# Rate limit configurations
DEFAULT_RATE_LIMIT = "100/minute"
TESTING_RATE_LIMIT = "1000/minute"  # More lenient limit for testing


def get_key_func():
    """Return key function based on environment.

    Always use remote address for rate limiting to ensure security.
    Rate limits are adjusted via get_rate_limit() for different environments.
    """
    return get_remote_address


def get_rate_limit() -> str:
    """Return appropriate rate limit based on environment.

    - DISABLE_RATE_LIMIT=1: Returns None (explicitly disables rate limiting)
    - TESTING=1: Returns lenient limit (1000/minute) for test performance
    - Default: Returns standard limit (100/minute)
    """
    if os.environ.get("DISABLE_RATE_LIMIT") == "1":
        # Explicit opt-out - should only be used in controlled environments
        return None
    if os.environ.get("TESTING") == "1":
        return TESTING_RATE_LIMIT
    return DEFAULT_RATE_LIMIT


def is_rate_limiting_enabled() -> bool:
    """Check if rate limiting is enabled."""
    return os.environ.get("DISABLE_RATE_LIMIT") != "1"


# Create a global limiter instance that can be imported by routes
limiter = Limiter(
    key_func=get_key_func(),
    enabled=is_rate_limiting_enabled(),
    default_limits=[get_rate_limit()] if is_rate_limiting_enabled() else []
)
