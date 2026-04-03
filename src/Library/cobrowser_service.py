"""
Co-Browser WebSocket Service with MCP Protocol Support

This service provides WebSocket-based communication between Claude Code
and a Firefox browser extension for collaborative web browsing.

Now includes full MCP (Model Context Protocol) JSON-RPC support, eliminating
the need for the separate mcp_tools.py wrapper service.

Control Modes:
- CLAUDE: AI drives the browser
- HUMAN: User has control (during handoffs)
- SHARED: Both can interact

Run with:
    python -m uvicorn src.Library.cobrowser_service:app --host 0.0.0.0 --port 8677
"""

import asyncio
import json
import secrets
import time
import uuid
from typing import Dict, List, Optional, Any, Union
from enum import Enum
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Header, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

# Native mouse/keyboard automation
try:
    import pyautogui
    pyautogui.FAILSAFE = True  # Move mouse to corner to abort
    PYAUTOGUI_AVAILABLE = True
except ImportError:
    PYAUTOGUI_AVAILABLE = False
    pyautogui = None

import subprocess
import re


def get_firefox_window_position() -> Optional[Dict[str, int]]:
    """
    Get Firefox window position using xwininfo (X11).

    Firefox's window.screenX/screenY are unreliable on multi-monitor X11 setups.
    This function queries the actual window position from X11 directly.

    Returns: {'x': int, 'y': int, 'width': int, 'height': int} or None
    """
    try:
        result = subprocess.run(
            ['xwininfo', '-root', '-tree'],
            capture_output=True, text=True, timeout=5
        )

        # Find the main Firefox window (Navigator class, reasonable size)
        for line in result.stdout.split('\n'):
            if 'Navigator' in line and 'firefox' in line.lower():
                # Parse: 0x1a00016 "title": ("Navigator" "firefox")  3374x1408+1986+32
                match = re.search(r'(\d+)x(\d+)\+(\d+)\+(\d+)', line)
                if match:
                    width, height, x, y = map(int, match.groups())
                    if width > 100 and height > 100:  # Filter out tiny windows
                        return {'x': x, 'y': y, 'width': width, 'height': height}
        return None
    except Exception:
        return None


def calculate_corrected_screen_coords(
    extension_screen_x: float,
    extension_screen_y: float,
    debug_info: Optional[Dict[str, Any]] = None
) -> tuple[float, float]:
    """
    Calculate corrected screen coordinates for native mouse automation.

    Firefox on Linux X11 with HiDPI scaling reports coordinates in CSS pixels,
    but pyautogui needs physical screen pixels. Additionally, Firefox's
    window.screenX/screenY can be incorrect on multi-monitor setups.

    This function:
    1. Gets the actual window position from X11 (physical pixels)
    2. Calculates the scale factor (X11 size / Firefox outer size)
    3. Computes element position using X11 window pos + scaled rect + chrome offset

    Args:
        extension_screen_x: screenX calculated by the extension (unused, kept for API compat)
        extension_screen_y: screenY calculated by the extension (unused, kept for API compat)
        debug_info: Debug info from extension with rect and window dimensions

    Returns: (physical_x, physical_y) in screen coordinates
    """
    if debug_info is None:
        return extension_screen_x, extension_screen_y

    # Get the actual Firefox window position from X11
    x11_pos = get_firefox_window_position()

    # Get Firefox's reported dimensions and position
    firefox_outer_w = debug_info.get('windowOuterWidth', 1)
    firefox_outer_h = debug_info.get('windowOuterHeight', 1)
    firefox_screen_x = debug_info.get('windowScreenX', 0)
    firefox_screen_y = debug_info.get('windowScreenY', 0)

    # If X11 position unavailable, fall back to extension coords
    if x11_pos is None:
        return extension_screen_x, extension_screen_y

    # Get element rect (in CSS pixels, relative to viewport)
    rect_left = debug_info.get('rectLeft', 0)
    rect_top = debug_info.get('rectTop', 0)
    rect_width = debug_info.get('rectWidth', 0)
    rect_height = debug_info.get('rectHeight', 0)

    # Calculate scale factor (physical pixels / CSS pixels)
    scale = x11_pos['width'] / firefox_outer_w if firefox_outer_w > 0 else 1.0

    # Element center in CSS pixels (relative to viewport)
    elem_center_x_css = rect_left + rect_width / 2
    elem_center_y_css = rect_top + rect_height / 2

    # Get viewport dimensions to calculate chrome offset dynamically
    firefox_inner_w = debug_info.get('windowInnerWidth', firefox_outer_w)
    firefox_inner_h = debug_info.get('windowInnerHeight', firefox_outer_h)

    # Chrome offset calculation
    # The physical chrome (tabs, address bar) is constant regardless of zoom
    # At 100% zoom, chrome = outer - inner. At other zoom levels, this formula
    # doesn't scale correctly because innerWidth doesn't scale proportionally.
    # Solution: calculate chrome at 100% zoom equivalent
    # chrome_physical = X11_size - (inner_css * scale)... but this underestimates
    #
    # Empirically, at 100% zoom on this system: chrome ≈ (55, 85) physical pixels
    # At 110% zoom, the formula gives ~(28, 74) which is wrong
    # Use outer - inner and DON'T scale, since chrome doesn't zoom
    chrome_x_css = firefox_outer_w - firefox_inner_w  # CSS pixels
    chrome_y_css = firefox_outer_h - firefox_inner_h

    # Chrome is rendered at display DPR, not page zoom
    # Approximate: use max of calculated and baseline (55, 85) for robustness
    chrome_x_physical = max(chrome_x_css, 55.0)
    chrome_y_physical = max(chrome_y_css, 85.0)

    # Calculate physical screen coordinates
    physical_x = x11_pos['x'] + chrome_x_physical + elem_center_x_css * scale
    physical_y = x11_pos['y'] + chrome_y_physical + elem_center_y_css * scale

    # Debug logging
    print(f"[COORD DEBUG] X11 pos: ({x11_pos['x']}, {x11_pos['y']}), size: {x11_pos['width']}x{x11_pos['height']}")
    print(f"[COORD DEBUG] Firefox outer: {firefox_outer_w}x{firefox_outer_h}, inner: {firefox_inner_w}x{firefox_inner_h}")
    print(f"[COORD DEBUG] Scale: {scale:.3f}, Chrome physical: ({chrome_x_physical:.1f}, {chrome_y_physical:.1f})")
    print(f"[COORD DEBUG] Rect: ({rect_left}, {rect_top}) size {rect_width}x{rect_height}")
    print(f"[COORD DEBUG] Element center CSS: ({elem_center_x_css:.1f}, {elem_center_y_css:.1f})")
    print(f"[COORD DEBUG] Final physical: ({physical_x:.1f}, {physical_y:.1f})")

    return physical_x, physical_y

