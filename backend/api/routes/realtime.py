"""
WebSocket realtime event system for HR-bot.

Provides real-time notifications for:
- Entity CRUD operations
- Chat messages
- Share events
- And other resource updates

Architecture:
- Endpoint: ws://host/ws?token=<jwt_token>
- Authentication: JWT token in query parameter
- Event format: {"type": "event.type", "payload": {...}, "timestamp": "ISO8601"}
- Access control: Users only receive events for their organization
"""

from datetime import datetime
from typing import Dict, Set, Optional, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
import json
import logging
import asyncio

from ..database import get_db
from ..models.database import User
from ..services.auth import get_user_from_token

logger = logging.getLogger("hr-analyzer.realtime")

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections and event broadcasting."""

    def __init__(self):
        # Map of user_id -> set of WebSocket connections
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        # Map of user_id -> organization_id for quick access control
        self.user_orgs: Dict[int, int] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user: User, org_id: int):
        """Register a new WebSocket connection for a user."""
        await websocket.accept()

        async with self._lock:
            if user.id not in self.active_connections:
                self.active_connections[user.id] = set()

            self.active_connections[user.id].add(websocket)
            self.user_orgs[user.id] = org_id

        logger.info(f"User {user.id} connected to WebSocket (org_id={org_id})")

    async def disconnect(self, websocket: WebSocket, user_id: int):
        """Remove a WebSocket connection."""
        async with self._lock:
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)

                # Clean up if no more connections for this user
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
                    if user_id in self.user_orgs:
                        del self.user_orgs[user_id]

        logger.info(f"User {user_id} disconnected from WebSocket")

    async def broadcast_to_org(self, org_id: int, event_type: str, payload: Dict[str, Any]):
        """Broadcast an event to all users in an organization.

        Args:
            org_id: Organization ID to broadcast to
            event_type: Event type (e.g., "entity.created")
            payload: Event payload data
        """
        event = {
            "type": event_type,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        message = json.dumps(event)

        # Find all users in this organization
        disconnected = []
        async with self._lock:
            for user_id, user_org_id in list(self.user_orgs.items()):
                if user_org_id == org_id and user_id in self.active_connections:
                    for websocket in list(self.active_connections[user_id]):
                        try:
                            await websocket.send_text(message)
                        except Exception as e:
                            logger.warning(f"Failed to send to user {user_id}: {e}")
                            disconnected.append((websocket, user_id))

        # Clean up disconnected clients
        for websocket, user_id in disconnected:
            await self.disconnect(websocket, user_id)

    async def broadcast_to_user(self, user_id: int, event_type: str, payload: Dict[str, Any]):
        """Broadcast an event to a specific user.

        Args:
            user_id: User ID to send to
            event_type: Event type (e.g., "share.created")
            payload: Event payload data
        """
        event = {
            "type": event_type,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        message = json.dumps(event)

        disconnected = []
        async with self._lock:
            if user_id in self.active_connections:
                for websocket in list(self.active_connections[user_id]):
                    try:
                        await websocket.send_text(message)
                    except Exception as e:
                        logger.warning(f"Failed to send to user {user_id}: {e}")
                        disconnected.append((websocket, user_id))

        # Clean up disconnected clients
        for websocket, user_id in disconnected:
            await self.disconnect(websocket, user_id)

    async def send_to_connection(self, websocket: WebSocket, event_type: str, payload: Dict[str, Any]):
        """Send an event to a specific WebSocket connection.

        Args:
            websocket: WebSocket connection
            event_type: Event type
            payload: Event payload data
        """
        event = {
            "type": event_type,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        try:
            await websocket.send_text(json.dumps(event))
        except Exception as e:
            logger.warning(f"Failed to send event: {e}")


# Global connection manager instance
manager = ConnectionManager()


async def authenticate_websocket(token: Optional[str], websocket: WebSocket, db: AsyncSession) -> Optional[User]:
    """Authenticate WebSocket connection using JWT token or cookie.

    Supports two authentication methods:
    1. JWT token in query parameter: ws://host/ws?token=<jwt_token>
    2. access_token cookie (httpOnly) - automatically sent by browser

    Args:
        token: JWT token from query parameter (optional)
        websocket: WebSocket connection to extract cookies from
        db: Database session

    Returns:
        User object if authenticated, None otherwise
    """
    # Try query parameter token first
    if token:
        user = await get_user_from_token(token, db)
        if user:
            return user

    # Fallback to cookie-based auth
    cookies = websocket.cookies
    cookie_token = cookies.get("access_token")
    if cookie_token:
        user = await get_user_from_token(cookie_token, db)
        if user:
            return user

    return None


async def get_user_org_id(user: User, db: AsyncSession) -> Optional[int]:
    """Get user's organization ID.

    Args:
        user: User object
        db: Database session

    Returns:
        Organization ID or None
    """
    from ..services.auth import get_user_org
    org = await get_user_org(user, db)
    return org.id if org else None


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """WebSocket endpoint for real-time events.

    Authentication methods (in order of priority):
    1. JWT token in query parameter: ws://host/ws?token=<jwt_token>
    2. access_token cookie (httpOnly) - automatically sent by browser

    Events are broadcast in the following format:
    {
        "type": "event.type",
        "payload": {...},
        "timestamp": "2024-01-01T12:00:00.000Z"
    }

    Supported event types:
    - entity.created
    - entity.updated
    - entity.deleted
    - chat.message
    - share.created
    - share.revoked
    - call.progress (call processing progress update)
    - call.completed (call processing finished successfully)
    - call.failed (call processing failed with error)
    """
    # Get database session
    db_gen = get_db()
    db = await anext(db_gen)

    try:
        # Authenticate user (supports both query token and cookie)
        user = await authenticate_websocket(token, websocket, db)

        if not user:
            # Close connection with 401/403 status code
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Unauthorized")
            return

        # Get user's organization
        org_id = await get_user_org_id(user, db)

        if not org_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="No organization")
            return

        # Register connection
        await manager.connect(websocket, user, org_id)

        # Keep connection alive and handle token expiry
        try:
            while True:
                # Wait for messages (ping/pong or client messages)
                # This also helps detect disconnections
                try:
                    # Set a timeout to periodically check token validity
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)

                    # Handle client messages if needed (optional)
                    # Currently we just keep the connection alive

                except asyncio.TimeoutError:
                    # Periodic token validation
                    # Re-validate token to handle expiry
                    current_user = await authenticate_websocket(token, websocket, db)
                    if not current_user or current_user.id != user.id:
                        # Token expired or invalidated
                        await websocket.close(
                            code=status.WS_1008_POLICY_VIOLATION,
                            reason="Token expired"
                        )
                        break

                    # Send ping to keep connection alive
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "ping",
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }))
                    except:
                        # Connection lost
                        break

        except WebSocketDisconnect:
            # Normal disconnection
            pass
        except Exception as e:
            logger.error(f"WebSocket error for user {user.id}: {e}")
        finally:
            # Clean up connection
            await manager.disconnect(websocket, user.id)

    finally:
        # Close database session
        try:
            await db_gen.aclose()
        except:
            pass


# Helper functions for broadcasting events from other routes

async def broadcast_entity_created(org_id: int, entity_data: Dict[str, Any]):
    """Broadcast entity.created event to organization."""
    await manager.broadcast_to_org(org_id, "entity.created", entity_data)


async def broadcast_entity_updated(org_id: int, entity_data: Dict[str, Any]):
    """Broadcast entity.updated event to organization."""
    await manager.broadcast_to_org(org_id, "entity.updated", entity_data)


async def broadcast_entity_deleted(org_id: int, entity_id: int):
    """Broadcast entity.deleted event to organization."""
    await manager.broadcast_to_org(org_id, "entity.deleted", {
        "id": entity_id,
        "resource_type": "entity"
    })


async def broadcast_chat_message(org_id: int, message_data: Dict[str, Any]):
    """Broadcast chat.message event to organization."""
    await manager.broadcast_to_org(org_id, "chat.message", message_data)


async def broadcast_chat_created(org_id: int, chat_data: Dict[str, Any]):
    """Broadcast chat.created event to organization."""
    await manager.broadcast_to_org(org_id, "chat.created", chat_data)


async def broadcast_chat_updated(org_id: int, chat_data: Dict[str, Any]):
    """Broadcast chat.updated event to organization."""
    await manager.broadcast_to_org(org_id, "chat.updated", chat_data)


async def broadcast_chat_deleted(org_id: int, chat_id: int):
    """Broadcast chat.deleted event to organization."""
    await manager.broadcast_to_org(org_id, "chat.deleted", {
        "id": chat_id,
        "resource_type": "chat"
    })


async def broadcast_share_created(user_id: int, share_data: Dict[str, Any]):
    """Broadcast share.created event to specific user."""
    await manager.broadcast_to_user(user_id, "share.created", share_data)


async def broadcast_share_revoked(user_id: int, share_data: Dict[str, Any]):
    """Broadcast share.revoked event to specific user."""
    await manager.broadcast_to_user(user_id, "share.revoked", share_data)


# ============================================================================
# CALL PROCESSING EVENTS
# ============================================================================

async def broadcast_call_progress(org_id: int, call_data: Dict[str, Any]):
    """Broadcast call.progress event to organization.

    Args:
        org_id: Organization ID
        call_data: Call progress data including:
            - id: Call ID
            - progress: Progress percentage (0-100)
            - progress_stage: Current stage description
            - status: Current status (pending, transcribing, analyzing, etc.)
    """
    await manager.broadcast_to_org(org_id, "call.progress", call_data)


async def broadcast_call_completed(org_id: int, call_data: Dict[str, Any]):
    """Broadcast call.completed event to organization.

    Args:
        org_id: Organization ID
        call_data: Completed call data including:
            - id: Call ID
            - title: Call title
            - status: "done"
            - has_summary: Whether summary is available
            - has_transcript: Whether transcript is available
            - duration_seconds: Call duration
    """
    await manager.broadcast_to_org(org_id, "call.completed", call_data)


async def broadcast_call_failed(org_id: int, call_data: Dict[str, Any]):
    """Broadcast call.failed event to organization.

    Args:
        org_id: Organization ID
        call_data: Failed call data including:
            - id: Call ID
            - error_message: Error description
            - status: "failed"
    """
    await manager.broadcast_to_org(org_id, "call.failed", call_data)
