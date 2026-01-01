"""
MCP HTTP Server for Co-Browser

Fully compliant Model Context Protocol (MCP) Streamable HTTP transport server
for browser automation with human-in-the-loop support.

Implements:
- JSON-RPC 2.0 message format
- Single /mcp endpoint (POST for client→server, GET for SSE server→client)
- Session management via Mcp-Session-Id header
- Protocol version negotiation via MCP-Protocol-Version header
- Standard error codes per JSON-RPC spec

Run with:
    python -m uvicorn src.Library.mcp_tools:app --host 0.0.0.0 --port 8678
"""

import asyncio
import json
import secrets
import time
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field

import httpx
from fastapi import FastAPI, HTTPException, Request, Header, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse


# CoBrowser service URL (the WebSocket backend)
COBROWSER_SERVICE_URL = "http://localhost:8677"


# ============================================
# Configuration
# ============================================

SERVER_INFO = {
    "name": "cobrowser-mcp",
    "version": "0.2.0"
}

SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
LATEST_PROTOCOL_VERSION = "2025-06-18"

# ============================================
# JSON-RPC 2.0 Models
# ============================================

class JsonRpcRequest(BaseModel):
    """JSON-RPC 2.0 Request"""
    jsonrpc: str = "2.0"
    id: Optional[Union[str, int]] = None  # None for notifications
    method: str
    params: Optional[Dict[str, Any]] = None


class JsonRpcResponse(BaseModel):
    """JSON-RPC 2.0 Response"""
    jsonrpc: str = "2.0"
    id: Union[str, int, None]
    result: Any


class JsonRpcErrorDetail(BaseModel):
    """JSON-RPC 2.0 Error Detail"""
    code: int
    message: str
    data: Optional[Any] = None


class JsonRpcErrorResponse(BaseModel):
    """JSON-RPC 2.0 Error Response"""
    jsonrpc: str = "2.0"
    id: Union[str, int, None]
    error: JsonRpcErrorDetail


# JSON-RPC 2.0 Standard Error Codes
class ErrorCode:
    PARSE_ERROR = -32700      # Invalid JSON
    INVALID_REQUEST = -32600  # Not a valid Request object
    METHOD_NOT_FOUND = -32601 # Method does not exist
    INVALID_PARAMS = -32602   # Invalid method parameters
    INTERNAL_ERROR = -32603   # Internal JSON-RPC error
    # Server errors: -32000 to -32099
    SERVER_ERROR = -32000


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
# Session Management
# ============================================

@dataclass
class McpSession:
    """Represents an MCP session."""
    session_id: str
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    initialized: bool = False
    client_info: Optional[Dict[str, Any]] = None
    protocol_version: str = LATEST_PROTOCOL_VERSION
    # Queue for server→client messages (for SSE)
    pending_messages: List[Dict[str, Any]] = field(default_factory=list)
    # Associated cobrowser session ID
    cobrowser_session_id: Optional[str] = None


class SessionStore:
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


# Global session store
session_store = SessionStore()


# ============================================
# Tool Definitions
# ============================================

