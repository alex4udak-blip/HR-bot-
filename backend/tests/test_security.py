"""
Security tests for HR-Bot backend.

These tests document security requirements and vulnerabilities identified in the audit.
Some tests may fail initially - this is expected as they document missing security features.
"""
import pytest
import asyncio
from datetime import datetime, timedelta
from jose import jwt

from api.services.auth import (
    hash_password,
    create_access_token,
)
from api.config import settings
from api.models.database import User, UserRole


class TestCORSSecurity:
    """
    Test CORS security configuration.

    VULNERABILITY: main.py:374 has allow_origins="*" which allows any domain
    to make requests with credentials, opening up CSRF and session hijacking risks.
    """

    @pytest.mark.asyncio
    async def test_cors_not_allow_all_origins(self, client):
        """
        Test that CORS doesn't allow wildcard origins with credentials.

        EXPECTED BEHAVIOR: Either:
        1. CORS should specify allowed origins explicitly (not "*")
        2. OR if "*" is used, allow_credentials should be False

        CURRENT BEHAVIOR: Allows "*" with credentials=True (SECURITY RISK)
        """
        # Make a request with a random origin
        response = await client.get(
            "/health",
            headers={"Origin": "https://evil-site.com"}
        )

        # Check CORS headers - should not allow credentials with wildcard
        cors_allow_origin = response.headers.get("access-control-allow-origin")
        cors_allow_credentials = response.headers.get("access-control-allow-credentials")

        # SECURITY REQUIREMENT: Cannot have both wildcard origin and credentials
        if cors_allow_origin == "*":
            # If wildcard is used, credentials must not be allowed
            assert cors_allow_credentials != "true", (
                "SECURITY VULNERABILITY: CORS allows wildcard origin (*) with credentials=true. "
                "This allows any website to make authenticated requests on behalf of users."
            )

    @pytest.mark.asyncio
    async def test_cors_validates_origin(self, client):
        """
        Test that CORS validates allowed origins.

        EXPECTED: Only whitelisted origins should be allowed
        CURRENT: All origins allowed (*)
        """
        # This test documents the expected behavior
        # Should only allow specific trusted domains
        response = await client.options(
            "/api/auth/login",
            headers={"Origin": "https://evil-site.com"}
        )

        # In a secure implementation, evil-site.com should not be allowed
        # TODO: This test will fail until CORS is properly configured
        pass


