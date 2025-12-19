"""
TDD Tests for Co-Browser WebSocket Server

These tests define the expected behavior of the cobrowser_service
before implementation. Run with: pytest src/Library/tests/test_cobrowser.py -v
"""

import pytest
import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocket


# Test fixtures and mocks

@pytest.fixture
def session_id():
    """Generate a unique session ID for tests."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_websocket():
    """Create a mock WebSocket for testing."""
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.receive_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


# ============================================
# Phase 1: WebSocket Connection Tests
# ============================================

class TestWebSocketConnection:
    """Tests for basic WebSocket connection handling."""

    @pytest.mark.asyncio
    async def test_client_can_connect(self, session_id):
        """A client should be able to establish a WebSocket connection."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.receive_json = AsyncMock(side_effect=asyncio.CancelledError())

        # Should not raise - connection should be accepted
        try:
            await service.handle_connection(mock_ws, session_id)
        except asyncio.CancelledError:
            pass

        mock_ws.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_connection_assigns_session(self, session_id):
        """Connection should be tracked in active sessions."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.receive_json = AsyncMock(side_effect=asyncio.CancelledError())

        try:
            await service.handle_connection(mock_ws, session_id)
        except asyncio.CancelledError:
            pass

        # Session should have been registered (even if now disconnected)
        assert session_id in service.session_history

    @pytest.mark.asyncio
    async def test_invalid_session_format_rejected(self):
        """Connection with invalid session ID format should be rejected."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.close = AsyncMock()

        # Empty session ID should be rejected
        await service.handle_connection(mock_ws, "")

        mock_ws.close.assert_called()

    @pytest.mark.asyncio
    async def test_heartbeat_response(self, session_id):
        """Server should respond to heartbeat messages."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()

        heartbeat_msg = {
            "id": str(uuid.uuid4()),
            "type": "heartbeat",
            "timestamp": 1234567890,
            "session_id": session_id,
            "payload": {}
        }

        # First call returns heartbeat, second raises to exit
        mock_ws.receive_json = AsyncMock(
            side_effect=[heartbeat_msg, asyncio.CancelledError()]
        )
        mock_ws.send_json = AsyncMock()

        try:
            await service.handle_connection(mock_ws, session_id)
        except asyncio.CancelledError:
            pass

        # Should have sent a heartbeat response
        calls = mock_ws.send_json.call_args_list
        assert len(calls) >= 1
        response = calls[0][0][0]
        assert response["type"] == "heartbeat.ack"

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up_session(self, session_id):
        """Disconnection should clean up active session."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.accept = AsyncMock()
        mock_ws.receive_json = AsyncMock(
            side_effect=Exception("Connection closed")
        )

        await service.handle_connection(mock_ws, session_id)

        # Active sessions should not contain this session
        assert session_id not in service.active_sessions


# ============================================
# Phase 1: Session Management Tests
# ============================================

class TestSessionManagement:
    """Tests for session state management."""

    def test_create_session_returns_id(self):
        """Creating a session should return a valid session ID."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()

        assert "session_id" in session
        assert len(session["session_id"]) > 0
        # Should be a valid UUID
        uuid.UUID(session["session_id"])

    def test_session_has_default_control_mode(self):
        """New session should have CLAUDE as default control mode."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()

        assert session["control_mode"] == "CLAUDE"

    def test_session_tracks_control_mode_changes(self):
        """Session should track control mode changes."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()
        session_id = session["session_id"]

        # Change to HUMAN mode
        service.set_control_mode(session_id, "HUMAN")
        assert service.get_control_mode(session_id) == "HUMAN"

        # Change to SHARED mode
        service.set_control_mode(session_id, "SHARED")
        assert service.get_control_mode(session_id) == "SHARED"

        # Back to CLAUDE mode
        service.set_control_mode(session_id, "CLAUDE")
        assert service.get_control_mode(session_id) == "CLAUDE"

    def test_invalid_control_mode_rejected(self):
        """Setting invalid control mode should raise error."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()
        session_id = session["session_id"]

        with pytest.raises(ValueError):
            service.set_control_mode(session_id, "INVALID_MODE")

    def test_session_persists_state(self):
        """Session state should persist across multiple operations."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()
        session_id = session["session_id"]

        # Set some state
        service.set_control_mode(session_id, "HUMAN")
        service.update_session_state(session_id, {"current_url": "https://example.com"})

        # Retrieve and verify
        state = service.get_session_state(session_id)
        assert state["control_mode"] == "HUMAN"
        assert state["current_url"] == "https://example.com"

    def test_get_nonexistent_session_returns_none(self):
        """Getting a non-existent session should return None."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        state = service.get_session_state("nonexistent-session-id")

        assert state is None


