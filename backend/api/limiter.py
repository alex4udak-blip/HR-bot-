"""Rate limiter configuration for the application."""
import os
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_key_func():
    """Return key function based on environment.

    In test mode, return a unique key per request to effectively disable rate limiting.
    In production, use remote address for proper rate limiting.
    """
    if os.environ.get("TESTING") == "1":
        import uuid
        return lambda request: str(uuid.uuid4())  # Unique key = no rate limiting
    return get_remote_address


# Create a global limiter instance that can be imported by routes
limiter = Limiter(key_func=get_key_func())
