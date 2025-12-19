"""
TDD Tests for MCP Tools

These tests define the expected behavior of the Co-Browser MCP tools
before implementation. Run with: pytest src/Library/tests/test_mcp_tools.py -v
"""

import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch


# ============================================
# MCP Tool Definition Tests
# ============================================

class TestMCPToolDefinitions:
    """Tests for MCP tool schemas and definitions."""

    def test_tools_are_defined(self):
        """All required tools should be defined."""
        from src.Library.mcp_tools import get_tool_definitions

        tools = get_tool_definitions()
        tool_names = [t["name"] for t in tools]

        assert "cobrowser_navigate" in tool_names
        assert "cobrowser_click" in tool_names
        assert "cobrowser_type" in tool_names
        assert "cobrowser_read" in tool_names
        assert "cobrowser_screenshot" in tool_names
        assert "cobrowser_get_state" in tool_names
        assert "cobrowser_request_human" in tool_names

    def test_navigate_tool_schema(self):
        """Navigate tool should have correct schema."""
        from src.Library.mcp_tools import get_tool_definitions

        tools = get_tool_definitions()
        navigate = next(t for t in tools if t["name"] == "cobrowser_navigate")

        assert "description" in navigate
        assert "inputSchema" in navigate
        assert "url" in navigate["inputSchema"]["properties"]
        assert navigate["inputSchema"]["required"] == ["url"]

    def test_click_tool_schema(self):
        """Click tool should have correct schema."""
        from src.Library.mcp_tools import get_tool_definitions

        tools = get_tool_definitions()
        click = next(t for t in tools if t["name"] == "cobrowser_click")

        props = click["inputSchema"]["properties"]
        assert "selector" in props or "xpath" in props
        assert "description" in click

    def test_type_tool_schema(self):
        """Type tool should have correct schema."""
        from src.Library.mcp_tools import get_tool_definitions

        tools = get_tool_definitions()
        type_tool = next(t for t in tools if t["name"] == "cobrowser_type")

        props = type_tool["inputSchema"]["properties"]
        assert "text" in props
        assert "selector" in props or "xpath" in props

    def test_request_human_tool_schema(self):
        """Request human tool should have correct schema."""
        from src.Library.mcp_tools import get_tool_definitions

        tools = get_tool_definitions()
        tool = next(t for t in tools if t["name"] == "cobrowser_request_human")

        props = tool["inputSchema"]["properties"]
        assert "reason" in props
        assert "message" in props


# ============================================
# Tool Execution Tests
# ============================================

