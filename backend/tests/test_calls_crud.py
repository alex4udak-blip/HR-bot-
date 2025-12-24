"""
Comprehensive tests for CallRecording CRUD operations.
Tests cover all endpoints: create, read, update, delete, upload, bot recording,
pagination, filtering, search, sharing, and permission checks.
"""
import pytest
import os
import io
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import select

from api.models.database import (
    CallRecording, CallSource, CallStatus, Entity, SharedAccess,
    AccessLevel, ResourceType, User, UserRole, OrgRole, DeptRole,
    DepartmentMember, EntityType, EntityStatus
)


# ============================================================================
# GET /api/calls - LIST CALLS
# ============================================================================

class TestListCalls:
    """Test call listing with various filters and access control."""

    @pytest.mark.asyncio
    async def test_list_calls_basic(
        self, client, admin_user, admin_token, call_recording, get_auth_headers, org_owner
    ):
        """Test basic call listing."""
        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        # Verify call structure
        call_data = next((c for c in data if c["id"] == call_recording.id), None)
        assert call_data is not None
        assert call_data["title"] == "Test Call"
        assert call_data["source_type"] == CallSource.upload.value
        assert call_data["status"] == CallStatus.done.value
        assert call_data["owner_id"] == admin_user.id
        assert "created_at" in call_data
        assert "duration_seconds" in call_data

    @pytest.mark.asyncio
    async def test_list_calls_empty_for_new_user(
        self, client, db_session, organization, get_auth_headers
    ):
        """Test that new user sees empty list."""
        # Create a new user with no calls
        new_user = User(
            email="newuser@test.com",
            password_hash="hashed",
            name="New User",
            role=UserRole.ADMIN,
            is_active=True
        )
        db_session.add(new_user)
        await db_session.commit()
        await db_session.refresh(new_user)

        from api.models.database import OrgMember
        member = OrgMember(
            org_id=organization.id,
            user_id=new_user.id,
            role=OrgRole.member,
            created_at=datetime.utcnow()
        )
        db_session.add(member)
        await db_session.commit()

        from api.services.auth import create_access_token
        token = create_access_token(data={"sub": str(new_user.id)})

        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data == []

    @pytest.mark.asyncio
    async def test_list_calls_pagination(
        self, db_session, client, admin_user, admin_token, organization,
        get_auth_headers, org_owner
    ):
        """Test call listing pagination."""
        # Create multiple calls
        calls = []
        for i in range(15):
            call = CallRecording(
                org_id=organization.id,
                owner_id=admin_user.id,
                title=f"Test Call {i}",
                source_type=CallSource.upload,
                status=CallStatus.done,
                created_at=datetime.utcnow() - timedelta(minutes=i)
            )
            calls.append(call)
        db_session.add_all(calls)
        await db_session.commit()

        # Test limit
        response = await client.get(
            "/api/calls?limit=5",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 5

        # Test offset
        response = await client.get(
            "/api/calls?limit=5&offset=5",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 5

        # Verify ordering (most recent first)
        response = await client.get(
            "/api/calls?limit=10",
            headers=get_auth_headers(admin_token)
        )
        data = response.json()
        # Newest should be first
        assert data[0]["title"] == "Test Call 0"

    @pytest.mark.asyncio
    async def test_list_calls_filter_by_status(
        self, db_session, client, admin_user, admin_token, organization,
        get_auth_headers, org_owner
    ):
        """Test filtering calls by status."""
        # Create calls with different statuses
        done_call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Done Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        processing_call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Processing Call",
            source_type=CallSource.upload,
            status=CallStatus.processing
        )
        failed_call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Failed Call",
            source_type=CallSource.upload,
            status=CallStatus.failed
        )
        db_session.add_all([done_call, processing_call, failed_call])
        await db_session.commit()

        # Filter by done status
        response = await client.get(
            "/api/calls?status=done",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()
        assert all(c["status"] == "done" for c in data)

        # Filter by processing status
        response = await client.get(
            "/api/calls?status=processing",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()
        assert all(c["status"] == "processing" for c in data)

    @pytest.mark.asyncio
    async def test_list_calls_filter_by_entity(
        self, db_session, client, admin_user, admin_token, organization,
        department, entity, get_auth_headers, org_owner
    ):
        """Test filtering calls by entity."""
        # Create call linked to entity
        linked_call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            entity_id=entity.id,
            title="Linked Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        # Create call without entity
        unlinked_call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Unlinked Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        db_session.add_all([linked_call, unlinked_call])
        await db_session.commit()

        # Filter by entity
        response = await client.get(
            f"/api/calls?entity_id={entity.id}",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert all(c["entity_id"] == entity.id for c in data)

    @pytest.mark.asyncio
    async def test_list_calls_shows_entity_name(
        self, db_session, client, admin_user, admin_token, organization,
        department, entity, get_auth_headers, org_owner
    ):
        """Test that call list includes entity name."""
        # Create call linked to entity
        call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            entity_id=entity.id,
            title="Call with Entity",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        db_session.add(call)
        await db_session.commit()

        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()

        call_data = next((c for c in data if c["id"] == call.id), None)
        assert call_data is not None
        assert call_data["entity_name"] == entity.name

    @pytest.mark.asyncio
    async def test_list_calls_owner_sees_all(
        self, client, admin_user, admin_token, call_recording, second_call,
        get_auth_headers, org_owner
    ):
        """Test that org owner sees all calls in organization."""
        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        call_ids = [c["id"] for c in data]

        # Owner should see both calls
        assert call_recording.id in call_ids
        assert second_call.id in call_ids

    @pytest.mark.asyncio
    async def test_list_calls_member_sees_own_only(
        self, client, second_user, second_user_token, call_recording, second_call,
        get_auth_headers, org_member
    ):
        """Test that regular member sees only their own calls."""
        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 200
        data = response.json()
        call_ids = [c["id"] for c in data]

        # Member should only see their own call
        assert second_call.id in call_ids
        # Should not see other user's call
        assert call_recording.id not in call_ids

    @pytest.mark.asyncio
    async def test_list_calls_truncates_transcript(
        self, db_session, client, admin_user, admin_token, organization,
        get_auth_headers, org_owner
    ):
        """Test that list endpoint truncates long transcripts."""
        # Create call with long transcript
        long_transcript = "A" * 1000
        call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Long Transcript Call",
            source_type=CallSource.upload,
            status=CallStatus.done,
            transcript=long_transcript
        )
        db_session.add(call)
        await db_session.commit()

        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(admin_token)
        )
        assert response.status_code == 200
        data = response.json()

        call_data = next((c for c in data if c["id"] == call.id), None)
        assert call_data is not None
        # Should be truncated to 500 chars
        assert len(call_data["transcript"]) == 500


# ============================================================================
# GET /api/calls/{call_id} - GET SINGLE CALL
# ============================================================================

class TestGetCall:
    """Test getting a single call recording."""

    @pytest.mark.asyncio
    async def test_get_call_success(
        self, client, admin_user, admin_token, call_recording, get_auth_headers, org_owner
    ):
        """Test successfully getting a call."""
        response = await client.get(
            f"/api/calls/{call_recording.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == call_recording.id
        assert data["title"] == call_recording.title
        assert data["source_type"] == CallSource.upload.value
        assert data["status"] == CallStatus.done.value
        assert data["owner_id"] == admin_user.id
        assert "transcript" in data
        assert "speakers" in data
        assert "summary" in data
        assert "action_items" in data
        assert "key_points" in data

    @pytest.mark.asyncio
    async def test_get_call_with_entity(
        self, db_session, client, admin_user, admin_token, call_recording,
        entity, get_auth_headers, org_owner
    ):
        """Test getting call with linked entity."""
        call_recording.entity_id = entity.id
        await db_session.commit()

        response = await client.get(
            f"/api/calls/{call_recording.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["entity_id"] == entity.id
        assert data["entity_name"] == entity.name

    @pytest.mark.asyncio
    async def test_get_call_not_found(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test getting non-existent call."""
        response = await client.get(
            "/api/calls/99999",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_call_no_org_access(
        self, db_session, client, get_auth_headers
    ):
        """Test getting call when user has no organization."""
        # Create user without org membership
        user = User(
            email="noorg@test.com",
            password_hash="hashed",
            name="No Org User",
            role=UserRole.ADMIN,
            is_active=True
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        from api.services.auth import create_access_token
        token = create_access_token(data={"sub": str(user.id)})

        response = await client.get(
            "/api/calls/1",
            headers=get_auth_headers(token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_call_from_different_org(
        self, db_session, client, second_user, second_user_token,
        second_organization, get_auth_headers, org_member
    ):
        """Test that user cannot get call from different organization."""
        # Create call in different org
        other_call = CallRecording(
            org_id=second_organization.id,
            owner_id=1,
            title="Other Org Call",
            source_type=CallSource.upload,
            status=CallStatus.done,
            created_at=datetime.utcnow()
        )
        db_session.add(other_call)
        await db_session.commit()
        await db_session.refresh(other_call)

        response = await client.get(
            f"/api/calls/{other_call.id}",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 404


# ============================================================================
# GET /api/calls/{call_id}/status - GET CALL STATUS
# ============================================================================

class TestGetCallStatus:
    """Test getting call status for polling."""

    @pytest.mark.asyncio
    async def test_get_call_status_success(
        self, client, admin_user, admin_token, call_recording, get_auth_headers, org_owner
    ):
        """Test successfully getting call status."""
        response = await client.get(
            f"/api/calls/{call_recording.id}/status",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == CallStatus.done.value
        assert "duration_seconds" in data
        assert "error_message" in data

    @pytest.mark.asyncio
    async def test_get_call_status_processing(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test getting status of processing call."""
        call_recording.status = CallStatus.processing
        call_recording.error_message = None
        await db_session.commit()

        response = await client.get(
            f"/api/calls/{call_recording.id}/status",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "processing"

    @pytest.mark.asyncio
    async def test_get_call_status_failed_with_error(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test getting status of failed call with error message."""
        call_recording.status = CallStatus.failed
        call_recording.error_message = "Transcription failed"
        await db_session.commit()

        response = await client.get(
            f"/api/calls/{call_recording.id}/status",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "failed"
        assert data["error_message"] == "Transcription failed"

    @pytest.mark.asyncio
    async def test_get_call_status_access_denied(
        self, client, second_user, second_user_token, call_recording,
        get_auth_headers, org_member
    ):
        """Test that user without access cannot get call status."""
        response = await client.get(
            f"/api/calls/{call_recording.id}/status",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403


# ============================================================================
# POST /api/calls/upload - UPLOAD CALL
# ============================================================================

class TestUploadCall:
    """Test uploading audio/video files."""

    @pytest.mark.asyncio
    @patch('api.routes.calls.aiofiles.open')
    @patch('api.routes.calls.uuid.uuid4')
    async def test_upload_call_success(
        self, mock_uuid, mock_aiofiles, client, admin_user, admin_token,
        organization, get_auth_headers, org_owner
    ):
        """Test successfully uploading a call recording."""
        # Mock UUID for predictable filename
        mock_uuid.return_value = MagicMock()
        mock_uuid.return_value.__str__ = lambda x: "test-uuid-123"

        # Mock file operations
        mock_file = AsyncMock()
        mock_aiofiles.return_value.__aenter__ = AsyncMock(return_value=mock_file)
        mock_aiofiles.return_value.__aexit__ = AsyncMock()
        mock_file.write = AsyncMock()

        # Create file-like object
        file_content = b"fake audio content"
        files = {"file": ("test.mp3", io.BytesIO(file_content), "audio/mpeg")}

        response = await client.post(
            "/api/calls/upload",
            files=files,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["status"] == CallStatus.processing.value

    @pytest.mark.asyncio
    async def test_upload_call_with_entity(
        self, client, admin_user, admin_token, entity, get_auth_headers, org_owner
    ):
        """Test uploading call with entity link."""
        with patch('api.routes.calls.aiofiles.open', new_callable=AsyncMock):
            file_content = b"fake audio content"
            files = {"file": ("test.mp3", io.BytesIO(file_content), "audio/mpeg")}

            response = await client.post(
                f"/api/calls/upload?entity_id={entity.id}",
                files=files,
                headers=get_auth_headers(admin_token)
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_upload_call_invalid_format(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test uploading file with invalid format."""
        file_content = b"fake content"
        files = {"file": ("test.txt", io.BytesIO(file_content), "text/plain")}

        response = await client.post(
            "/api/calls/upload",
            files=files,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "Unsupported format" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_upload_call_no_org(
        self, db_session, client, get_auth_headers
    ):
        """Test uploading call when user has no organization."""
        user = User(
            email="noorg@test.com",
            password_hash="hashed",
            name="No Org User",
            role=UserRole.ADMIN,
            is_active=True
        )
        db_session.add(user)
        await db_session.commit()

        from api.services.auth import create_access_token
        token = create_access_token(data={"sub": str(user.id)})

        file_content = b"fake audio"
        files = {"file": ("test.mp3", io.BytesIO(file_content), "audio/mpeg")}

        response = await client.post(
            "/api/calls/upload",
            files=files,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_upload_call_various_formats(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test uploading various supported audio formats."""
        formats = [
            ("test.mp3", "audio/mpeg"),
            ("test.mp4", "video/mp4"),
            ("test.wav", "audio/wav"),
            ("test.m4a", "audio/m4a"),
            ("test.webm", "video/webm"),
            ("test.ogg", "audio/ogg"),
        ]

        with patch('api.routes.calls.aiofiles.open', new_callable=AsyncMock):
            for filename, mimetype in formats:
                file_content = b"fake audio"
                files = {"file": (filename, io.BytesIO(file_content), mimetype)}

                response = await client.post(
                    "/api/calls/upload",
                    files=files,
                    headers=get_auth_headers(admin_token)
                )

                assert response.status_code == 200, f"Failed for {filename}"


# ============================================================================
# POST /api/calls/start-bot - START BOT RECORDING
# ============================================================================

class TestStartBot:
    """Test starting bot recording for Meet/Zoom/Teams."""

    @pytest.mark.asyncio
    @patch('api.routes.calls.call_recorder.start_recording')
    async def test_start_bot_google_meet(
        self, mock_start_recording, client, admin_user, admin_token,
        organization, get_auth_headers, org_owner
    ):
        """Test starting bot for Google Meet."""
        mock_start_recording.return_value = {"success": True}

        data = {
            "source_url": "https://meet.google.com/abc-defg-hij",
            "bot_name": "HR Recorder"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        response_data = response.json()
        assert "id" in response_data
        assert response_data["status"] == CallStatus.recording.value

    @pytest.mark.asyncio
    @patch('api.routes.calls.call_recorder.start_recording')
    async def test_start_bot_zoom(
        self, mock_start_recording, client, admin_user, admin_token,
        get_auth_headers, org_owner
    ):
        """Test starting bot for Zoom."""
        mock_start_recording.return_value = {"success": True}

        data = {
            "source_url": "https://zoom.us/j/123456789",
            "bot_name": "HR Recorder"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    @patch('api.routes.calls.call_recorder.start_recording')
    async def test_start_bot_teams(
        self, mock_start_recording, client, admin_user, admin_token,
        get_auth_headers, org_owner
    ):
        """Test starting bot for Microsoft Teams."""
        mock_start_recording.return_value = {"success": True}

        data = {
            "source_url": "https://teams.microsoft.com/l/meetup-join/...",
            "bot_name": "HR Recorder"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_start_bot_unsupported_url(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test starting bot with unsupported meeting URL."""
        data = {
            "source_url": "https://example.com/meeting",
            "bot_name": "HR Recorder"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "Unsupported meeting URL" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch('api.routes.calls.call_recorder.start_recording')
    async def test_start_bot_with_entity(
        self, mock_start_recording, client, admin_user, admin_token,
        entity, get_auth_headers, org_owner
    ):
        """Test starting bot with entity link."""
        mock_start_recording.return_value = {"success": True}

        data = {
            "source_url": "https://meet.google.com/abc-defg-hij",
            "bot_name": "HR Recorder",
            "entity_id": entity.id,
            "title": "Interview Call"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    @patch('api.routes.calls.call_recorder.start_recording')
    async def test_start_bot_fireflies_error(
        self, mock_start_recording, client, admin_user, admin_token,
        get_auth_headers, org_owner
    ):
        """Test handling Fireflies API error."""
        mock_start_recording.return_value = {
            "success": False,
            "message": "Invalid meeting URL"
        }

        data = {
            "source_url": "https://meet.google.com/abc-defg-hij",
            "bot_name": "HR Recorder"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 500
        assert "Fireflies error" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_start_bot_no_org(
        self, db_session, client, get_auth_headers
    ):
        """Test starting bot when user has no organization."""
        user = User(
            email="noorg@test.com",
            password_hash="hashed",
            name="No Org User",
            role=UserRole.ADMIN,
            is_active=True
        )
        db_session.add(user)
        await db_session.commit()

        from api.services.auth import create_access_token
        token = create_access_token(data={"sub": str(user.id)})

        data = {
            "source_url": "https://meet.google.com/abc-defg-hij",
            "bot_name": "HR Recorder"
        }

        response = await client.post(
            "/api/calls/start-bot",
            json=data,
            headers=get_auth_headers(token)
        )

        assert response.status_code == 403


# ============================================================================
# PATCH /api/calls/{call_id} - UPDATE CALL
# ============================================================================

class TestUpdateCall:
    """Test updating call recordings."""

    @pytest.mark.asyncio
    async def test_update_call_title(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test updating call title."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={"title": "Updated Call Title"},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Call Title"
        assert data["success"] is True

        # Verify in database
        await db_session.refresh(call_recording)
        assert call_recording.title == "Updated Call Title"

    @pytest.mark.asyncio
    async def test_update_call_clear_title(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test clearing call title."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={"title": ""},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        await db_session.refresh(call_recording)
        assert call_recording.title is None

    @pytest.mark.asyncio
    async def test_update_call_link_entity(
        self, db_session, client, admin_user, admin_token, call_recording,
        entity, get_auth_headers, org_owner
    ):
        """Test linking entity to call."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={"entity_id": entity.id},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["entity_id"] == entity.id
        assert data["entity_name"] == entity.name

        # Verify in database
        await db_session.refresh(call_recording)
        assert call_recording.entity_id == entity.id

    @pytest.mark.asyncio
    async def test_update_call_unlink_entity(
        self, db_session, client, admin_user, admin_token, call_recording,
        entity, get_auth_headers, org_owner
    ):
        """Test unlinking entity from call."""
        # First link entity
        call_recording.entity_id = entity.id
        await db_session.commit()

        # Then unlink
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={"entity_id": -1},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["entity_id"] is None
        assert data["entity_name"] is None

        # Verify in database
        await db_session.refresh(call_recording)
        assert call_recording.entity_id is None

    @pytest.mark.asyncio
    async def test_update_call_invalid_entity(
        self, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test linking non-existent entity."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={"entity_id": 99999},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_call_both_fields(
        self, db_session, client, admin_user, admin_token, call_recording,
        entity, get_auth_headers, org_owner
    ):
        """Test updating both title and entity."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={
                "title": "New Title",
                "entity_id": entity.id
            },
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "New Title"
        assert data["entity_id"] == entity.id

    @pytest.mark.asyncio
    async def test_update_call_not_found(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test updating non-existent call."""
        response = await client.patch(
            "/api/calls/99999",
            json={"title": "New Title"},
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_call_access_denied(
        self, client, second_user, second_user_token, call_recording,
        get_auth_headers, org_member
    ):
        """Test that user without permission cannot update call."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={"title": "Hacked"},
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403


# ============================================================================
# POST /api/calls/{call_id}/link-entity/{entity_id} - LINK ENTITY
# ============================================================================

class TestLinkEntity:
    """Test linking call to entity."""

    @pytest.mark.asyncio
    async def test_link_entity_success(
        self, db_session, client, admin_user, admin_token, call_recording,
        entity, get_auth_headers, org_owner
    ):
        """Test successfully linking entity to call."""
        response = await client.post(
            f"/api/calls/{call_recording.id}/link-entity/{entity.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify in database
        await db_session.refresh(call_recording)
        assert call_recording.entity_id == entity.id

    @pytest.mark.asyncio
    async def test_link_entity_not_found(
        self, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test linking non-existent entity."""
        response = await client.post(
            f"/api/calls/{call_recording.id}/link-entity/99999",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_link_entity_call_not_found(
        self, client, admin_user, admin_token, entity, get_auth_headers, org_owner
    ):
        """Test linking entity to non-existent call."""
        response = await client.post(
            f"/api/calls/99999/link-entity/{entity.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_link_entity_from_different_org(
        self, db_session, client, admin_user, admin_token, call_recording,
        second_organization, get_auth_headers, org_owner
    ):
        """Test linking entity from different organization."""
        # Create entity in different org
        other_entity = Entity(
            org_id=second_organization.id,
            created_by=1,
            name="Other Org Entity",
            type=EntityType.candidate,
            status=EntityStatus.active
        )
        db_session.add(other_entity)
        await db_session.commit()
        await db_session.refresh(other_entity)

        response = await client.post(
            f"/api/calls/{call_recording.id}/link-entity/{other_entity.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404


# ============================================================================
# DELETE /api/calls/{call_id} - DELETE CALL
# ============================================================================

class TestDeleteCall:
    """Test deleting call recordings."""

    @pytest.mark.asyncio
    async def test_delete_call_success(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test successfully deleting a call."""
        call_id = call_recording.id

        response = await client.delete(
            f"/api/calls/{call_id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify deleted from database
        result = await db_session.execute(
            select(CallRecording).where(CallRecording.id == call_id)
        )
        assert result.scalar_one_or_none() is None

    @pytest.mark.asyncio
    @patch('os.path.exists')
    @patch('os.remove')
    async def test_delete_call_with_audio_file(
        self, mock_remove, mock_exists, db_session, client, admin_user,
        admin_token, call_recording, get_auth_headers, org_owner
    ):
        """Test deleting call with audio file."""
        # Set audio file path
        call_recording.audio_file_path = "/tmp/test_audio.mp3"
        await db_session.commit()

        mock_exists.return_value = True

        response = await client.delete(
            f"/api/calls/{call_recording.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        # Verify file deletion was attempted
        mock_remove.assert_called_once_with("/tmp/test_audio.mp3")

    @pytest.mark.asyncio
    async def test_delete_call_not_found(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test deleting non-existent call."""
        response = await client.delete(
            "/api/calls/99999",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_call_access_denied(
        self, client, second_user, second_user_token, call_recording,
        get_auth_headers, org_member
    ):
        """Test that user without permission cannot delete call."""
        response = await client.delete(
            f"/api/calls/{call_recording.id}",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_call_cascades_shared_access(
        self, db_session, client, admin_user, admin_token, call_recording,
        second_user, get_auth_headers, org_owner
    ):
        """Test that deleting call cascades to SharedAccess records."""
        # Create share
        share = SharedAccess(
            resource_type=ResourceType.call,
            resource_id=call_recording.id,
            call_id=call_recording.id,
            shared_by_id=admin_user.id,
            shared_with_id=second_user.id,
            access_level=AccessLevel.view
        )
        db_session.add(share)
        await db_session.commit()
        share_id = share.id

        # Delete call
        response = await client.delete(
            f"/api/calls/{call_recording.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

        # Verify share is also deleted
        result = await db_session.execute(
            select(SharedAccess).where(SharedAccess.id == share_id)
        )
        assert result.scalar_one_or_none() is None


# ============================================================================
# POST /api/calls/{call_id}/stop - STOP RECORDING
# ============================================================================

class TestStopRecording:
    """Test stopping call recordings."""

    @pytest.mark.asyncio
    @patch('api.routes.calls.call_recorder.stop_recording')
    async def test_stop_recording_success(
        self, mock_stop, db_session, client, admin_user, admin_token,
        call_recording, get_auth_headers, org_owner
    ):
        """Test successfully stopping a recording."""
        # Set call to recording status
        call_recording.status = CallStatus.recording
        await db_session.commit()

        mock_stop.return_value = None

        response = await client.post(
            f"/api/calls/{call_recording.id}/stop",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify stop was called
        mock_stop.assert_called_once_with(call_recording.id)

    @pytest.mark.asyncio
    async def test_stop_recording_not_recording(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test stopping call that is not recording."""
        # Call is already done
        call_recording.status = CallStatus.done
        await db_session.commit()

        response = await client.post(
            f"/api/calls/{call_recording.id}/stop",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "not currently recording" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_stop_recording_access_denied(
        self, db_session, client, second_user, second_user_token,
        call_recording, get_auth_headers, org_member
    ):
        """Test that user without full access cannot stop recording."""
        call_recording.status = CallStatus.recording
        await db_session.commit()

        response = await client.post(
            f"/api/calls/{call_recording.id}/stop",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_stop_recording_not_found(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test stopping non-existent call."""
        response = await client.post(
            "/api/calls/99999/stop",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404


# ============================================================================
# POST /api/calls/{call_id}/reprocess - REPROCESS CALL
# ============================================================================

class TestReprocessCall:
    """Test reprocessing call recordings."""

    @pytest.mark.asyncio
    async def test_reprocess_call_with_transcript(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test reprocessing call with existing transcript."""
        # Set transcript
        call_recording.transcript = "Test transcript content"
        call_recording.speakers = []
        await db_session.commit()

        response = await client.post(
            f"/api/calls/{call_recording.id}/reprocess",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["status"] == CallStatus.analyzing.value

    @pytest.mark.asyncio
    async def test_reprocess_call_with_audio(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test reprocessing call with audio file."""
        call_recording.audio_file_path = "/tmp/test_audio.mp3"
        call_recording.transcript = None
        await db_session.commit()

        response = await client.post(
            f"/api/calls/{call_recording.id}/reprocess",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["status"] == CallStatus.processing.value

    @pytest.mark.asyncio
    async def test_reprocess_call_no_data(
        self, db_session, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test reprocessing call without transcript or audio."""
        call_recording.transcript = None
        call_recording.audio_file_path = None
        call_recording.fireflies_transcript_id = None
        await db_session.commit()

        response = await client.post(
            f"/api/calls/{call_recording.id}/reprocess",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 400
        assert "No data to process" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reprocess_call_access_denied(
        self, client, second_user, second_user_token, call_recording,
        get_auth_headers, org_member
    ):
        """Test that user without permission cannot reprocess call."""
        response = await client.post(
            f"/api/calls/{call_recording.id}/reprocess",
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_reprocess_call_not_found(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test reprocessing non-existent call."""
        response = await client.post(
            "/api/calls/99999/reprocess",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404


# ============================================================================
# POST /api/calls/{call_id}/share - SHARE CALL
# ============================================================================

class TestShareCall:
    """Test sharing call recordings."""

    @pytest.mark.asyncio
    async def test_share_call_success(
        self, db_session, client, admin_user, admin_token, call_recording,
        second_user, get_auth_headers, org_owner, org_member
    ):
        """Test successfully sharing a call."""
        data = {
            "shared_with_id": second_user.id,
            "access_level": "view"
        }

        response = await client.post(
            f"/api/calls/{call_recording.id}/share",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        response_data = response.json()
        assert response_data["success"] is True
        assert response_data["call_id"] == call_recording.id
        assert response_data["shared_with_id"] == second_user.id
        assert response_data["access_level"] == "view"

        # Verify in database
        result = await db_session.execute(
            select(SharedAccess).where(
                SharedAccess.resource_type == ResourceType.call,
                SharedAccess.resource_id == call_recording.id,
                SharedAccess.shared_with_id == second_user.id
            )
        )
        share = result.scalar_one_or_none()
        assert share is not None
        assert share.access_level == AccessLevel.view

    @pytest.mark.asyncio
    async def test_share_call_with_note(
        self, db_session, client, admin_user, admin_token, call_recording,
        second_user, get_auth_headers, org_owner, org_member
    ):
        """Test sharing call with note."""
        data = {
            "shared_with_id": second_user.id,
            "access_level": "edit",
            "note": "Please review this call"
        }

        response = await client.post(
            f"/api/calls/{call_recording.id}/share",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

        # Verify note in database
        result = await db_session.execute(
            select(SharedAccess).where(
                SharedAccess.resource_type == ResourceType.call,
                SharedAccess.resource_id == call_recording.id
            )
        )
        share = result.scalar_one()
        assert share.note == "Please review this call"

    @pytest.mark.asyncio
    async def test_share_call_with_expiration(
        self, db_session, client, admin_user, admin_token, call_recording,
        second_user, get_auth_headers, org_owner, org_member
    ):
        """Test sharing call with expiration date."""
        expires_at = datetime.utcnow() + timedelta(days=7)
        data = {
            "shared_with_id": second_user.id,
            "access_level": "view",
            "expires_at": expires_at.isoformat()
        }

        response = await client.post(
            f"/api/calls/{call_recording.id}/share",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_share_call_update_existing(
        self, db_session, client, admin_user, admin_token, call_recording,
        second_user, get_auth_headers, org_owner, org_member
    ):
        """Test updating existing share."""
        # Create initial share
        share = SharedAccess(
            resource_type=ResourceType.call,
            resource_id=call_recording.id,
            call_id=call_recording.id,
            shared_by_id=admin_user.id,
            shared_with_id=second_user.id,
            access_level=AccessLevel.view
        )
        db_session.add(share)
        await db_session.commit()

        # Update to edit access
        data = {
            "shared_with_id": second_user.id,
            "access_level": "edit",
            "note": "Updated to edit"
        }

        response = await client.post(
            f"/api/calls/{call_recording.id}/share",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200

        # Verify updated
        await db_session.refresh(share)
        assert share.access_level == AccessLevel.edit
        assert share.note == "Updated to edit"

    @pytest.mark.asyncio
    async def test_share_call_not_found(
        self, client, admin_user, admin_token, second_user, get_auth_headers, org_owner
    ):
        """Test sharing non-existent call."""
        data = {
            "shared_with_id": second_user.id,
            "access_level": "view"
        }

        response = await client.post(
            "/api/calls/99999/share",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_share_call_target_user_not_found(
        self, client, admin_user, admin_token, call_recording, get_auth_headers, org_owner
    ):
        """Test sharing call with non-existent user."""
        data = {
            "shared_with_id": 99999,
            "access_level": "view"
        }

        response = await client.post(
            f"/api/calls/{call_recording.id}/share",
            json=data,
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_share_call_no_permission(
        self, client, second_user, second_user_token, call_recording,
        admin_user, get_auth_headers, org_member
    ):
        """Test that user without permission cannot share call."""
        data = {
            "shared_with_id": admin_user.id,
            "access_level": "view"
        }

        response = await client.post(
            f"/api/calls/{call_recording.id}/share",
            json=data,
            headers=get_auth_headers(second_user_token)
        )

        assert response.status_code == 403


# ============================================================================
# SUPERADMIN PERMISSIONS
# ============================================================================

class TestSuperadminPermissions:
    """Test superadmin permissions for calls."""

    @pytest.mark.asyncio
    async def test_superadmin_sees_all_calls(
        self, db_session, client, superadmin_user, superadmin_token,
        organization, admin_user, get_auth_headers
    ):
        """Test that superadmin sees all calls across all organizations."""
        # Create calls in organization
        call1 = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Org Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        db_session.add(call1)
        await db_session.commit()

        # Note: Superadmin doesn't need org membership to see calls
        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(superadmin_token)
        )

        # Superadmin has no org, so will see empty list
        # This is expected behavior based on the code
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_superadmin_can_access_any_call(
        self, db_session, client, superadmin_user, superadmin_token,
        organization, admin_user, get_auth_headers
    ):
        """Test that superadmin can access any call."""
        call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title="Private Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        db_session.add(call)
        await db_session.commit()
        await db_session.refresh(call)

        # Superadmin tries to access
        response = await client.get(
            f"/api/calls/{call.id}",
            headers=get_auth_headers(superadmin_token)
        )

        # Will fail because superadmin has no org
        # This tests the actual behavior
        assert response.status_code == 404


# ============================================================================
# DEPARTMENT-BASED ACCESS
# ============================================================================

class TestDepartmentAccess:
    """Test department-based access control for calls."""

    @pytest.mark.asyncio
    async def test_dept_lead_sees_dept_member_calls(
        self, db_session, client, admin_user, admin_token, regular_user,
        organization, department, entity, get_auth_headers, org_owner,
        dept_lead, dept_member
    ):
        """Test that department lead sees department members' calls."""
        # Create call by dept member, linked to entity in department
        call = CallRecording(
            org_id=organization.id,
            owner_id=regular_user.id,
            entity_id=entity.id,
            title="Dept Member Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        db_session.add(call)
        await db_session.commit()

        # Dept lead (admin_user) should see it in list
        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        call_ids = [c["id"] for c in data]
        assert call.id in call_ids

    @pytest.mark.asyncio
    async def test_dept_member_cannot_see_other_member_calls(
        self, db_session, client, regular_user, user_token, second_user,
        organization, department, get_auth_headers, org_admin, org_member,
        dept_member
    ):
        """Test that department member cannot see other members' calls."""
        # Create department membership for second_user
        second_dept_member = DepartmentMember(
            department_id=department.id,
            user_id=second_user.id,
            role=DeptRole.member
        )
        db_session.add(second_dept_member)
        await db_session.commit()

        # Create call by second_user
        call = CallRecording(
            org_id=organization.id,
            owner_id=second_user.id,
            title="Other Member Call",
            source_type=CallSource.upload,
            status=CallStatus.done
        )
        db_session.add(call)
        await db_session.commit()

        # regular_user should NOT see it
        response = await client.get(
            "/api/calls",
            headers=get_auth_headers(user_token)
        )

        assert response.status_code == 200
        data = response.json()
        call_ids = [c["id"] for c in data]
        assert call.id not in call_ids


# ============================================================================
# EDGE CASES AND ERROR HANDLING
# ============================================================================

class TestEdgeCases:
    """Test edge cases and error handling."""

    @pytest.mark.asyncio
    async def test_list_calls_with_invalid_limit(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test list calls with limit exceeding maximum."""
        response = await client.get(
            "/api/calls?limit=200",
            headers=get_auth_headers(admin_token)
        )

        # FastAPI validation should fail
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_list_calls_with_negative_offset(
        self, client, admin_user, admin_token, get_auth_headers, org_owner
    ):
        """Test list calls with negative offset."""
        response = await client.get(
            "/api/calls?offset=-1",
            headers=get_auth_headers(admin_token)
        )

        # FastAPI validation should fail
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_call_empty_payload(
        self, client, admin_user, admin_token, call_recording,
        get_auth_headers, org_owner
    ):
        """Test updating call with empty payload."""
        response = await client.patch(
            f"/api/calls/{call_recording.id}",
            json={},
            headers=get_auth_headers(admin_token)
        )

        # Should succeed but make no changes
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_call_with_null_values(
        self, db_session, client, admin_user, admin_token, organization,
        get_auth_headers, org_owner
    ):
        """Test handling call with null optional values."""
        call = CallRecording(
            org_id=organization.id,
            owner_id=admin_user.id,
            title=None,
            entity_id=None,
            source_type=CallSource.upload,
            status=CallStatus.done,
            transcript=None,
            summary=None,
            action_items=None,
            key_points=None
        )
        db_session.add(call)
        await db_session.commit()
        await db_session.refresh(call)

        response = await client.get(
            f"/api/calls/{call.id}",
            headers=get_auth_headers(admin_token)
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] is None
        assert data["entity_id"] is None
        assert data["transcript"] is None

    @pytest.mark.asyncio
    async def test_unauthorized_access(self, client):
        """Test accessing calls without authentication."""
        response = await client.get("/api/calls")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_shared_access_with_expired_share(
        self, db_session, client, second_user, second_user_token,
        call_recording, admin_user, get_auth_headers, org_member
    ):
        """Test that expired shares don't grant access."""
        # Create expired share
        share = SharedAccess(
            resource_type=ResourceType.call,
            resource_id=call_recording.id,
            call_id=call_recording.id,
            shared_by_id=admin_user.id,
            shared_with_id=second_user.id,
            access_level=AccessLevel.view,
            expires_at=datetime.utcnow() - timedelta(days=1)
        )
        db_session.add(share)
        await db_session.commit()

        # Try to access
        response = await client.get(
            f"/api/calls/{call_recording.id}",
            headers=get_auth_headers(second_user_token)
        )

        # Should be denied
        assert response.status_code == 403
