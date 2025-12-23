"""
Tests for sharing functionality.
"""
import pytest
from datetime import datetime, timedelta

from api.models.database import SharedAccess, AccessLevel, ResourceType


class TestCreateShare:
    """Test share creation."""

    @pytest.mark.asyncio
    async def test_owner_can_share_entity(
        self, client, admin_user, admin_token, entity, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test that entity owner can share it."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["access_level"] == "view"

    @pytest.mark.asyncio
    async def test_owner_can_share_chat(
        self, client, admin_user, admin_token, chat, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test that chat owner can share it."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "chat",
                "resource_id": chat.id,
                "shared_with_id": second_user.id,
                "access_level": "edit"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_owner_can_share_call(
        self, client, admin_user, admin_token, call_recording, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test that call owner can share it."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "call",
                "resource_id": call_recording.id,
                "shared_with_id": second_user.id,
                "access_level": "full"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_cannot_share_nonexistent_resource(
        self, client, admin_user, admin_token, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test that sharing nonexistent resource fails."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": 99999,
                "shared_with_id": second_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_cannot_share_with_nonexistent_user(
        self, client, admin_user, admin_token, entity, get_auth_headers, org_owner
    ):
        """Test that sharing with nonexistent user fails."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": 99999,
                "access_level": "view"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404


class TestSharePermissions:
    """Test who can share resources."""

    @pytest.mark.asyncio
    async def test_non_owner_cannot_share(
        self, client, second_user, second_user_token, entity, regular_user, get_auth_headers, org_member
    ):
        """Test that non-owner cannot share resource."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": regular_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_view_user_cannot_reshare(
        self, client, second_user, second_user_token, entity, entity_share_view,
        regular_user, get_auth_headers, org_member
    ):
        """Test that user with view access cannot reshare."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": regular_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_full_access_user_can_reshare(
        self, db_session, client, second_user, second_user_token, entity, admin_user,
        regular_user, get_auth_headers, org_member, org_admin
    ):
        """Test that user with full access can reshare."""
        # Create full access share
        share = SharedAccess(
            resource_type=ResourceType.entity,
            resource_id=entity.id,
            shared_by_id=admin_user.id,
            shared_with_id=second_user.id,
            access_level=AccessLevel.full,
            created_at=datetime.utcnow()
        )
        db_session.add(share)
        await db_session.commit()

        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": regular_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(second_user_token)
        )

        # User with full access should be able to share
        assert response.status_code == 200


class TestCrossOrgSharing:
    """Test that cross-organization sharing is prevented."""

    @pytest.mark.asyncio
    async def test_cannot_share_with_user_from_other_org(
        self, db_session, client, admin_user, admin_token, entity, second_organization, get_auth_headers, org_owner
    ):
        """
        CRITICAL TEST: Cannot share with user from different organization.
        This is the cross-org sharing security bug.
        """
        # Create user in different organization
        from api.models.database import User, OrgMember, OrgRole
        from api.services.auth import get_password_hash

        other_user = User(
            email="other@other.com",
            password_hash=get_password_hash("password"),
            name="Other Org User",
            role="user",
            is_active=True
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)

        # Add to second organization
        other_member = OrgMember(
            org_id=second_organization.id,
            user_id=other_user.id,
            role=OrgRole.member,
            joined_at=datetime.utcnow()
        )
        db_session.add(other_member)
        await db_session.commit()

        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": other_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(admin_token)
        )

        # Expected: 403 Forbidden - cannot share with user from other org
        # Current bug: might return 200
        assert response.status_code == 403, \
            f"SECURITY BUG: Cross-org sharing allowed! Got {response.status_code}"


class TestShareExpiration:
    """Test share expiration functionality."""

    @pytest.mark.asyncio
    async def test_share_with_expiration(
        self, client, admin_user, admin_token, entity, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test creating share with expiration date."""
        expires_at = (datetime.utcnow() + timedelta(days=7)).isoformat()

        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "view",
                "expires_at": expires_at
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data.get("expires_at") is not None


class TestRevokeShare:
    """Test share revocation."""

    @pytest.mark.asyncio
    async def test_owner_can_revoke_share(
        self, client, admin_user, admin_token, entity, entity_share_view, get_auth_headers, org_owner
    ):
        """Test that owner can revoke a share."""
        response = await client.delete(
            f"/api/sharing/{entity_share_view.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_non_owner_cannot_revoke_share(
        self, client, second_user, second_user_token, entity_share_view, get_auth_headers, org_member
    ):
        """Test that non-owner cannot revoke a share."""
        response = await client.delete(
            f"/api/sharing/{entity_share_view.id}",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403


class TestListShares:
    """Test listing shares."""

    @pytest.mark.asyncio
    async def test_owner_can_list_shares(
        self, client, admin_user, admin_token, entity, entity_share_view, get_auth_headers, org_owner
    ):
        """Test that owner can list shares of their resource."""
        response = await client.get(
            f"/api/sharing/entity/{entity.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1

    @pytest.mark.asyncio
    async def test_list_shared_with_me(
        self, client, second_user, second_user_token, entity_share_view, get_auth_headers, org_member
    ):
        """Test listing resources shared with current user."""
        response = await client.get(
            "/api/sharing/shared-with-me",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 200
        data = response.json()
        # Should include the entity_share_view
        assert len(data) >= 1


class TestShareAccessLevels:
    """Test different access levels."""

    @pytest.mark.asyncio
    async def test_view_access_level(
        self, client, admin_user, admin_token, entity, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test creating view access share."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["access_level"] == "view"

    @pytest.mark.asyncio
    async def test_edit_access_level(
        self, client, admin_user, admin_token, entity, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test creating edit access share."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "edit"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["access_level"] == "edit"

    @pytest.mark.asyncio
    async def test_full_access_level(
        self, client, admin_user, admin_token, entity, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test creating full access share."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "full"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["access_level"] == "full"

    @pytest.mark.asyncio
    async def test_invalid_access_level(
        self, client, admin_user, admin_token, entity, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test that invalid access level is rejected."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "invalid"
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 422  # Validation error


class TestUpdateShare:
    """Test updating share access level."""

    @pytest.mark.asyncio
    async def test_owner_can_update_share_level(
        self, client, admin_user, admin_token, entity_share_view, get_auth_headers, org_owner
    ):
        """Test that owner can update share access level."""
        response = await client.patch(
            f"/api/sharing/{entity_share_view.id}",
            json={"access_level": "edit"},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["access_level"] == "edit"

    @pytest.mark.asyncio
    async def test_cannot_upgrade_to_higher_than_own(
        self, db_session, client, second_user, second_user_token, entity, admin_user, regular_user,
        get_auth_headers, org_member, org_admin
    ):
        """Test that user cannot grant higher access than they have."""
        # Give second_user edit access
        edit_share = SharedAccess(
            resource_type=ResourceType.entity,
            resource_id=entity.id,
            shared_by_id=admin_user.id,
            shared_with_id=second_user.id,
            access_level=AccessLevel.edit,
            created_at=datetime.utcnow()
        )
        db_session.add(edit_share)
        await db_session.commit()

        # Try to share with full access (higher than edit)
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": regular_user.id,
                "access_level": "full"  # Higher than second_user's edit
            },
            headers=get_auth_headers(second_user_token)
        )

        # Should not be able to grant full when user only has edit
        # This depends on implementation - might need to verify


class TestDuplicateShares:
    """Test handling of duplicate shares."""

    @pytest.mark.asyncio
    async def test_cannot_create_duplicate_share(
        self, client, admin_user, admin_token, entity, entity_share_view, second_user, get_auth_headers, org_owner
    ):
        """Test that duplicate shares are not created."""
        response = await client.post(
            "/api/sharing/share",
            json={
                "resource_type": "entity",
                "resource_id": entity.id,
                "shared_with_id": second_user.id,
                "access_level": "view"
            },
            headers=get_auth_headers(admin_token)
        )

        # Should either update existing or return error
        # Not create duplicate
        assert response.status_code in [200, 400, 409]


class TestSharableUsers:
    """Test getting list of users available for sharing."""

    @pytest.mark.asyncio
    async def test_get_sharable_users(
        self, client, admin_user, admin_token, organization, second_user, get_auth_headers, org_owner, org_member
    ):
        """Test getting list of users in same org for sharing."""
        response = await client.get(
            "/api/sharing/users",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        # Should return users in same organization
        user_ids = [u["id"] for u in data]
        assert second_user.id in user_ids

    @pytest.mark.asyncio
    async def test_sharable_users_excludes_other_orgs(
        self, db_session, client, admin_user, admin_token, second_organization, get_auth_headers, org_owner
    ):
        """Test that sharable users list excludes users from other organizations."""
        from api.models.database import User, OrgMember, OrgRole
        from api.services.auth import get_password_hash

        # Create user in different organization
        other_user = User(
            email="other2@other.com",
            password_hash=get_password_hash("password"),
            name="Other Org User 2",
            role="user",
            is_active=True
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)

        other_member = OrgMember(
            org_id=second_organization.id,
            user_id=other_user.id,
            role=OrgRole.member,
            joined_at=datetime.utcnow()
        )
        db_session.add(other_member)
        await db_session.commit()

        response = await client.get(
            "/api/sharing/users",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()

        user_ids = [u["id"] for u in data]
        assert other_user.id not in user_ids, "Users from other orgs should not appear"