class TestToolExecution:
    """Tests for tool execution."""

    @pytest.fixture
    def mock_service(self):
        """Create a mock CoBrowserService."""
        service = MagicMock()
        service.active_sessions = {"test-session": MagicMock()}
        service.send_command = AsyncMock(return_value="cmd-123")
        return service

    @pytest.mark.asyncio
    async def test_navigate_sends_command(self, mock_service):
        """Navigate should send command to extension."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.navigate(url="https://example.com")

        mock_service.send_command.assert_called_once()
        call_args = mock_service.send_command.call_args
        assert call_args[0][1] == "command.navigate"
        assert call_args[0][2]["url"] == "https://example.com"

    @pytest.mark.asyncio
    async def test_click_sends_command(self, mock_service):
        """Click should send command to extension."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.click(selector="#submit-btn")

        mock_service.send_command.assert_called_once()
        call_args = mock_service.send_command.call_args
        assert call_args[0][1] == "command.click"
        assert call_args[0][2]["selector"] == "#submit-btn"

    @pytest.mark.asyncio
    async def test_type_sends_command(self, mock_service):
        """Type should send command to extension."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.type(selector="#search", text="hello world")

        mock_service.send_command.assert_called_once()
        call_args = mock_service.send_command.call_args
        assert call_args[0][1] == "command.type"
        assert call_args[0][2]["text"] == "hello world"

    @pytest.mark.asyncio
    async def test_read_sends_command(self, mock_service):
        """Read should send command to extension."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.read(selector="#content")

        mock_service.send_command.assert_called_once()
        call_args = mock_service.send_command.call_args
        assert call_args[0][1] == "command.read"

    @pytest.mark.asyncio
    async def test_screenshot_sends_command(self, mock_service):
        """Screenshot should send command to extension."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.screenshot()

        mock_service.send_command.assert_called_once()
        call_args = mock_service.send_command.call_args
        assert call_args[0][1] == "command.screenshot"

    @pytest.mark.asyncio
    async def test_get_state_returns_state(self, mock_service):
        """Get state should return current page state."""
        from src.Library.mcp_tools import CoBrowserTools

        mock_service.get_session_state = MagicMock(return_value={
            "control_mode": "CLAUDE",
            "current_url": "https://example.com"
        })

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.get_state()

        assert result["control_mode"] == "CLAUDE"
        assert result["current_url"] == "https://example.com"

    @pytest.mark.asyncio
    async def test_request_human_triggers_handoff(self, mock_service):
        """Request human should trigger handoff."""
        from src.Library.mcp_tools import CoBrowserTools

        mock_service.set_control_mode = MagicMock()

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.request_human(
            reason="login",
            message="Please log into your account"
        )

        mock_service.set_control_mode.assert_called_with("test-session", "HUMAN")


# ============================================
# Error Handling Tests
# ============================================

class TestErrorHandling:
    """Tests for error handling."""

    @pytest.fixture
    def mock_service(self):
        service = MagicMock()
        service.active_sessions = {}
        return service

    @pytest.mark.asyncio
    async def test_no_session_returns_error(self, mock_service):
        """Operations without session should return error."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="nonexistent")
        result = await tools.navigate(url="https://example.com")

        assert result["success"] is False
        assert "session" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_timeout_returns_error(self, mock_service):
        """Command timeout should return error."""
        from src.Library.mcp_tools import CoBrowserTools

        mock_service.active_sessions = {"test-session": MagicMock()}
        mock_service.send_command = AsyncMock(side_effect=asyncio.TimeoutError())

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.click(selector="#btn")

        assert result["success"] is False
        assert "timeout" in result["error"].lower()


# ============================================
# MCP Server Tests
# ============================================

class TestMCPServer:
    """Tests for MCP server integration."""

    def test_server_has_tools_endpoint(self):
        """MCP server should expose tools endpoint."""
        from src.Library.mcp_tools import app

        # Check that the route exists
        routes = [route.path for route in app.routes]
        assert "/mcp/tools" in routes or any("/tools" in r for r in routes)

    def test_server_has_call_endpoint(self):
        """MCP server should expose call endpoint."""
        from src.Library.mcp_tools import app

        routes = [route.path for route in app.routes]
        assert "/mcp/call" in routes or any("/call" in r for r in routes)


# ============================================
# Response Format Tests
# ============================================

class TestResponseFormat:
    """Tests for response format."""

    @pytest.fixture
    def mock_service(self):
        service = MagicMock()
        service.active_sessions = {"test-session": MagicMock()}
        service.send_command = AsyncMock(return_value="cmd-123")
        return service

    @pytest.mark.asyncio
    async def test_success_response_format(self, mock_service):
        """Successful responses should have correct format."""
        from src.Library.mcp_tools import CoBrowserTools

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.navigate(url="https://example.com")

        assert "success" in result
        assert result["success"] is True
        assert "message_id" in result

    @pytest.mark.asyncio
    async def test_get_state_response_format(self, mock_service):
        """Get state response should include all fields."""
        from src.Library.mcp_tools import CoBrowserTools

        mock_service.get_session_state = MagicMock(return_value={
            "control_mode": "CLAUDE",
            "current_url": "https://example.com",
            "title": "Example"
        })

        tools = CoBrowserTools(mock_service, session_id="test-session")
        result = await tools.get_state()

        assert "control_mode" in result
        assert "current_url" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