# Permission flag - must be explicitly enabled by browser extension
# Default False for safety - no native control until user enables it
native_control_allowed = False

# Flag to cancel in-progress native automation (set by emergency stop)
native_cancel_requested = False


def check_native_permission() -> Dict[str, Any] | None:
    """Check if native control is allowed. Returns error dict if not allowed, None if OK."""
    if not PYAUTOGUI_AVAILABLE:
        return {"success": False, "error": "pyautogui not installed"}
    if not native_control_allowed:
        return {"success": False, "error": "Native control not enabled. Enable in extension popup."}
    if native_cancel_requested:
        return {"success": False, "error": "Native control cancelled by emergency stop"}
    return None


# ============================================
# Native Automation Functions
# ============================================

async def handle_native_permission(allowed: bool) -> Dict[str, Any]:
    """Set native control permission state. Called when browser permission changes."""
    global native_control_allowed, native_cancel_requested
    native_control_allowed = allowed
    # If disabling, also clear any cancel state so re-enabling works cleanly
    if not allowed:
        native_cancel_requested = False
    return {"success": True, "allowed": allowed}


async def handle_native_move(screen_x: float, screen_y: float) -> Dict[str, Any]:
    """Move mouse to screen coordinates (no click)."""
    error = check_native_permission()
    if error:
        return error

    try:
        pyautogui.moveTo(screen_x, screen_y, duration=0.3)
        return {"success": True, "movedTo": {"x": screen_x, "y": screen_y}}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_native_click(screen_x: float, screen_y: float) -> Dict[str, Any]:
    """Perform a native mouse click at screen coordinates."""
    error = check_native_permission()
    if error:
        return error

    try:
        pyautogui.click(screen_x, screen_y)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_native_move(screen_x: float, screen_y: float) -> Dict[str, Any]:
    """Move the mouse to screen coordinates without clicking."""
    error = check_native_permission()
    if error:
        return error

    try:
        pyautogui.moveTo(screen_x, screen_y)
        return {"success": True, "moved_to": {"x": screen_x, "y": screen_y}}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_firefox_window_id() -> Optional[int]:
    """
    Get Firefox window ID from xwininfo.
    Returns window ID as int, or None if not found.
    """
    try:
        result = subprocess.run(
            ['xwininfo', '-root', '-tree'],
            capture_output=True, text=True, timeout=5
        )

        for line in result.stdout.split('\n'):
            if 'Navigator' in line and 'firefox' in line.lower():
                # Parse: 0x1a00016 "title": ...
                match = re.match(r'\s*(0x[0-9a-fA-F]+)', line)
                if match:
                    return int(match.group(1), 16)
        return None
    except Exception:
        return None


def focus_firefox_window() -> bool:
    """
    Focus the Firefox window using xdotool.

    Returns True if successful, False otherwise.
    """
    try:
        window_id = get_firefox_window_id()
        if window_id is None:
            return False

        # Use xdotool to activate the window
        result = subprocess.run(
            ['xdotool', 'windowactivate', '--sync', str(window_id)],
            capture_output=True, text=True, timeout=5
        )

        if result.returncode != 0:
            return False

        time.sleep(0.2)  # Brief pause for focus to settle
        return True
    except Exception:
        return False