def get_tool_definitions() -> List[Dict[str, Any]]:
    """Return MCP tool definitions."""
    return [
        {
            "name": "cobrowser_navigate",
            "description": "Navigate the browser to a URL. Use this to open web pages.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to navigate to"
                    }
                },
                "required": ["url"]
            }
        },
        {
            "name": "cobrowser_click",
            "description": "Click an element on the page. Use CSS selector or XPath to identify the element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to click"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath for the element to click (alternative to selector)"
                    },
                    "index": {
                        "type": "number",
                        "description": "0-based index of which matching element to click (default: 0)"
                    }
                }
            }
        },
        {
            "name": "cobrowser_doubleclick",
            "description": "Double-click an element on the page. Use for opening dialogs, search boxes in canvas UIs like ComfyUI. For canvas elements, use x,y coordinates.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to double-click"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath expression for the element"
                    },
                    "x": {
                        "type": "number",
                        "description": "X coordinate (viewport) - use with y for canvas elements"
                    },
                    "y": {
                        "type": "number",
                        "description": "Y coordinate (viewport) - use with x for canvas elements"
                    }
                }
            }
        },
        {
            "name": "cobrowser_rightclick",
            "description": "Right-click an element to open a context menu. For canvas elements, use x,y coordinates.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to right-click"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath expression for the element"
                    },
                    "x": {
                        "type": "number",
                        "description": "X coordinate (viewport) - use with y for canvas elements"
                    },
                    "y": {
                        "type": "number",
                        "description": "Y coordinate (viewport) - use with x for canvas elements"
                    }
                }
            }
        },
        {
            "name": "cobrowser_drag",
            "description": "Drag an element from one location to another. Use for connecting nodes in canvas UIs, moving elements, or drag-and-drop operations.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the source element to drag"
                    },
                    "targetSelector": {
                        "type": "string",
                        "description": "CSS selector for the target element to drop on"
                    },
                    "targetX": {
                        "type": "number",
                        "description": "Target X coordinate (alternative to targetSelector)"
                    },
                    "targetY": {
                        "type": "number",
                        "description": "Target Y coordinate (alternative to targetSelector)"
                    }
                },
                "required": ["selector"]
            }
        },
        {
            "name": "cobrowser_type",
            "description": "Type text into an input field. Cannot type into password fields for security.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the input element"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath for the input element (alternative to selector)"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type into the element"
                    },
                    "clear": {
                        "type": "boolean",
                        "description": "Clear the field before typing (default: false)"
                    }
                },
                "required": ["text"]
            }
        },
        {
            "name": "cobrowser_read",
            "description": "Read content from an element on the page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to read"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath for the element to read"
                    }
                }
            }
        },
        {
            "name": "cobrowser_scroll",
            "description": "Scroll the page or scroll to an element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "enum": ["up", "down"],
                        "description": "Direction to scroll"
                    },
                    "amount": {
                        "type": "number",
                        "description": "Pixels to scroll (default: 300)"
                    },
                    "selector": {
                        "type": "string",
                        "description": "Scroll to this element"
                    }
                }
            }
        },
        {
            "name": "cobrowser_get_page_info",
            "description": "Get the current page URL and title.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "cobrowser_query_all",
            "description": "Query all elements matching a selector. Returns info about each element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to match elements"
                    },
                    "limit": {
                        "type": "number",
                        "description": "Maximum number of elements to return (default: 20)"
                    }
                },
                "required": ["selector"]
            }
        },
        {
            "name": "cobrowser_screenshot",
            "description": "Take a screenshot of the current visible browser tab.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "cobrowser_request_human",
            "description": "Request human assistance. Use when encountering CAPTCHAs, login pages, or sensitive actions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Reason for handoff: 'captcha', 'login', 'payment', 'verification', 'other'"
                    },
                    "message": {
                        "type": "string",
                        "description": "Message to show the user explaining what's needed"
                    }
                },
                "required": ["reason", "message"]
            }
        },
        {
            "name": "cobrowser_get_user_requests",
            "description": "Get pending user requests from the browser. Users can right-click and 'Ask Claude...' to send natural language requests. Check this periodically to see if users need help.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "cobrowser_clear_user_request",
            "description": "Clear a user request after you've handled it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "request_id": {
                        "type": "string",
                        "description": "The ID of the request to clear"
                    }
                },
                "required": ["request_id"]
            }
        },
        {
            "name": "cobrowser_native_click",
            "description": "Perform an OS-level mouse click on an element. Use this for buttons that open popups (like LinkedIn Apply) which don't work with synthetic clicks. Requires 'Allow Mouse/Keyboard Control' permission in the extension popup.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to click"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath expression for the element"
                    },
                    "index": {
                        "type": "number",
                        "description": "0-based index of which matching element to click (default: 0)"
                    }
                }
            }
        },
        {
            "name": "cobrowser_native_move",
            "description": "Move the mouse to an element without clicking. Use for debugging native click positioning. Requires 'Allow Mouse/Keyboard Control' permission.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element"
                    },
                    "xpath": {
                        "type": "string",
                        "description": "XPath expression for the element"
                    },
                    "index": {
                        "type": "number",
                        "description": "0-based index of which matching element (default: 0)"
                    }
                }
            }
        },
        {
            "name": "cobrowser_native_type",
            "description": "Type text using OS-level keyboard input. Use this for file upload dialogs and other native OS dialogs that don't accept synthetic events. Requires 'Allow Mouse/Keyboard Control' permission.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to type (e.g., file path for file dialogs)"
                    }
                },
                "required": ["text"]
            }
        },
        {
            "name": "cobrowser_native_hotkey",
            "description": "Press a keyboard hotkey combination using OS-level input. Use for keyboard shortcuts in native dialogs. Requires 'Allow Mouse/Keyboard Control' permission.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keys": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Keys to press together (e.g., ['ctrl', 'l'] or ['enter'])"
                    }
                },
                "required": ["keys"]
            }
        },
        {
            "name": "cobrowser_native_scroll",
            "description": "Scroll the mouse wheel at current cursor position. Use after moving mouse to a scrollable element (like a dropdown). Positive clicks scroll up, negative scroll down. Requires 'Allow Mouse/Keyboard Control' permission.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clicks": {
                        "type": "integer",
                        "description": "Number of scroll clicks. Positive = up, negative = down. Default: -3 (scroll down)"
                    }
                }
            }
        }
    ]