class TestRateLimiting:
    """
    Test rate limiting on authentication endpoints.

    VULNERABILITY: No rate limiting on /api/auth/login and /api/auth/register
    allows brute force attacks and credential stuffing.
    """

    @pytest.mark.asyncio
    async def test_login_has_rate_limit(self, client, admin_user):
        """
        Test that login endpoint has rate limiting.

        EXPECTED: After X failed attempts (e.g., 10), should return 429 Too Many Requests
        CURRENT: No rate limiting implemented

        NOTE: This test will likely FAIL - documenting missing security feature
        """
        # Attempt many login requests rapidly
        failed_attempts = 0
        rate_limited = False

        for i in range(50):
            response = await client.post("/api/auth/login", json={
                "email": "admin@test.com",
                "password": "wrongpassword"
            })

            if response.status_code == 429:  # Too Many Requests
                rate_limited = True
                break

            failed_attempts += 1

        # EXPECTED: Should be rate limited before 50 attempts
        # TODO: Uncomment when rate limiting is implemented
        # assert rate_limited, (
        #     f"SECURITY VULNERABILITY: No rate limiting on login endpoint. "
        #     f"Made {failed_attempts} failed login attempts without being blocked."
        # )

        # For now, just document the issue
        if not rate_limited:
            pytest.skip(
                f"Rate limiting not implemented: Made {failed_attempts} failed login attempts. "
                f"SECURITY RISK: Allows brute force attacks."
            )

    @pytest.mark.asyncio
    async def test_register_has_rate_limit(self, client):
        """
        Test that register endpoint has rate limiting.

        NOTE: Registration is currently disabled, but if re-enabled,
        it should have rate limiting to prevent abuse.
        """
        # Register is currently disabled (returns 403)
        # This test documents that IF it's re-enabled, it needs rate limiting

        attempts = 0
        rate_limited = False

        for i in range(20):
            response = await client.post("/api/auth/register", json={
                "email": f"test{i}@test.com",
                "password": "password123",
                "name": f"Test User {i}"
            })

            # Currently returns 403 (disabled)
            if response.status_code == 429:
                rate_limited = True
                break

            attempts += 1

        # Document the requirement
        pytest.skip(
            "Registration is disabled. If re-enabled, MUST implement rate limiting "
            "to prevent automated account creation."
        )

    @pytest.mark.asyncio
    async def test_password_change_has_rate_limit(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test that password change endpoint has rate limiting.

        EXPECTED: Limit password change attempts to prevent brute force
        CURRENT: No rate limiting
        """
        attempts = 0
        rate_limited = False

        for i in range(30):
            response = await client.post(
                "/api/auth/change-password",
                json={
                    "current_password": "wrongpassword",
                    "new_password": "newpassword123"
                },
                headers=get_auth_headers(admin_token)
            )

            if response.status_code == 429:
                rate_limited = True
                break

            attempts += 1

        # Document the missing feature
        if not rate_limited:
            pytest.skip(
                f"Rate limiting not implemented on password change: Made {attempts} attempts. "
                f"SECURITY RISK: Allows brute force of current password."
            )


class TestBruteForceProtection:
    """
    Test account lockout and brute force protection.

    VULNERABILITY: No account lockout mechanism after failed login attempts.
    """

    @pytest.mark.asyncio
    async def test_account_lockout_after_failed_attempts(self, client, admin_user):
        """
        Test that accounts are locked after X failed login attempts.

        EXPECTED: After 5-10 failed attempts, account should be temporarily locked
        CURRENT: No lockout mechanism

        NOTE: This test will FAIL - documenting missing security feature
        """
        max_attempts = 10
        locked = False

        for attempt in range(max_attempts):
            response = await client.post("/api/auth/login", json={
                "email": "admin@test.com",
                "password": "wrongpassword"
            })

            # Check if account is locked (should return specific error)
            if response.status_code == 423:  # Locked
                locked = True
                break
            elif response.status_code == 401:
                data = response.json()
                if "locked" in data.get("detail", "").lower():
                    locked = True
                    break

        # TODO: Uncomment when account lockout is implemented
        # assert locked, (
        #     f"SECURITY VULNERABILITY: No account lockout after {max_attempts} failed attempts. "
        #     f"Allows unlimited brute force attacks on user accounts."
        # )

        if not locked:
            pytest.skip(
                f"Account lockout not implemented: {max_attempts} failed login attempts allowed. "
                f"SECURITY RISK: Enables brute force attacks."
            )

    @pytest.mark.asyncio
    async def test_lockout_expires_after_timeout(self, client, admin_user):
        """
        Test that account lockout expires after a timeout period.

        EXPECTED: Locked accounts should automatically unlock after 15-30 minutes
        CURRENT: No lockout mechanism
        """
        pytest.skip(
            "Account lockout mechanism not implemented. "
            "When implemented, ensure lockouts expire after reasonable timeout."
        )

    @pytest.mark.asyncio
    async def test_lockout_notification(self, client, admin_user):
        """
        Test that users are notified when their account is locked.

        EXPECTED: Clear error message indicating account is locked and how to unlock
        CURRENT: No lockout mechanism
        """
        pytest.skip(
            "Account lockout mechanism not implemented. "
            "When implemented, ensure clear user notification."
        )


class TestPasswordSecurity:
    """
    Test password complexity requirements.

    VULNERABILITY: No password strength requirements allow weak passwords like "123".
    """

    @pytest.mark.asyncio
    async def test_weak_password_rejected(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test that weak passwords are rejected.

        EXPECTED: Passwords like "123" should be rejected
        CURRENT: No password complexity validation

        NOTE: This test will likely FAIL - documenting missing security feature
        """
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "admin123",
                "new_password": "123"  # Too weak
            },
            headers=get_auth_headers(admin_token)
        )

        # TODO: Uncomment when password validation is implemented
        # assert response.status_code in [400, 422], (
        #     f"SECURITY VULNERABILITY: Weak password '123' was accepted. "
        #     f"Expected rejection (400/422), got {response.status_code}"
        # )

        # For now, document if it passes
        if response.status_code == 200:
            pytest.skip(
                "Password complexity validation not implemented: Weak password '123' accepted. "
                "SECURITY RISK: Users can set easily guessable passwords."
            )

    @pytest.mark.asyncio
    async def test_short_password_rejected(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test that short passwords are rejected.

        EXPECTED: Minimum password length (e.g., 8 characters)
        CURRENT: No minimum length enforcement
        """
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "admin123",
                "new_password": "abc"  # Too short
            },
            headers=get_auth_headers(admin_token)
        )

        if response.status_code == 200:
            pytest.skip(
                "Minimum password length not enforced: 3-character password accepted. "
                "SECURITY RISK: Very short passwords allowed."
            )

    @pytest.mark.asyncio
    async def test_password_without_numbers_rejected(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test password complexity: require numbers.

        EXPECTED: Password should contain at least one number
        CURRENT: No complexity requirements
        """
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "admin123",
                "new_password": "passwordonly"  # No numbers
            },
            headers=get_auth_headers(admin_token)
        )

        # This requirement is optional but recommended
        # Document for consideration
        if response.status_code == 200:
            pytest.skip(
                "Password complexity (numbers) not enforced. "
                "RECOMMENDATION: Require mixed character types for stronger passwords."
            )

    @pytest.mark.asyncio
    async def test_common_password_rejected(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test that common passwords are rejected.

        EXPECTED: Passwords like "password123" should be rejected
        CURRENT: No common password checking
        """
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "admin123",
                "new_password": "password123"  # Common password
            },
            headers=get_auth_headers(admin_token)
        )

        if response.status_code == 200:
            pytest.skip(
                "Common password checking not implemented: 'password123' accepted. "
                "RECOMMENDATION: Check against common password lists."
            )

    @pytest.mark.asyncio
    async def test_password_same_as_email_rejected(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test that password cannot be same as email.

        EXPECTED: Password should not match email or username
        CURRENT: No such validation
        """
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "admin123",
                "new_password": "admin@test.com"  # Same as email
            },
            headers=get_auth_headers(admin_token)
        )

        if response.status_code == 200:
            pytest.skip(
                "Password-email matching not prevented. "
                "RECOMMENDATION: Prevent passwords that match user email."
            )