async def handle_native_type(text: str) -> Dict[str, Any]:
    """Type text using native keyboard. Focuses Firefox window first."""
    error = check_native_permission()
    if error:
        return error

    try:
        # Focus Firefox window first
        if not focus_firefox_window():
            return {"success": False, "error": "Could not focus Firefox window"}

        pyautogui.write(text, interval=0.02)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_native_hotkey(keys: List[str]) -> Dict[str, Any]:
    """Press a keyboard hotkey combination. Uses xdotool for reliable window focus and key sending."""
    error = check_native_permission()
    if error:
        return error

    try:
        # Get Firefox window ID
        window_id = get_firefox_window_id()
        if window_id is None:
            return {"success": False, "error": "Could not find Firefox window"}

        # Use xdotool for both activation and key sending
        # This is more reliable than pyautogui from background processes
        key_combo = '+'.join(keys)

        # Activate window and send key in one command chain
        result = subprocess.run(
            ['bash', '-c', f'xdotool windowactivate --sync {window_id} && sleep 0.3 && xdotool key {key_combo}'],
            capture_output=True, text=True, timeout=10
        )

        if result.returncode != 0:
            return {"success": False, "error": f"xdotool failed: {result.stderr}"}

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_native_scroll(clicks: int) -> Dict[str, Any]:
    """Scroll the mouse wheel at current cursor position.

    Args:
        clicks: Number of scroll clicks. Positive = up, negative = down.
    """
    error = check_native_permission()
    if error:
        return error

    try:
        pyautogui.scroll(clicks)
        return {"success": True, "scrolled": clicks}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_native_cancel() -> Dict[str, Any]:
    """Emergency stop - immediately disable all native automation."""
    global native_control_allowed, native_cancel_requested
    native_control_allowed = False
    native_cancel_requested = True
    return {"success": True}


# ============================================
# MCP Protocol Configuration
# ============================================

MCP_SERVER_INFO = {
    "name": "cobrowser-mcp",
    "version": "0.3.0"
}

MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
MCP_LATEST_PROTOCOL_VERSION = "2025-06-18"


# ============================================
# JSON-RPC 2.0 Support
# ============================================

class ErrorCode:
    """JSON-RPC 2.0 Standard Error Codes"""
    PARSE_ERROR = -32700      # Invalid JSON
    INVALID_REQUEST = -32600  # Not a valid Request object
    METHOD_NOT_FOUND = -32601 # Method does not exist
    INVALID_PARAMS = -32602   # Invalid method parameters
    INTERNAL_ERROR = -32603   # Internal JSON-RPC error
    SERVER_ERROR = -32000     # Server errors: -32000 to -32099


def make_error_response(
    id: Union[str, int, None],
    code: int,
    message: str,
    data: Any = None
) -> dict:
    """Create a JSON-RPC error response."""
    response = {
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    }
    if data is not None:
        response["error"]["data"] = data
    return response


def make_success_response(id: Union[str, int, None], result: Any) -> dict:
    """Create a JSON-RPC success response."""
    return {
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }


# ============================================
# MCP Session Management
# ============================================

@dataclass
class McpSession:
    """Represents an MCP session."""
    session_id: str
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    initialized: bool = False
    client_info: Optional[Dict[str, Any]] = None
    protocol_version: str = MCP_LATEST_PROTOCOL_VERSION
    pending_messages: List[Dict[str, Any]] = field(default_factory=list)
    cobrowser_session_id: Optional[str] = None


