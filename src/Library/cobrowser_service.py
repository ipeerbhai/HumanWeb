"""
Co-Browser WebSocket Service

This service provides WebSocket-based communication between Claude Code
and a Firefox browser extension for collaborative web browsing.

Control Modes:
- CLAUDE: AI drives the browser
- HUMAN: User has control (during handoffs)
- SHARED: Both can interact

Run with:
    python -m uvicorn src.Library.cobrowser_service:app --host 0.0.0.0 --port 8677
"""

import asyncio
import time
import uuid
from typing import Dict, List, Optional, Any
from enum import Enum
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8677)