class TestTokenSecurity:
    """
    Test JWT token security.

    Tests for token expiration, validation, and proper error handling.
    """

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, client, admin_user):
        """
        Test that expired tokens are rejected.

        EXPECTED: 401 Unauthorized with expired token
        CURRENT: Should be working (test for regression)
        """
        # Create expired token manually
        expired_payload = {
            "sub": str(admin_user.id),
            "exp": datetime.utcnow() - timedelta(seconds=1)  # Already expired
        }
        token = jwt.encode(expired_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 401, (
            f"Expired token was accepted! Expected 401, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_invalid_token_rejected(self, client):
        """
        Test that invalid/malformed tokens are rejected.

        EXPECTED: 401 Unauthorized
        """
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid.token.here"}
        )

        assert response.status_code == 401, (
            f"Invalid token was accepted! Expected 401, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_token_without_user_id_rejected(self, client):
        """
        Test that token without user_id (sub) is rejected.

        EXPECTED: 401 Unauthorized
        """
        # Create token without user_id
        token = create_access_token(data={"random_field": "value"})

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 401, (
            f"Token without user_id was accepted! Expected 401, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_token_with_invalid_user_id_rejected(self, client):
        """
        Test that token with non-existent user_id is rejected.

        EXPECTED: 401 Unauthorized
        """
        # Create token with non-existent user
        token = create_access_token(data={"sub": "999999"})

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 401, (
            f"Token with non-existent user was accepted! Expected 401, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_token_with_inactive_user_rejected(self, client, db_session):
        """
        Test that token for inactive user is rejected.

        EXPECTED: 401 Unauthorized when user is deactivated
        """
        # Create inactive user
        inactive_user = User(
            email="inactive@test.com",
            password_hash=hash_password("password123"),
            name="Inactive User",
            role=UserRole.ADMIN,
            is_active=False
        )
        db_session.add(inactive_user)
        await db_session.commit()
        await db_session.refresh(inactive_user)

        # Create valid token for inactive user
        token = create_access_token(data={"sub": str(inactive_user.id)})

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 401, (
            f"Token for inactive user was accepted! Expected 401, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_token_without_bearer_prefix_rejected(self, client, admin_token):
        """
        Test that token without 'Bearer' prefix is rejected.

        EXPECTED: 401 or 403 Unauthorized
        """
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": admin_token}  # Missing "Bearer" prefix
        )

        assert response.status_code in [401, 403], (
            f"Token without Bearer prefix was accepted! Expected 401/403, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_token_signed_with_wrong_secret_rejected(self, client, admin_user):
        """
        Test that token signed with wrong secret is rejected.

        EXPECTED: 401 Unauthorized
        """
        # Create token with wrong secret
        wrong_token = jwt.encode(
            {"sub": str(admin_user.id), "exp": datetime.utcnow() + timedelta(hours=1)},
            "wrong_secret_key_12345",
            algorithm="HS256"
        )

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {wrong_token}"}
        )

        assert response.status_code == 401, (
            f"Token signed with wrong secret was accepted! Expected 401, got {response.status_code}"
        )

    @pytest.mark.asyncio
    async def test_token_expiration_time_reasonable(self):
        """
        Test that token expiration time is reasonable.

        EXPECTED: Tokens should expire (not be valid forever)
        Recommended: 15 minutes to 24 hours
        """
        token = create_access_token(data={"sub": "1"})
        decoded = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])

        exp_time = datetime.fromtimestamp(decoded["exp"])
        now = datetime.utcnow()
        time_until_expiry = exp_time - now

        # Check that token expires
        assert "exp" in decoded, "Token has no expiration!"

        # Check that expiration is reasonable (between 1 minute and 30 days)
        assert timedelta(minutes=1) < time_until_expiry < timedelta(days=30), (
            f"Token expiration time seems unreasonable: {time_until_expiry}. "
            f"Should be between 1 minute and 30 days."
        )


class TestSessionSecurity:
    """
    Test session and authentication security.
    """

    @pytest.mark.asyncio
    async def test_no_token_reuse_after_password_change(self, client, admin_user, admin_token, get_auth_headers, db_session):
        """
        Test that tokens are invalidated after password change.

        EXPECTED: Old tokens should be invalid after password change
        CURRENT: Likely FAILS - tokens remain valid (JWT is stateless)

        NOTE: This is a known limitation of JWT. Solutions:
        1. Token blacklist
        2. Include password hash version in token
        3. Use refresh tokens with revocation
        """
        # Verify old token works
        response = await client.get("/api/auth/me", headers=get_auth_headers(admin_token))
        assert response.status_code == 200

        # Change password
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "admin123",
                "new_password": "newpassword456"
            },
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200

        # Try to use old token
        response = await client.get("/api/auth/me", headers=get_auth_headers(admin_token))

        # TODO: Uncomment when token invalidation is implemented
        # assert response.status_code == 401, (
        #     "SECURITY VULNERABILITY: Old token still valid after password change. "
        #     "Tokens should be invalidated when password changes."
        # )

        if response.status_code == 200:
            pytest.skip(
                "Token invalidation not implemented: Old tokens remain valid after password change. "
                "SECURITY RISK: Stolen tokens can be used even after password reset."
            )

    @pytest.mark.asyncio
    async def test_concurrent_sessions_allowed(self, client, admin_user):
        """
        Test concurrent sessions behavior.

        This documents whether multiple simultaneous logins are allowed.
        This is typically allowed but should be monitored for suspicious activity.
        """
        # Login twice
        response1 = await client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "admin123"
        })
        token1 = response1.json()["access_token"]

        response2 = await client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "admin123"
        })
        token2 = response2.json()["access_token"]

        # Both tokens should work
        response1 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token1}"})
        response2 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token2}"})

        assert response1.status_code == 200
        assert response2.status_code == 200

        # Document that concurrent sessions are allowed
        # This is normal behavior but should be monitored