class McpSessionStore:
    """Manages MCP sessions."""

    def __init__(self):
        self.sessions: Dict[str, McpSession] = {}
        self.session_timeout = 3600  # 1 hour

    def create_session(self) -> McpSession:
        """Create a new session with a cryptographically secure ID."""
        session_id = secrets.token_urlsafe(32)
        session = McpSession(session_id=session_id)
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[McpSession]:
        """Get a session by ID."""
        session = self.sessions.get(session_id)
        if session:
            session.last_activity = time.time()
        return session

    def delete_session(self, session_id: str) -> None:
        """Delete a session."""
        self.sessions.pop(session_id, None)

    def cleanup_expired(self) -> None:
        """Remove expired sessions."""
        now = time.time()
        expired = [
            sid for sid, session in self.sessions.items()
            if now - session.last_activity > self.session_timeout
        ]
        for sid in expired:
            del self.sessions[sid]

    def queue_message(self, session_id: str, message: Dict[str, Any]) -> None:
        """Queue a server→client message for SSE delivery."""
        session = self.get_session(session_id)
        if session:
            session.pending_messages.append(message)

    async def get_pending_message(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get and remove the next pending message for a session."""
        session = self.get_session(session_id)
        if session and session.pending_messages:
            return session.pending_messages.pop(0)
        return None


# Global MCP session store
mcp_session_store = McpSessionStore()


# ============================================
# MCP Tool Definitions
# ============================================

from .tool_definitions import get_all_tool_definitions, TOOL_TO_COMMAND as MCP_TOOL_TO_COMMAND


def get_mcp_tool_definitions() -> List[Dict[str, Any]]:
    """Return MCP tool definitions for browser automation.

    Delegates to the shared tool_definitions module (single source of truth).
    """
    return get_all_tool_definitions()


# ============================================
# Enums and Data Models
# ============================================

class ControlMode(str, Enum):
    CLAUDE = "CLAUDE"
    HUMAN = "HUMAN"
    SHARED = "SHARED"


class ModeUpdate(BaseModel):
    mode: str


@dataclass
class Session:
    """Represents a co-browsing session."""
    session_id: str
    control_mode: ControlMode = ControlMode.CLAUDE
    created_at: float = field(default_factory=time.time)
    state: Dict[str, Any] = field(default_factory=dict)
    command_queue: List[Dict] = field(default_factory=list)
    user_requests: List[Dict] = field(default_factory=list)  # Natural language requests from user


# ============================================
# Message Helpers
# ============================================

def create_message(
    msg_type: str,
    session_id: str,
    payload: Dict[str, Any],
    correlation_id: Optional[str] = None
) -> Dict[str, Any]:
    """Create a properly formatted message."""
    msg = {
        "id": str(uuid.uuid4()),
        "type": msg_type,
        "timestamp": time.time(),
        "session_id": session_id,
        "payload": payload
    }
    if correlation_id:
        msg["correlation_id"] = correlation_id
    return msg


# ============================================
# CoBrowserService Class
# ============================================

class CoBrowserService:
    """
    Manages co-browsing sessions and WebSocket connections.
    """

    def __init__(self):
        # Active WebSocket connections: session_id -> WebSocket
        self.active_sessions: Dict[str, WebSocket] = {}
        # All sessions (including disconnected): session_id -> Session
        self.sessions: Dict[str, Session] = {}
        # Track session history for tests
        self.session_history: set = set()
        # Pending command responses: message_id -> (Future, result)
        self.pending_responses: Dict[str, asyncio.Future] = {}

    def create_session(self) -> Dict[str, Any]:
        """Create a new co-browsing session."""
        session_id = str(uuid.uuid4())
        session = Session(session_id=session_id)
        self.sessions[session_id] = session
        self.session_history.add(session_id)

        return {
            "session_id": session_id,
            "control_mode": session.control_mode.value,
            "created_at": session.created_at
        }

    def get_session_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get the current state of a session."""
        session = self.sessions.get(session_id)
        if not session:
            return None

        return {
            "session_id": session.session_id,
            "control_mode": session.control_mode.value,
            "created_at": session.created_at,
            **session.state
        }

    def get_control_mode(self, session_id: str) -> Optional[str]:
        """Get the current control mode for a session."""
        session = self.sessions.get(session_id)
        if not session:
            return None
        return session.control_mode.value

    def set_control_mode(self, session_id: str, mode: str) -> None:
        """Set the control mode for a session."""
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        try:
            session.control_mode = ControlMode(mode)
        except ValueError:
            raise ValueError(f"Invalid control mode: {mode}")

    def update_session_state(self, session_id: str, state_update: Dict[str, Any]) -> None:
        """Update session state with new values."""
        session = self.sessions.get(session_id)
        if session:
            session.state.update(state_update)

    def queue_command(self, session_id: str, command: Dict[str, Any]) -> None:
        """Queue a command for later delivery."""
        session = self.sessions.get(session_id)
        if session:
            session.command_queue.append(command)

    def get_pending_commands(self, session_id: str) -> List[Dict]:
        """Get pending commands for a session."""
        session = self.sessions.get(session_id)
        if not session:
            return []
        return list(session.command_queue)

    def flush_pending_commands(self, session_id: str) -> List[Dict]:
        """Get and clear pending commands."""
        session = self.sessions.get(session_id)
        if not session:
            return []

        commands = list(session.command_queue)
        session.command_queue.clear()
        return commands

    async def handle_connection(self, websocket: WebSocket, session_id: str) -> None:
        """Handle a WebSocket connection from the browser extension."""
        # Validate session ID
        if not session_id or len(session_id.strip()) == 0:
            await websocket.close(code=4000, reason="Invalid session ID")
            return

        # Accept the connection
        await websocket.accept()

        # Register session
        self.active_sessions[session_id] = websocket
        self.session_history.add(session_id)

        # Create session if it doesn't exist
        if session_id not in self.sessions:
            self.sessions[session_id] = Session(session_id=session_id)

        try:
            # Flush any queued commands
            pending = self.flush_pending_commands(session_id)
            for cmd in pending:
                await websocket.send_json(cmd)

            # Main message loop
            while True:
                message = await websocket.receive_json()
                response = await self.process_message(message, session_id)
                if response:
                    await websocket.send_json(response)

        except WebSocketDisconnect:
            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        finally:
            # Cleanup on disconnect
            if session_id in self.active_sessions:
                del self.active_sessions[session_id]

    async def process_message(
        self,
        message: Dict[str, Any],
        session_id: str
    ) -> Optional[Dict[str, Any]]:
        """Process an incoming message and return a response."""
        msg_type = message.get("type", "")
        msg_id = message.get("id", "")
        correlation_id = message.get("correlation_id", "")

        # Handle heartbeat
        if msg_type == "heartbeat":
            return create_message(
                msg_type="heartbeat.ack",
                session_id=session_id,
                payload={},
                correlation_id=msg_id
            )

        # Handle command results from the extension
        if msg_type.endswith(".result"):
            if correlation_id and correlation_id in self.pending_responses:
                future = self.pending_responses.pop(correlation_id)
                if not future.done():
                    future.set_result(message)
            return None  # No response needed for results

        # Handle state updates from the extension
        if msg_type == "state.update":
            self.update_session_state(session_id, message.get("payload", {}))
            return None

        # Handle natural language commands from the user
        if msg_type == "command.natural":
            session = self.sessions.get(session_id)
            if session:
                session.user_requests.append({
                    "id": msg_id,
                    "text": message.get("payload", {}).get("text", ""),
                    "context": message.get("payload", {}).get("context", {}),
                    "timestamp": time.time()
                })
            return create_message(
                msg_type="command.natural.ack",
                session_id=session_id,
                payload={"status": "received"},
                correlation_id=msg_id
            )

        # Handle native automation commands (executed on server side)
        if msg_type == "native.click":
            payload = message.get("payload", {})
            result = await handle_native_click(
                payload.get("screenX", 0),
                payload.get("screenY", 0)
            )
            return create_message(
                msg_type="native.click.result",
                session_id=session_id,
                payload=result,
                correlation_id=correlation_id or msg_id
            )

        if msg_type == "native.type":
            payload = message.get("payload", {})
            result = await handle_native_type(payload.get("text", ""))
            return create_message(
                msg_type="native.type.result",
                session_id=session_id,
                payload=result,
                correlation_id=correlation_id or msg_id
            )

        if msg_type == "native.hotkey":
            payload = message.get("payload", {})
            result = await handle_native_hotkey(payload.get("keys", []))
            return create_message(
                msg_type="native.hotkey.result",
                session_id=session_id,
                payload=result,
                correlation_id=correlation_id or msg_id
            )

        if msg_type == "native.cancel":
            result = await handle_native_cancel()
            return create_message(
                msg_type="native.cancel.result",
                session_id=session_id,
                payload=result,
                correlation_id=correlation_id or msg_id
            )

        if msg_type == "native.permission":
            payload = message.get("payload", {})
            allowed = payload.get("allowed", False)
            result = await handle_native_permission(allowed)
            return create_message(
                msg_type="native.permission.result",
                session_id=session_id,
                payload=result,
                correlation_id=correlation_id or msg_id
            )

        # Handle commands (placeholder for now)
        if msg_type.startswith("command."):
            return create_message(
                msg_type=f"{msg_type}.ack",
                session_id=session_id,
                payload={"status": "received"},
                correlation_id=msg_id
            )

        # Default acknowledgment
        return create_message(
            msg_type="ack",
            session_id=session_id,
            payload={},
            correlation_id=msg_id
        )

    async def send_command(
        self,
        session_id: str,
        command_type: str,
        payload: Dict[str, Any]
    ) -> Optional[str]:
        """Send a command to the browser extension."""
        message = create_message(
            msg_type=command_type,
            session_id=session_id,
            payload=payload
        )

        websocket = self.active_sessions.get(session_id)
        if websocket:
            await websocket.send_json(message)
            return message["id"]
        else:
            # Queue command for later delivery
            self.queue_command(session_id, message)
            return message["id"]

    async def send_command_and_wait(
        self,
        session_id: str,
        command_type: str,
        payload: Dict[str, Any],
        timeout: float = 30.0
    ) -> Dict[str, Any]:
        """Send a command and wait for the response."""
        message = create_message(
            msg_type=command_type,
            session_id=session_id,
            payload=payload
        )
        message_id = message["id"]

        websocket = self.active_sessions.get(session_id)
        if not websocket:
            return {"success": False, "error": "No active connection"}

        # Create a future to wait for the response
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.pending_responses[message_id] = future

        try:
            await websocket.send_json(message)
            result = await asyncio.wait_for(future, timeout=timeout)
            return {
                "success": True,
                "result": result.get("payload", {}),
                "message_type": result.get("type", "")
            }
        except asyncio.TimeoutError:
            self.pending_responses.pop(message_id, None)
            return {"success": False, "error": "Command timed out"}
        except Exception as e:
            self.pending_responses.pop(message_id, None)
            return {"success": False, "error": str(e)}


# ============================================
# FastAPI Application
# ============================================

app = FastAPI(
    title="Co-Browser Service",
    description="WebSocket service for Claude-human collaborative browsing",
    version="0.1.0"
)

# Global service instance
service = CoBrowserService()


@app.get("/")
def read_root():
    """Health check endpoint."""
    return {"status": "ok", "service": "cobrowser"}


@app.post("/v1/cobrowser/session")
def create_session():
    """Create a new co-browsing session."""
    return service.create_session()


@app.get("/v1/cobrowser/session/{session_id}")
def get_session(session_id: str):
    """Get session state."""
    state = service.get_session_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    return state


@app.patch("/v1/cobrowser/session/{session_id}/mode")
def update_control_mode(session_id: str, update: ModeUpdate):
    """Update the control mode for a session."""
    try:
        service.set_control_mode(session_id, update.mode)
        return {"session_id": session_id, "control_mode": update.mode}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.websocket("/v1/cobrowser/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for browser extension connection."""
    await service.handle_connection(websocket, session_id)


@app.get("/v1/cobrowser/sessions/active")
def list_active_sessions():
    """List all active (connected) sessions."""
    return {
        "sessions": list(service.active_sessions.keys()),
        "count": len(service.active_sessions)
    }


@app.post("/v1/cobrowser/command/{session_id}")
async def send_command(session_id: str, command: Dict[str, Any]):
    """Send a command to the browser extension."""
    command_type = command.get("type", "command.unknown")
    payload = command.get("payload", {})

    message_id = await service.send_command(session_id, command_type, payload)

    return {
        "message_id": message_id,
        "queued": session_id not in service.active_sessions
    }


@app.post("/v1/cobrowser/command/{session_id}/sync")
async def send_command_sync(session_id: str, command: Dict[str, Any]):
    """Send a command and wait for the response."""
    command_type = command.get("type", "command.unknown")
    payload = command.get("payload", {})
    timeout = command.get("timeout", 30.0)

    # Pass tab_id and agent_id through if present in the top-level command object
    # (they may also already be in the payload, but support both locations)
    if "tab_id" in command and "tab_id" not in payload:
        payload = dict(payload)
        payload["tab_id"] = command["tab_id"]
    if "agent_id" in command and "agent_id" not in payload:
        payload = dict(payload)
        payload["agent_id"] = command["agent_id"]

    # tab.* commands are forwarded to the extension via WebSocket and resolved there
    if command_type.startswith("tab."):
        result = await service.send_command_and_wait(
            session_id, command_type, payload, timeout
        )
        return result

    # Handle native automation commands directly in Python
    # These require getting screen coords from extension, then executing pyautogui
    if command_type == "command.nativeClick":
        # Check if direct x,y coordinates provided (for testing)
        screen_x = payload.get("x")
        screen_y = payload.get("y")
        debug_info = None

        if screen_x is None or screen_y is None:
            # Get screen coordinates from the extension via selector/xpath
            coords_result = await service.send_command_and_wait(
                session_id, "command.getScreenCoordinates", payload, timeout
            )
            if not coords_result.get("success"):
                return coords_result

            result_data = coords_result.get("result", {})
            screen_x = result_data.get("screenX")
            screen_y = result_data.get("screenY")
            debug_info = result_data.get("debug")

            if screen_x is None or screen_y is None:
                return {"success": False, "error": "Failed to get screen coordinates"}

            # Apply X11 coordinate correction for multi-monitor setups
            screen_x, screen_y = calculate_corrected_screen_coords(
                screen_x, screen_y, debug_info
            )

        # Execute the native click
        click_result = await handle_native_click(screen_x, screen_y)
        return {
            "success": click_result.get("success", False),
            "result": click_result,
            "corrected_coords": {"x": screen_x, "y": screen_y}
        }

    elif command_type == "command.nativeMove":
        # Check if direct x,y coordinates provided (for testing)
        screen_x = payload.get("x")
        screen_y = payload.get("y")
        debug_info = None

        if screen_x is None or screen_y is None:
            # Get screen coordinates from the extension via selector/xpath
            coords_result = await service.send_command_and_wait(
                session_id, "command.getScreenCoordinates", payload, timeout
            )
            if not coords_result.get("success"):
                return coords_result

            result_data = coords_result.get("result", {})
            screen_x = result_data.get("screenX")
            screen_y = result_data.get("screenY")
            debug_info = result_data.get("debug")

            if screen_x is None or screen_y is None:
                return {"success": False, "error": "Failed to get screen coordinates"}

            # Log debug info for troubleshooting
            print(f"[MOVE DEBUG] Extension coords: ({screen_x}, {screen_y})")
            if debug_info:
                print(f"[MOVE DEBUG] Debug info: {debug_info}")

            # Apply X11 coordinate correction for multi-monitor setups
            screen_x, screen_y = calculate_corrected_screen_coords(
                screen_x, screen_y, debug_info
            )

        # Execute the native move (no click)
        move_result = await handle_native_move(screen_x, screen_y)
        return {
            "success": move_result.get("success", False),
            "result": move_result,
            "corrected_coords": {"x": screen_x, "y": screen_y},
            "debug_info": debug_info
        }

    elif command_type == "command.nativeType":
        text = payload.get("text", "")
        type_result = await handle_native_type(text)
        return {"success": type_result.get("success", False), "result": type_result}

    elif command_type == "command.nativeHotkey":
        keys = payload.get("keys", [])
        hotkey_result = await handle_native_hotkey(keys)
        return {"success": hotkey_result.get("success", False), "result": hotkey_result}

    elif command_type == "command.nativeScroll":
        clicks = payload.get("clicks", -3)  # Default scroll down
        scroll_result = await handle_native_scroll(clicks)
        return {"success": scroll_result.get("success", False), "result": scroll_result}

    # Standard command - send via WebSocket and wait for response
    result = await service.send_command_and_wait(
        session_id, command_type, payload, timeout
    )

    return result


@app.get("/v1/cobrowser/user-requests")
def get_user_requests():
    """Get pending user requests from all active sessions."""
    requests = []
    for session_id, session in service.sessions.items():
        if session_id in service.active_sessions:
            for req in session.user_requests:
                requests.append({
                    "session_id": session_id,
                    **req
                })
    return {"requests": requests, "count": len(requests)}


@app.delete("/v1/cobrowser/user-requests/{request_id}")
def clear_user_request(request_id: str):
    """Clear a specific user request after processing."""
    for session in service.sessions.values():
        session.user_requests = [r for r in session.user_requests if r.get("id") != request_id]
    return {"success": True}


# ============================================
# MCP Protocol Handlers
# ============================================

async def handle_mcp_initialize(
    mcp_session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle the MCP initialize request."""
    if mcp_session.initialized:
        raise ValueError("Session already initialized")

    params = params or {}
    client_protocol = params.get("protocolVersion", MCP_LATEST_PROTOCOL_VERSION)
    client_info = params.get("clientInfo", {})

    # Negotiate protocol version
    if client_protocol in MCP_SUPPORTED_PROTOCOL_VERSIONS:
        mcp_session.protocol_version = client_protocol
    else:
        mcp_session.protocol_version = MCP_LATEST_PROTOCOL_VERSION

    mcp_session.client_info = client_info
    mcp_session.initialized = True

    return {
        "protocolVersion": mcp_session.protocol_version,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": MCP_SERVER_INFO
    }


async def handle_mcp_initialized(
    mcp_session: McpSession,
    params: Optional[Dict[str, Any]]
) -> None:
    """Handle the initialized notification (no response needed)."""
    pass


async def handle_mcp_tools_list(
    mcp_session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle tools/list request."""
    if not mcp_session.initialized:
        raise ValueError("Session not initialized")

    return {
        "tools": get_mcp_tool_definitions()
    }


async def handle_mcp_tools_call(
    mcp_session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle tools/call request - executes browser commands directly."""
    if not mcp_session.initialized:
        raise ValueError("Session not initialized")

    if not params:
        raise ValueError("Missing params")

    name = params.get("name")
    arguments = params.get("arguments", {})

    if not name:
        raise ValueError("Missing tool name")

    # Handle delay tool specially (server-side only)
    if name == "cobrowser_delay":
        seconds = arguments.get("seconds", 0)
        if not isinstance(seconds, (int, float)):
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({"success": False, "error": "seconds must be a number"})
                }],
                "isError": True
            }
        seconds = min(max(0, float(seconds)), 30.0)
        await asyncio.sleep(seconds)
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({"success": True, "delayed": seconds})
            }],
            "isError": False
        }

    if name not in MCP_TOOL_TO_COMMAND:
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "success": False,
                    "error": f"Unknown tool: {name}"
                })
            }],
            "isError": True
        }

    command_type, payload_fn = MCP_TOOL_TO_COMMAND[name]
    # Strip tab_id/agent_id before building command payload (handled separately)
    filtered_args = {k: v for k, v in arguments.items() if k not in ("tab_id", "agent_id")}
    payload = payload_fn(filtered_args)

    # Pass tab_id and agent_id through for multi-tab routing
    if arguments.get("tab_id") is not None:
        payload["tab_id"] = arguments["tab_id"]
    if arguments.get("agent_id") is not None:
        payload["agent_id"] = arguments["agent_id"]

    try:
        # Get active cobrowser sessions
        active_sessions = list(service.active_sessions.keys())

        if not active_sessions:
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "success": False,
                        "error": "No active browser session. Make sure the extension is connected."
                    })
                }],
                "isError": True
            }

        # Use first active session
        cobrowser_session_id = active_sessions[0]
        mcp_session.cobrowser_session_id = cobrowser_session_id

        # Execute command directly via the service (no HTTP hop!)
        result = await service.send_command_and_wait(
            cobrowser_session_id, command_type, payload, timeout=30.0
        )

        # Post-navigation delay for JS hydration (e.g. Yahoo Finance real-time prices)
        if name == "cobrowser_navigate":
            delay = arguments.get("delay", 0)
            if delay and delay > 0:
                delay = min(float(delay), 30.0)
                await asyncio.sleep(delay)

        # For tab commands, unwrap the inner result payload for cleaner output
        if name.startswith("cobrowser_tab_"):
            inner = result.get("result", result)
            # inner is the payload from the extension: {success, tabs/tab_id/...}
            is_error = not inner.get("success", False)
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps(inner)
                }],
                "isError": is_error
            }

        return {
            "content": [{
                "type": "text",
                "text": json.dumps(result)
            }],
            "isError": not result.get("success", False)
        }

    except asyncio.TimeoutError:
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "success": False,
                    "error": "Command timed out"
                })
            }],
            "isError": True
        }
    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "success": False,
                    "error": str(e)
                })
            }],
            "isError": True
        }


async def handle_mcp_ping(
    mcp_session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle ping request."""
    return {}


# MCP method router
MCP_METHOD_HANDLERS = {
    "initialize": handle_mcp_initialize,
    "initialized": handle_mcp_initialized,
    "tools/list": handle_mcp_tools_list,
    "tools/call": handle_mcp_tools_call,
    "ping": handle_mcp_ping,
}


# ============================================
# MCP HTTP Endpoints
# ============================================

@app.post("/mcp")
async def mcp_post(
    request: Request,
    mcp_session_id: Optional[str] = Header(None, alias="Mcp-Session-Id"),
    mcp_protocol_version: Optional[str] = Header(None, alias="MCP-Protocol-Version")
):
    """
    MCP POST endpoint - handles client→server JSON-RPC messages.

    Supports:
    - initialize: Start a new session
    - tools/list: List available tools
    - tools/call: Execute a tool
    - ping: Health check
    """
    # Parse request body
    try:
        body = await request.json()
    except json.JSONDecodeError as e:
        return JSONResponse(
            status_code=200,
            content=make_error_response(None, ErrorCode.PARSE_ERROR, f"Parse error: {e}")
        )

    # Validate JSON-RPC structure
    if not isinstance(body, dict):
        return JSONResponse(
            status_code=200,
            content=make_error_response(None, ErrorCode.INVALID_REQUEST, "Request must be an object")
        )

    jsonrpc = body.get("jsonrpc")
    request_id = body.get("id")
    method = body.get("method")
    params = body.get("params")

    if jsonrpc != "2.0":
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INVALID_REQUEST, "jsonrpc must be '2.0'")
        )

    if not method or not isinstance(method, str):
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INVALID_REQUEST, "method must be a string")
        )

    # Handle initialize specially - creates new session
    if method == "initialize":
        mcp_session = mcp_session_store.create_session()
        try:
            result = await handle_mcp_initialize(mcp_session, params)
            response = JSONResponse(
                status_code=200,
                content=make_success_response(request_id, result)
            )
            response.headers["Mcp-Session-Id"] = mcp_session.session_id
            return response
        except Exception as e:
            mcp_session_store.delete_session(mcp_session.session_id)
            return JSONResponse(
                status_code=200,
                content=make_error_response(request_id, ErrorCode.INTERNAL_ERROR, str(e))
            )

    # All other methods require a session
    if not mcp_session_id:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INVALID_REQUEST, "Mcp-Session-Id header required")
        )

    mcp_session = mcp_session_store.get_session(mcp_session_id)
    if not mcp_session:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INVALID_REQUEST, "Invalid or expired session")
        )

    # Find handler
    handler = MCP_METHOD_HANDLERS.get(method)
    if not handler:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.METHOD_NOT_FOUND, f"Method not found: {method}")
        )

    # Execute handler
    try:
        result = await handler(mcp_session, params)

        # Notifications (no id) don't get responses
        if request_id is None:
            return Response(status_code=202)

        return JSONResponse(
            status_code=200,
            content=make_success_response(request_id, result)
        )
    except ValueError as e:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INVALID_PARAMS, str(e))
        )
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INTERNAL_ERROR, str(e))
        )