# ============================================
# Phase 1: Message Protocol Tests
# ============================================

class TestMessageProtocol:
    """Tests for message format and routing."""

    def test_message_has_required_fields(self):
        """Messages should have all required fields."""
        from src.Library.cobrowser_service import create_message

        msg = create_message(
            msg_type="command.navigate",
            session_id="test-session",
            payload={"url": "https://example.com"}
        )

        assert "id" in msg
        assert "type" in msg
        assert "timestamp" in msg
        assert "session_id" in msg
        assert "payload" in msg

    def test_message_id_is_uuid(self):
        """Message ID should be a valid UUID."""
        from src.Library.cobrowser_service import create_message

        msg = create_message(
            msg_type="command.navigate",
            session_id="test-session",
            payload={}
        )

        # Should not raise
        uuid.UUID(msg["id"])

    def test_message_timestamp_is_numeric(self):
        """Message timestamp should be a numeric value."""
        from src.Library.cobrowser_service import create_message

        msg = create_message(
            msg_type="test",
            session_id="test-session",
            payload={}
        )

        assert isinstance(msg["timestamp"], (int, float))

    @pytest.mark.asyncio
    async def test_command_response_includes_correlation_id(self, session_id):
        """Command responses should include the original message ID."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        service.create_session()

        original_id = str(uuid.uuid4())
        command = {
            "id": original_id,
            "type": "command.navigate",
            "timestamp": 1234567890,
            "session_id": session_id,
            "payload": {"url": "https://example.com"}
        }

        response = await service.process_message(command, session_id)

        assert response["correlation_id"] == original_id


# ============================================
# FastAPI Integration Tests
# ============================================

class TestFastAPIIntegration:
    """Tests for FastAPI endpoint integration."""

    def test_create_session_endpoint(self):
        """POST /cobrowser/session should create a new session."""
        from src.Library.cobrowser_service import app

        client = TestClient(app)
        response = client.post("/v1/cobrowser/session")

        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data
        assert "control_mode" in data

    def test_get_session_endpoint(self):
        """GET /cobrowser/session/{id} should return session state."""
        from src.Library.cobrowser_service import app

        client = TestClient(app)

        # Create session first
        create_response = client.post("/v1/cobrowser/session")
        session_id = create_response.json()["session_id"]

        # Get session
        response = client.get(f"/v1/cobrowser/session/{session_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == session_id

    def test_get_nonexistent_session_returns_404(self):
        """GET /cobrowser/session/{id} for non-existent session returns 404."""
        from src.Library.cobrowser_service import app

        client = TestClient(app)
        response = client.get("/v1/cobrowser/session/nonexistent-id")

        assert response.status_code == 404

    def test_update_control_mode_endpoint(self):
        """PATCH /cobrowser/session/{id}/mode should update control mode."""
        from src.Library.cobrowser_service import app

        client = TestClient(app)

        # Create session
        create_response = client.post("/v1/cobrowser/session")
        session_id = create_response.json()["session_id"]

        # Update mode
        response = client.patch(
            f"/v1/cobrowser/session/{session_id}/mode",
            json={"mode": "HUMAN"}
        )

        assert response.status_code == 200
        assert response.json()["control_mode"] == "HUMAN"


# ============================================
# Command Queue Tests
# ============================================

class TestCommandQueue:
    """Tests for command queuing when extension is disconnected."""

    def test_queue_command_when_disconnected(self):
        """Commands should be queued when extension is disconnected."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()
        session_id = session["session_id"]

        # Queue a command (no WebSocket connected)
        command = {
            "type": "command.navigate",
            "payload": {"url": "https://example.com"}
        }
        service.queue_command(session_id, command)

        # Should be in queue
        assert len(service.get_pending_commands(session_id)) == 1

    def test_queued_commands_sent_on_reconnect(self):
        """Queued commands should be sent when extension reconnects."""
        from src.Library.cobrowser_service import CoBrowserService

        service = CoBrowserService()
        session = service.create_session()
        session_id = session["session_id"]

        # Queue commands
        service.queue_command(session_id, {"type": "command.navigate", "payload": {}})
        service.queue_command(session_id, {"type": "command.click", "payload": {}})

        # Get pending (simulating reconnect flush)
        pending = service.flush_pending_commands(session_id)

        assert len(pending) == 2
        # Queue should be empty after flush
        assert len(service.get_pending_commands(session_id)) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