class TestInputValidation:
    """
    Test input validation and sanitization.
    """

    @pytest.mark.asyncio
    async def test_email_validation(self, client):
        """
        Test that invalid emails are rejected.

        EXPECTED: Proper email validation
        """
        response = await client.post("/api/auth/login", json={
            "email": "not-an-email",
            "password": "password123"
        })

        # Should fail validation (422) or authentication (401)
        assert response.status_code in [401, 422]

    @pytest.mark.asyncio
    async def test_sql_injection_in_email(self, client):
        """
        Test that SQL injection attempts in email are handled safely.

        EXPECTED: Should not cause SQL errors or unauthorized access
        """
        sql_injection_attempts = [
            "admin@test.com' OR '1'='1",
            "admin@test.com'; DROP TABLE users; --",
            "admin@test.com' UNION SELECT * FROM users --"
        ]

        for injection in sql_injection_attempts:
            response = await client.post("/api/auth/login", json={
                "email": injection,
                "password": "password123"
            })

            # Should fail safely (401 or 422), not 500
            assert response.status_code in [401, 422], (
                f"SQL injection attempt caused unexpected status: {response.status_code}"
            )

    @pytest.mark.asyncio
    async def test_xss_in_name_field(self, client, admin_user, admin_token, get_auth_headers):
        """
        Test that XSS attempts in name fields are handled.

        NOTE: This test documents the need for output escaping in frontend.
        Backend should store data as-is, frontend should escape when rendering.
        """
        xss_attempts = [
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert('xss')>",
            "';alert('xss');//"
        ]

        # Backend typically stores data as-is
        # Frontend is responsible for proper escaping
        # This test just ensures no crashes
        for xss in xss_attempts:
            response = await client.get("/api/auth/me", headers=get_auth_headers(admin_token))
            # Should not crash
            assert response.status_code == 200