@app.get("/mcp")
async def mcp_get(
    request: Request,
    mcp_session_id: Optional[str] = Header(None, alias="Mcp-Session-Id"),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID")
):
    """
    MCP GET endpoint - SSE stream for server→client messages.

    Used for:
    - Server-initiated notifications
    - Progress updates
    - Resource change notifications
    """
    accept = request.headers.get("Accept", "")
    if "text/event-stream" not in accept:
        raise HTTPException(status_code=406, detail="Must accept text/event-stream")

    if not mcp_session_id:
        raise HTTPException(status_code=400, detail="Mcp-Session-Id header required")

    mcp_session = mcp_session_store.get_session(mcp_session_id)
    if not mcp_session:
        raise HTTPException(status_code=400, detail="Invalid or expired session")

    async def event_generator():
        """Generate SSE events for pending messages."""
        event_id = 0
        while True:
            message = await mcp_session_store.get_pending_message(mcp_session_id)
            if message:
                event_id += 1
                yield {
                    "event": "message",
                    "id": str(event_id),
                    "data": json.dumps(message)
                }
            else:
                yield {"comment": "keepalive"}
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


# ============================================
# Legacy MCP Endpoints (Backward Compatibility)
# ============================================

class LegacyToolCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = {}
    session_id: str


@app.get("/mcp/tools")
def list_tools_legacy():
    """[DEPRECATED] List available MCP tools. Use POST /mcp with tools/list method."""
    return {"tools": get_mcp_tool_definitions()}


@app.post("/mcp/call")
async def call_tool_legacy(request: LegacyToolCallRequest):
    """[DEPRECATED] Call an MCP tool. Use POST /mcp with tools/call method."""
    mcp_session = McpSession(session_id="legacy", initialized=True)
    mcp_session.cobrowser_session_id = request.session_id

    result = await handle_mcp_tools_call(mcp_session, {
        "name": request.name,
        "arguments": request.arguments
    })

    return {"result": result}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8677)
