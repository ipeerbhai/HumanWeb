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