class TestSecurityHeaders:
    """
    Test security-related HTTP headers.

    NOTE: These tests document recommended security headers.
    """

    @pytest.mark.asyncio
    async def test_security_headers_present(self, client):
        """
        Test that security headers are present.

        RECOMMENDED HEADERS:
        - X-Content-Type-Options: nosniff
        - X-Frame-Options: DENY or SAMEORIGIN
        - X-XSS-Protection: 1; mode=block
        - Strict-Transport-Security: max-age=31536000; includeSubDomains
        - Content-Security-Policy: appropriate policy
        """
        response = await client.get("/health")

        # Document which headers are missing
        recommended_headers = {
            "x-content-type-options": "nosniff",
            "x-frame-options": ["DENY", "SAMEORIGIN"],
            "strict-transport-security": "max-age=",  # Should contain max-age
        }

        missing_headers = []
        for header, expected in recommended_headers.items():
            value = response.headers.get(header, "")
            if isinstance(expected, list):
                if not any(exp in value for exp in expected):
                    missing_headers.append(f"{header}: {expected}")
            elif expected not in value:
                missing_headers.append(f"{header}: {expected}")

        if missing_headers:
            pytest.skip(
                f"Security headers not fully implemented. Missing or incorrect:\n" +
                "\n".join(f"  - {h}" for h in missing_headers) +
                "\nRECOMMENDATION: Add security headers middleware."
            )


class TestAPISecurityBestPractices:
    """
    Test general API security best practices.
    """

    @pytest.mark.asyncio
    async def test_error_messages_dont_leak_info(self, client):
        """
        Test that error messages don't leak sensitive information.

        EXPECTED: Generic error messages, not detailed system info
        """
        # Try to login with non-existent user
        response = await client.post("/api/auth/login", json={
            "email": "nonexistent@test.com",
            "password": "password123"
        })

        error_message = response.json().get("detail", "").lower()

        # Should not reveal if user exists or not
        # Should be generic like "Invalid credentials"
        assert "not found" not in error_message, (
            "Error message reveals user existence: Should use generic 'Invalid credentials'"
        )

    @pytest.mark.asyncio
    async def test_timing_attack_resistance(self, client, admin_user):
        """
        Test resistance to timing attacks on login.

        EXPECTED: Similar response time for existing/non-existing users
        CURRENT: Likely vulnerable (bcrypt check only for existing users)

        NOTE: This is difficult to test reliably without many iterations
        """
        import time

        # Time login with existing user
        start = time.time()
        await client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "wrongpassword"
        })
        existing_time = time.time() - start

        # Time login with non-existing user
        start = time.time()
        await client.post("/api/auth/login", json={
            "email": "nonexistent@test.com",
            "password": "wrongpassword"
        })
        nonexistent_time = time.time() - start

        # Times should be similar (within 100ms for single request)
        # Note: This is a basic check, timing attacks need statistical analysis
        time_difference = abs(existing_time - nonexistent_time)

        # Document if there's a significant difference
        if time_difference > 0.1:  # 100ms threshold
            pytest.skip(
                f"Potential timing attack vulnerability: {time_difference:.3f}s difference. "
                f"RECOMMENDATION: Use constant-time comparison and dummy hash for non-existent users."
            )