# ============================================
# Protocol Method Handlers
# ============================================

async def handle_initialize(
    session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle the initialize request."""
    if session.initialized:
        raise ValueError("Session already initialized")

    # Extract client info
    params = params or {}
    client_protocol = params.get("protocolVersion", LATEST_PROTOCOL_VERSION)
    client_info = params.get("clientInfo", {})

    # Negotiate protocol version
    if client_protocol in SUPPORTED_PROTOCOL_VERSIONS:
        session.protocol_version = client_protocol
    else:
        session.protocol_version = LATEST_PROTOCOL_VERSION

    session.client_info = client_info
    session.initialized = True

    return {
        "protocolVersion": session.protocol_version,
        "capabilities": {
            "tools": {}  # We support tools
        },
        "serverInfo": SERVER_INFO
    }


async def handle_initialized(
    session: McpSession,
    params: Optional[Dict[str, Any]]
) -> None:
    """Handle the initialized notification (no response needed)."""
    # Client is confirming it received initialize response
    pass


async def handle_tools_list(
    session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle tools/list request."""
    if not session.initialized:
        raise ValueError("Session not initialized")

    return {
        "tools": get_tool_definitions()
    }


async def handle_tools_call(
    session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle tools/call request."""
    if not session.initialized:
        raise ValueError("Session not initialized")

    if not params:
        raise ValueError("Missing params")

    name = params.get("name")
    arguments = params.get("arguments", {})

    if not name:
        raise ValueError("Missing tool name")

    # Map tool names to command types
    tool_to_command = {
        "cobrowser_navigate": ("command.navigate", lambda a: {"url": a.get("url")}),
        "cobrowser_click": ("command.click", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_doubleclick": ("command.doubleclick", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_rightclick": ("command.rightclick", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_drag": ("command.drag", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_type": ("command.type", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_read": ("command.read", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_scroll": ("command.scroll", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_get_page_info": ("command.getState", lambda a: {}),
        "cobrowser_query_all": ("command.queryAll", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_screenshot": ("command.screenshot", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_request_human": ("handoff.request", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_get_user_requests": ("user_requests.list", lambda a: {}),
        "cobrowser_clear_user_request": ("user_requests.clear", lambda a: {"request_id": a.get("request_id")}),
        "cobrowser_native_click": ("command.nativeClick", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_native_move": ("command.nativeMove", lambda a: {k: v for k, v in a.items() if v is not None}),
        "cobrowser_native_type": ("command.nativeType", lambda a: {"text": a.get("text")}),
        "cobrowser_native_hotkey": ("command.nativeHotkey", lambda a: {"keys": a.get("keys")}),
        "cobrowser_native_scroll": ("command.nativeScroll", lambda a: {"clicks": a.get("clicks", -3)}),
    }

    if name not in tool_to_command:
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

    command_type, payload_fn = tool_to_command[name]
    payload = payload_fn(arguments)

    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            # Get active sessions from cobrowser service
            sessions_resp = await client.get(f"{COBROWSER_SERVICE_URL}/v1/cobrowser/sessions/active")
            if sessions_resp.status_code != 200:
                return {
                    "content": [{
                        "type": "text",
                        "text": json.dumps({
                            "success": False,
                            "error": "CoBrowser service not available"
                        })
                    }],
                    "isError": True
                }

            sessions_data = sessions_resp.json()
            active_sessions = sessions_data.get("sessions", [])

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

            # Use first active session (sessions are just ID strings)
            cobrowser_session_id = active_sessions[0]
            session.cobrowser_session_id = cobrowser_session_id

            # Send command via HTTP to cobrowser service
            cmd_resp = await client.post(
                f"{COBROWSER_SERVICE_URL}/v1/cobrowser/command/{cobrowser_session_id}/sync",
                json={
                    "type": command_type,
                    "payload": payload
                }
            )

            result = cmd_resp.json()

            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps(result)
                }],
                "isError": not result.get("success", False)
            }

    except httpx.TimeoutException:
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
    except httpx.ConnectError:
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "success": False,
                    "error": "Cannot connect to CoBrowser service. Is it running on port 8677?"
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


async def handle_ping(
    session: McpSession,
    params: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Handle ping request."""
    return {}


# Method router
METHOD_HANDLERS = {
    "initialize": handle_initialize,
    "initialized": handle_initialized,  # Notification
    "tools/list": handle_tools_list,
    "tools/call": handle_tools_call,
    "ping": handle_ping,
}


# ============================================
# FastAPI Application
# ============================================

app = FastAPI(
    title="Co-Browser MCP HTTP Server",
    description="MCP Streamable HTTP transport server for browser automation",
    version="0.2.0"
)


@app.get("/")
def read_root():
    """Health check."""
    return {"status": "ok", "service": "cobrowser-mcp", "version": SERVER_INFO["version"]}


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
            status_code=200,  # JSON-RPC errors use 200 status
            content=make_error_response(None, ErrorCode.PARSE_ERROR, f"Parse error: {e}")
        )

    # Validate JSON-RPC structure
    if not isinstance(body, dict):
        return JSONResponse(
            status_code=200,
            content=make_error_response(None, ErrorCode.INVALID_REQUEST, "Request must be an object")
        )

    jsonrpc = body.get("jsonrpc")
    request_id = body.get("id")  # May be None for notifications
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
        session = session_store.create_session()
        try:
            result = await handle_initialize(session, params)
            response = JSONResponse(
                status_code=200,
                content=make_success_response(request_id, result)
            )
            response.headers["Mcp-Session-Id"] = session.session_id
            return response
        except Exception as e:
            session_store.delete_session(session.session_id)
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

    session = session_store.get_session(mcp_session_id)
    if not session:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.INVALID_REQUEST, "Invalid or expired session")
        )

    # Find handler
    handler = METHOD_HANDLERS.get(method)
    if not handler:
        return JSONResponse(
            status_code=200,
            content=make_error_response(request_id, ErrorCode.METHOD_NOT_FOUND, f"Method not found: {method}")
        )

    # Execute handler
    try:
        result = await handler(session, params)

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
    # Check Accept header
    accept = request.headers.get("Accept", "")
    if "text/event-stream" not in accept:
        raise HTTPException(status_code=406, detail="Must accept text/event-stream")

    if not mcp_session_id:
        raise HTTPException(status_code=400, detail="Mcp-Session-Id header required")

    session = session_store.get_session(mcp_session_id)
    if not session:
        raise HTTPException(status_code=400, detail="Invalid or expired session")

    async def event_generator():
        """Generate SSE events for pending messages."""
        event_id = 0
        while True:
            # Check for pending messages
            message = await session_store.get_pending_message(mcp_session_id)
            if message:
                event_id += 1
                yield {
                    "event": "message",
                    "id": str(event_id),
                    "data": json.dumps(message)
                }
            else:
                # Send keepalive comment every 30 seconds
                yield {"comment": "keepalive"}
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


# ============================================
# Legacy Endpoints (Backward Compatibility)
# ============================================

class LegacyToolCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = {}
    session_id: str


@app.get("/mcp/tools")
def list_tools_legacy():
    """[DEPRECATED] List available MCP tools. Use POST /mcp with tools/list method."""
    return {"tools": get_tool_definitions()}


@app.post("/mcp/call")
async def call_tool_legacy(request: LegacyToolCallRequest):
    """
    [DEPRECATED] Call an MCP tool. Use POST /mcp with tools/call method.
    """
    # Create a temporary MCP session
    session = McpSession(session_id="legacy", initialized=True)
    session.cobrowser_session_id = request.session_id

    result = await handle_tools_call(session, {
        "name": request.name,
        "arguments": request.arguments
    })

    return {"result": result}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8678)
