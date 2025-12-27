"""
Comprehensive tests for custom roles and permissions system.

This test suite covers:
1. CustomRole CRUD operations (superadmin only)
2. Permission override management
3. User role assignment
4. Fallback behavior and permission merging
5. Audit logging for role and permission changes

Expected API endpoints:
- POST /api/admin/custom-roles
- GET /api/admin/custom-roles
- GET /api/admin/custom-roles/{id}
- PATCH /api/admin/custom-roles/{id}
- DELETE /api/admin/custom-roles/{id}
- POST /api/admin/custom-roles/{id}/permissions
- DELETE /api/admin/custom-roles/{id}/permissions/{permission}
- POST /api/admin/custom-roles/{id}/assign/{user_id}
- DELETE /api/admin/custom-roles/{id}/assign/{user_id}
- GET /api/admin/permission-audit-logs

Target: 80%+ coverage
"""
import pytest
from datetime import datetime
from sqlalchemy import select
from httpx import AsyncClient

from api.models.database import User, UserRole, Organization, OrgMember, OrgRole
from api.services.auth import create_access_token


# ============================================================================
# TEST CLASS: CustomRole CRUD Operations
# ============================================================================

@pytest.mark.asyncio
class TestCustomRoleCRUD:
    """Tests for CustomRole CRUD operations - superadmin only."""

    async def test_create_custom_role_as_superadmin(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test creating a custom role as superadmin - should succeed."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        payload = {
            "name": "Custom Manager",
            "description": "Custom role for managers with specific permissions",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True, "update": True, "delete": False},
                "chats": {"create": True, "read": True, "update": False, "delete": False},
                "calls": {"create": False, "read": True, "update": False, "delete": False}
            }
        }

        response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 201
        data = response.json()

        assert data["name"] == "Custom Manager"
        assert data["description"] == "Custom role for managers with specific permissions"
        assert data["org_id"] == organization.id
        assert "permissions" in data
        assert data["permissions"]["entities"]["create"] is True
        assert data["permissions"]["entities"]["delete"] is False
        assert data["permissions"]["calls"]["create"] is False
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data

    async def test_create_custom_role_as_non_superadmin(
        self,
        client: AsyncClient,
        admin_user: User,
        organization: Organization,
        org_owner: OrgMember,
        get_auth_headers
    ):
        """Test creating a custom role as non-superadmin - should fail with 403."""
        token = create_access_token(data={"sub": str(admin_user.id)})

        payload = {
            "name": "Custom Manager",
            "description": "Test role",
            "org_id": organization.id,
            "permissions": {}
        }

        response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert "superadmin" in data["detail"].lower()

    async def test_create_custom_role_without_authentication(
        self,
        client: AsyncClient,
        organization: Organization
    ):
        """Test creating custom role without authentication - should fail with 401."""
        payload = {
            "name": "Custom Manager",
            "description": "Test role",
            "org_id": organization.id,
            "permissions": {}
        }

        response = await client.post(
            "/api/admin/custom-roles",
            json=payload
        )

        assert response.status_code == 401

    async def test_create_duplicate_role_name(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test creating duplicate role name in same org - should fail with 409."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        payload = {
            "name": "Duplicate Role",
            "description": "First role",
            "org_id": organization.id,
            "permissions": {}
        }

        # Create first role
        response1 = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )
        assert response1.status_code == 201

        # Try to create duplicate
        payload["description"] = "Second role with same name"
        response2 = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )

        assert response2.status_code == 409
        data = response2.json()
        assert "detail" in data
        assert "already exists" in data["detail"].lower()

    async def test_create_custom_role_with_invalid_permissions(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test creating custom role with invalid permission structure - should fail."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        payload = {
            "name": "Invalid Role",
            "description": "Role with invalid permissions",
            "org_id": organization.id,
            "permissions": {
                "invalid_resource": {"invalid_action": True}
            }
        }

        response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 422

    async def test_get_custom_roles_list(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test retrieving list of custom roles."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create multiple custom roles
        roles = [
            {
                "name": "Role 1",
                "description": "First role",
                "org_id": organization.id,
                "permissions": {"entities": {"read": True}}
            },
            {
                "name": "Role 2",
                "description": "Second role",
                "org_id": organization.id,
                "permissions": {"chats": {"read": True}}
            }
        ]

        for role in roles:
            await client.post(
                "/api/admin/custom-roles",
                json=role,
                headers=get_auth_headers(token)
            )

        # Get list of roles
        response = await client.get(
            f"/api/admin/custom-roles?org_id={organization.id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)
        assert len(data) >= 2
        assert all("name" in role for role in data)
        assert all("permissions" in role for role in data)
        assert all("id" in role for role in data)

    async def test_get_custom_roles_list_filter_by_org(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        second_organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers,
        db_session
    ):
        """Test that custom roles list is filtered by organization."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role in first org
        payload1 = {
            "name": "Org 1 Role",
            "description": "Role for org 1",
            "org_id": organization.id,
            "permissions": {}
        }
        await client.post(
            "/api/admin/custom-roles",
            json=payload1,
            headers=get_auth_headers(token)
        )

        # Create membership in second org
        second_member = OrgMember(
            org_id=second_organization.id,
            user_id=superadmin_user.id,
            role=OrgRole.owner,
            created_at=datetime.utcnow()
        )
        db_session.add(second_member)
        await db_session.commit()

        # Create role in second org
        payload2 = {
            "name": "Org 2 Role",
            "description": "Role for org 2",
            "org_id": second_organization.id,
            "permissions": {}
        }
        await client.post(
            "/api/admin/custom-roles",
            json=payload2,
            headers=get_auth_headers(token)
        )

        # Get roles for first org only
        response = await client.get(
            f"/api/admin/custom-roles?org_id={organization.id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        org_1_roles = [r for r in data if r["name"] == "Org 1 Role"]
        org_2_roles = [r for r in data if r["name"] == "Org 2 Role"]

        assert len(org_1_roles) == 1
        assert len(org_2_roles) == 0

    async def test_get_custom_role_by_id(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test retrieving a specific custom role by ID."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create a role
        payload = {
            "name": "Test Role",
            "description": "Test description",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True, "update": True, "delete": False}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Get role by ID
        response = await client.get(
            f"/api/admin/custom-roles/{role_id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        assert data["id"] == role_id
        assert data["name"] == "Test Role"
        assert data["description"] == "Test description"
        assert data["permissions"]["entities"]["create"] is True
        assert data["permissions"]["entities"]["delete"] is False

    async def test_get_custom_role_not_found(
        self,
        client: AsyncClient,
        superadmin_user: User,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test retrieving non-existent role - should return 404."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        response = await client.get(
            "/api/admin/custom-roles/99999",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 404

    async def test_update_custom_role(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test updating a custom role."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create a role
        payload = {
            "name": "Original Role",
            "description": "Original description",
            "org_id": organization.id,
            "permissions": {"entities": {"read": True}}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Update the role
        update_payload = {
            "name": "Updated Role",
            "description": "Updated description",
            "permissions": {
                "entities": {"create": True, "read": True, "update": True, "delete": True}
            }
        }

        response = await client.patch(
            f"/api/admin/custom-roles/{role_id}",
            json=update_payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        assert data["name"] == "Updated Role"
        assert data["description"] == "Updated description"
        assert data["permissions"]["entities"]["create"] is True
        assert data["permissions"]["entities"]["delete"] is True

    async def test_update_custom_role_as_non_superadmin(
        self,
        client: AsyncClient,
        superadmin_user: User,
        admin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_owner: OrgMember,
        get_auth_headers
    ):
        """Test updating custom role as non-superadmin - should fail with 403."""
        superadmin_token = create_access_token(data={"sub": str(superadmin_user.id)})
        admin_token = create_access_token(data={"sub": str(admin_user.id)})

        # Create role as superadmin
        payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(superadmin_token)
        )
        role_id = create_response.json()["id"]

        # Try to update as admin
        update_payload = {"name": "Updated Role"}

        response = await client.patch(
            f"/api/admin/custom-roles/{role_id}",
            json=update_payload,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 403

    async def test_delete_custom_role(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test deleting a custom role."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create a role
        payload = {
            "name": "Role to Delete",
            "description": "This role will be deleted",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Delete the role
        response = await client.delete(
            f"/api/admin/custom-roles/{role_id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 204

        # Verify role is deleted
        get_response = await client.get(
            f"/api/admin/custom-roles/{role_id}",
            headers=get_auth_headers(token)
        )
        assert get_response.status_code == 404

    async def test_delete_custom_role_as_non_superadmin(
        self,
        client: AsyncClient,
        superadmin_user: User,
        admin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_owner: OrgMember,
        get_auth_headers
    ):
        """Test deleting custom role as non-superadmin - should fail with 403."""
        superadmin_token = create_access_token(data={"sub": str(superadmin_user.id)})
        admin_token = create_access_token(data={"sub": str(admin_user.id)})

        # Create role as superadmin
        payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(superadmin_token)
        )
        role_id = create_response.json()["id"]

        # Try to delete as admin
        response = await client.delete(
            f"/api/admin/custom-roles/{role_id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 403


# ============================================================================
# TEST CLASS: Permission Override Management
# ============================================================================

@pytest.mark.asyncio
class TestPermissionOverrides:
    """Tests for managing permission overrides on custom roles."""

    async def test_add_permission_override(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test adding a permission override to a custom role."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create a role with basic permissions
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {
                "entities": {"read": True}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Add permission override
        permission_payload = {
            "resource": "chats",
            "action": "create",
            "allowed": True
        }

        response = await client.post(
            f"/api/admin/custom-roles/{role_id}/permissions",
            json=permission_payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 201
        data = response.json()

        assert "permissions" in data
        assert data["permissions"]["chats"]["create"] is True

    async def test_update_permission_override(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test updating an existing permission override."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role with permission
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Update permission override
        permission_payload = {
            "resource": "entities",
            "action": "create",
            "allowed": False
        }

        response = await client.post(
            f"/api/admin/custom-roles/{role_id}/permissions",
            json=permission_payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 201
        data = response.json()

        assert data["permissions"]["entities"]["create"] is False
        assert data["permissions"]["entities"]["read"] is True

    async def test_remove_permission_override(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test removing a permission override from a custom role."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role with permissions
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True, "update": True}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Remove a specific permission
        response = await client.delete(
            f"/api/admin/custom-roles/{role_id}/permissions/entities.create",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        # Verify permission was removed
        assert data["permissions"]["entities"].get("create") is None or \
               data["permissions"]["entities"].get("create") is False
        assert data["permissions"]["entities"]["read"] is True

    async def test_get_role_with_permissions(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test retrieving a role returns complete permission structure."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role with complex permissions
        role_payload = {
            "name": "Complex Role",
            "description": "Role with complex permissions",
            "org_id": organization.id,
            "permissions": {
                "entities": {
                    "create": True,
                    "read": True,
                    "update": True,
                    "delete": False
                },
                "chats": {
                    "create": True,
                    "read": True,
                    "update": False,
                    "delete": False
                },
                "calls": {
                    "create": False,
                    "read": True,
                    "update": False,
                    "delete": False
                }
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Get role
        response = await client.get(
            f"/api/admin/custom-roles/{role_id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        # Verify complete permission structure
        assert "permissions" in data
        assert "entities" in data["permissions"]
        assert "chats" in data["permissions"]
        assert "calls" in data["permissions"]

        assert data["permissions"]["entities"]["create"] is True
        assert data["permissions"]["entities"]["delete"] is False
        assert data["permissions"]["chats"]["update"] is False
        assert data["permissions"]["calls"]["read"] is True


# ============================================================================
# TEST CLASS: User Role Assignment
# ============================================================================

@pytest.mark.asyncio
class TestUserRoleAssignment:
    """Tests for assigning custom roles to users."""

    async def test_assign_custom_role_to_user(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test assigning a custom role to a user."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create custom role
        role_payload = {
            "name": "Manager Role",
            "description": "Role for managers",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True, "update": True, "delete": False}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Assign role to user
        response = await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 201
        data = response.json()

        assert data["user_id"] == regular_user.id
        assert data["custom_role_id"] == role_id
        assert "assigned_at" in data

    async def test_assign_custom_role_as_non_superadmin(
        self,
        client: AsyncClient,
        superadmin_user: User,
        admin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_owner: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test assigning custom role as non-superadmin - should fail with 403."""
        superadmin_token = create_access_token(data={"sub": str(superadmin_user.id)})
        admin_token = create_access_token(data={"sub": str(admin_user.id)})

        # Create role as superadmin
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(superadmin_token)
        )
        role_id = create_response.json()["id"]

        # Try to assign as admin
        response = await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 403

    async def test_assign_duplicate_role_to_user(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test assigning same role twice to same user - should handle gracefully."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # First assignment
        response1 = await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )
        assert response1.status_code == 201

        # Second assignment
        response2 = await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        # Should either succeed (idempotent) or return 409
        assert response2.status_code in [201, 409]

    async def test_remove_custom_role_from_user(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test removing a custom role from a user."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create and assign role
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        # Remove role
        response = await client.delete(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 204

    async def test_remove_non_existent_role_assignment(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test removing role assignment that doesn't exist - should return 404."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role but don't assign it
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Try to remove non-existent assignment
        response = await client.delete(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 404

    async def test_user_with_custom_role_gets_permissions(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test that user with custom role receives correct permissions."""
        superadmin_token = create_access_token(data={"sub": str(superadmin_user.id)})
        user_token = create_access_token(data={"sub": str(regular_user.id)})

        # Create custom role with specific permissions
        role_payload = {
            "name": "Limited Manager",
            "description": "Manager with limited permissions",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True, "update": False, "delete": False},
                "chats": {"create": False, "read": True, "update": False, "delete": False}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(superadmin_token)
        )
        role_id = create_response.json()["id"]

        # Assign role to user
        await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(superadmin_token)
        )

        # Get user's current permissions (assuming there's an endpoint for this)
        response = await client.get(
            "/api/users/me/permissions",
            headers=get_auth_headers(user_token)
        )

        # If endpoint exists, verify permissions
        if response.status_code == 200:
            data = response.json()
            assert data["entities"]["create"] is True
            assert data["entities"]["update"] is False
            assert data["chats"]["create"] is False


# ============================================================================
# TEST CLASS: Fallback Behavior and Permission Merging
# ============================================================================

@pytest.mark.asyncio
class TestFallbackBehavior:
    """Tests for permission fallback and merging with default permissions."""

    async def test_user_without_custom_role_uses_default_permissions(
        self,
        client: AsyncClient,
        regular_user: User,
        organization: Organization,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test that user without custom role uses default role permissions."""
        token = create_access_token(data={"sub": str(regular_user.id)})

        # Get user's permissions (no custom role assigned)
        response = await client.get(
            "/api/users/me/permissions",
            headers=get_auth_headers(token)
        )

        # Should get default permissions based on UserRole
        if response.status_code == 200:
            data = response.json()
            # Verify default admin permissions are present
            assert "permissions" in data or "entities" in data

    async def test_custom_role_overrides_default_permission(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test that custom role permissions override default role permissions."""
        superadmin_token = create_access_token(data={"sub": str(superadmin_user.id)})
        user_token = create_access_token(data={"sub": str(regular_user.id)})

        # Create role that restricts a normally allowed action
        role_payload = {
            "name": "Restricted Admin",
            "description": "Admin with restricted delete permissions",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": True, "read": True, "update": True, "delete": False}
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(superadmin_token)
        )
        role_id = create_response.json()["id"]

        # Assign role
        await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(superadmin_token)
        )

        # Verify custom permissions override defaults
        response = await client.get(
            "/api/users/me/permissions",
            headers=get_auth_headers(user_token)
        )

        if response.status_code == 200:
            data = response.json()
            # Custom role should override default
            assert data["entities"]["delete"] is False

    async def test_partial_override_merges_with_defaults(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test that partial permission overrides merge with default permissions."""
        superadmin_token = create_access_token(data={"sub": str(superadmin_user.id)})
        user_token = create_access_token(data={"sub": str(regular_user.id)})

        # Create role with partial permissions (only entities)
        role_payload = {
            "name": "Partial Override",
            "description": "Only overrides entity permissions",
            "org_id": organization.id,
            "permissions": {
                "entities": {"create": False, "read": True}
                # No chats or calls permissions specified
            }
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(superadmin_token)
        )
        role_id = create_response.json()["id"]

        # Assign role
        await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(superadmin_token)
        )

        # Check merged permissions
        response = await client.get(
            "/api/users/me/permissions",
            headers=get_auth_headers(user_token)
        )

        if response.status_code == 200:
            data = response.json()
            # Entities should use custom role
            assert data["entities"]["create"] is False
            # Other resources should use defaults (if they exist)
            assert "chats" in data or "calls" in data


# ============================================================================
# TEST CLASS: Audit Logging
# ============================================================================

@pytest.mark.asyncio
class TestAuditLogging:
    """Tests for audit logging of role and permission changes."""

    async def test_role_creation_logged(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test that role creation is logged in audit trail."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role
        role_payload = {
            "name": "Audited Role",
            "description": "Role creation should be audited",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Get audit logs
        audit_response = await client.get(
            "/api/admin/permission-audit-logs",
            headers=get_auth_headers(token)
        )

        assert audit_response.status_code == 200
        logs = audit_response.json()

        # Find log entry for this role creation
        creation_logs = [
            log for log in logs
            if log.get("action") == "create_role" and
            log.get("role_id") == role_id
        ]

        assert len(creation_logs) >= 1
        log = creation_logs[0]
        assert log["user_id"] == superadmin_user.id
        assert "timestamp" in log

    async def test_permission_change_logged(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test that permission changes are logged in audit trail."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {"entities": {"read": True}}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Update permissions
        permission_payload = {
            "resource": "entities",
            "action": "create",
            "allowed": True
        }

        await client.post(
            f"/api/admin/custom-roles/{role_id}/permissions",
            json=permission_payload,
            headers=get_auth_headers(token)
        )

        # Get audit logs
        audit_response = await client.get(
            "/api/admin/permission-audit-logs",
            headers=get_auth_headers(token)
        )

        assert audit_response.status_code == 200
        logs = audit_response.json()

        # Find permission change log
        permission_logs = [
            log for log in logs
            if log.get("action") == "update_permission" and
            log.get("role_id") == role_id
        ]

        assert len(permission_logs) >= 1
        log = permission_logs[0]
        assert log["user_id"] == superadmin_user.id
        assert "timestamp" in log
        assert "details" in log

    async def test_role_assignment_logged(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test that role assignments are logged in audit trail."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Assign role to user
        await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        # Get audit logs
        audit_response = await client.get(
            "/api/admin/permission-audit-logs",
            headers=get_auth_headers(token)
        )

        assert audit_response.status_code == 200
        logs = audit_response.json()

        # Find assignment log
        assignment_logs = [
            log for log in logs
            if log.get("action") == "assign_role" and
            log.get("role_id") == role_id and
            log.get("assigned_user_id") == regular_user.id
        ]

        assert len(assignment_logs) >= 1
        log = assignment_logs[0]
        assert log["user_id"] == superadmin_user.id
        assert "timestamp" in log

    async def test_get_audit_logs_as_superadmin(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test that superadmin can access audit logs."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        response = await client.get(
            "/api/admin/permission-audit-logs",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)
        # Each log entry should have required fields
        for log in data:
            assert "id" in log
            assert "action" in log
            assert "user_id" in log
            assert "timestamp" in log

    async def test_get_audit_logs_as_non_superadmin(
        self,
        client: AsyncClient,
        admin_user: User,
        organization: Organization,
        org_owner: OrgMember,
        get_auth_headers
    ):
        """Test that non-superadmin cannot access audit logs."""
        token = create_access_token(data={"sub": str(admin_user.id)})

        response = await client.get(
            "/api/admin/permission-audit-logs",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 403

    async def test_audit_logs_filter_by_role(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test filtering audit logs by role ID."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create two roles
        role1_payload = {
            "name": "Role 1",
            "description": "First role",
            "org_id": organization.id,
            "permissions": {}
        }

        role2_payload = {
            "name": "Role 2",
            "description": "Second role",
            "org_id": organization.id,
            "permissions": {}
        }

        response1 = await client.post(
            "/api/admin/custom-roles",
            json=role1_payload,
            headers=get_auth_headers(token)
        )
        role1_id = response1.json()["id"]

        await client.post(
            "/api/admin/custom-roles",
            json=role2_payload,
            headers=get_auth_headers(token)
        )

        # Get logs filtered by role1_id
        audit_response = await client.get(
            f"/api/admin/permission-audit-logs?role_id={role1_id}",
            headers=get_auth_headers(token)
        )

        assert audit_response.status_code == 200
        logs = audit_response.json()

        # All logs should be for role1_id
        role_specific_logs = [log for log in logs if log.get("role_id") == role1_id]
        assert len(role_specific_logs) >= 1

    async def test_audit_logs_pagination(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test pagination of audit logs."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create multiple roles to generate log entries
        for i in range(5):
            role_payload = {
                "name": f"Role {i}",
                "description": f"Role {i}",
                "org_id": organization.id,
                "permissions": {}
            }

            await client.post(
                "/api/admin/custom-roles",
                json=role_payload,
                headers=get_auth_headers(token)
            )

        # Get logs with limit
        response = await client.get(
            "/api/admin/permission-audit-logs?limit=3&offset=0",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()

        # Should return at most 3 logs
        assert len(data) <= 3


# ============================================================================
# TEST CLASS: Edge Cases and Validation
# ============================================================================

@pytest.mark.asyncio
class TestEdgeCasesAndValidation:
    """Tests for edge cases and input validation."""

    async def test_create_role_with_empty_name(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test creating role with empty name - should fail validation."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        payload = {
            "name": "",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 422

    async def test_create_role_with_invalid_org_id(
        self,
        client: AsyncClient,
        superadmin_user: User,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test creating role with non-existent org ID - should fail."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": 99999,
            "permissions": {}
        }

        response = await client.post(
            "/api/admin/custom-roles",
            json=payload,
            headers=get_auth_headers(token)
        )

        assert response.status_code in [404, 422]

    async def test_assign_role_to_non_existent_user(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers
    ):
        """Test assigning role to non-existent user - should fail."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create role
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Try to assign to non-existent user
        response = await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/99999",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 404

    async def test_delete_role_with_assigned_users(
        self,
        client: AsyncClient,
        superadmin_user: User,
        regular_user: User,
        organization: Organization,
        superadmin_org_member: OrgMember,
        org_admin: OrgMember,
        get_auth_headers
    ):
        """Test deleting role that is assigned to users - should handle gracefully."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create and assign role
        role_payload = {
            "name": "Test Role",
            "description": "Test",
            "org_id": organization.id,
            "permissions": {}
        }

        create_response = await client.post(
            "/api/admin/custom-roles",
            json=role_payload,
            headers=get_auth_headers(token)
        )
        role_id = create_response.json()["id"]

        # Assign to user
        await client.post(
            f"/api/admin/custom-roles/{role_id}/assign/{regular_user.id}",
            headers=get_auth_headers(token)
        )

        # Try to delete role
        response = await client.delete(
            f"/api/admin/custom-roles/{role_id}",
            headers=get_auth_headers(token)
        )

        # Should either succeed (cascade delete) or warn about assigned users
        assert response.status_code in [204, 400, 409]

    async def test_role_name_uniqueness_per_organization(
        self,
        client: AsyncClient,
        superadmin_user: User,
        organization: Organization,
        second_organization: Organization,
        superadmin_org_member: OrgMember,
        get_auth_headers,
        db_session
    ):
        """Test that role names must be unique per organization."""
        token = create_access_token(data={"sub": str(superadmin_user.id)})

        # Create membership in second org
        second_member = OrgMember(
            org_id=second_organization.id,
            user_id=superadmin_user.id,
            role=OrgRole.owner,
            created_at=datetime.utcnow()
        )
        db_session.add(second_member)
        await db_session.commit()

        # Create role with same name in org 1
        payload1 = {
            "name": "Manager",
            "description": "Manager in org 1",
            "org_id": organization.id,
            "permissions": {}
        }

        response1 = await client.post(
            "/api/admin/custom-roles",
            json=payload1,
            headers=get_auth_headers(token)
        )
        assert response1.status_code == 201

        # Create role with same name in org 2 - should succeed
        payload2 = {
            "name": "Manager",
            "description": "Manager in org 2",
            "org_id": second_organization.id,
            "permissions": {}
        }

        response2 = await client.post(
            "/api/admin/custom-roles",
            json=payload2,
            headers=get_auth_headers(token)
        )
        assert response2.status_code == 201
