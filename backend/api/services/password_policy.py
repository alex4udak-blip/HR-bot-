"""
Password policy and validation service.

This module implements password complexity requirements to prevent
weak passwords and improve account security.
"""
from typing import Tuple

# Common passwords that should be rejected
# This is a subset of commonly used passwords - in production, consider using
# a more comprehensive list like the OWASP Top 10000 passwords list
COMMON_PASSWORDS = {
    "password", "123456", "password123", "qwerty", "admin", "letmein",
    "welcome", "monkey", "dragon", "master", "sunshine", "princess",
    "football", "shadow", "michael", "superman", "123456789", "12345678",
    "12345", "1234567", "1234567890", "abc123", "computer", "1234",
    "iloveyou", "111111", "123123", "password1", "qwerty123", "admin123",
    "root", "pass", "test", "guest", "user", "default", "changeme"
}


def validate_password(password: str, email: str = None) -> Tuple[bool, str]:
    """
    Validate password against security policy requirements.

    Requirements:
    - Minimum 8 characters
    - At least one letter
    - At least one number
    - Not a common/weak password
    - Not matching user's email

    Args:
        password: The password to validate
        email: Optional user email to check against

    Returns:
        Tuple of (is_valid, error_message)
        - (True, "") if password is valid
        - (False, "error message") if password is invalid
    """
    # Check minimum length
    if len(password) < 8:
        return False, "Password must be at least 8 characters"

    # Check for at least one digit
    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one number"

    # Check for at least one letter
    if not any(c.isalpha() for c in password):
        return False, "Password must contain at least one letter"

    # Check against common passwords (case-insensitive)
    if password.lower() in COMMON_PASSWORDS:
        return False, "Password is too common. Please choose a stronger password"

    # Check if password matches email
    if email:
        # Extract username from email (part before @)
        email_username = email.lower().split('@')[0]

        # Check if password is the same as email or email username
        if password.lower() == email.lower():
            return False, "Password cannot be same as email"

        if password.lower() == email_username:
            return False, "Password cannot be same as email username"

    # All checks passed
    return True, ""
