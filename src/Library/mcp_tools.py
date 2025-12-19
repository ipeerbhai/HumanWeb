"""
MCP Tools for Co-Browser

Provides Model Context Protocol (MCP) tools for Claude Code to control
the browser through the Co-Browser extension.

Run with:
    python -m uvicorn src.Library.mcp_tools:app --host 0.0.0.0 --port 8678
"""

import asyncio
from typing import Dict, List, Any, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


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
                    }
                }
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
                    },
                    "property": {
                        "type": "string",
                        "description": "Property to read: 'text', 'html', 'value', or an attribute name",
                        "default": "text"
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
                    },
                    "to": {
                        "type": "string",
                        "enum": ["top", "bottom"],
                        "description": "Scroll to top or bottom of page"
                    }
                }
            }
        },
        {
            "name": "cobrowser_screenshot",
            "description": "Take a screenshot of the current page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fullPage": {
                        "type": "boolean",
                        "description": "Capture full page (default: false, visible viewport only)"
                    }
                }
            }
        },
        {
            "name": "cobrowser_get_state",
            "description": "Get the current state of the browser including URL, title, and interactive elements.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "includeDOM": {
                        "type": "boolean",
                        "description": "Include cleaned DOM in response (default: false)"
                    },
                    "includeElements": {
                        "type": "boolean",
                        "description": "Include interactive elements list (default: true)"
                    }
                }
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
                    },
                    "timeout": {
                        "type": "number",
                        "description": "Timeout in seconds before auto-resuming (optional)"
                    }
                },
                "required": ["reason", "message"]
            }
        }
    ]


# ============================================
# Tool Implementation
# ============================================

class CoBrowserTools:
    """Implementation of Co-Browser MCP tools."""

    def __init__(self, service, session_id: str):
        """
        Initialize tools with a CoBrowserService instance.

        Args:
            service: CoBrowserService instance
            session_id: Session ID to operate on
        """
        self.service = service
        self.session_id = session_id

    def _check_session(self) -> Optional[Dict[str, Any]]:
        """Check if session is valid."""
        if self.session_id not in self.service.active_sessions:
            return {
                "success": False,
                "error": "No active session. Extension may be disconnected."
            }
        return None

    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL."""
        error = self._check_session()
        if error:
            return error

        try:
            message_id = await self.service.send_command(
                self.session_id,
                "command.navigate",
                {"url": url}
            )
            return {
                "success": True,
                "message_id": message_id
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Command timeout - extension did not respond"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def click(self, selector: str = None, xpath: str = None) -> Dict[str, Any]:
        """Click an element."""
        error = self._check_session()
        if error:
            return error

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath

        try:
            message_id = await self.service.send_command(
                self.session_id,
                "command.click",
                payload
            )
            return {
                "success": True,
                "message_id": message_id
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Command timeout - extension did not respond"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def type(
        self,
        text: str,
        selector: str = None,
        xpath: str = None,
        clear: bool = False
    ) -> Dict[str, Any]:
        """Type text into an element."""
        error = self._check_session()
        if error:
            return error

        payload = {"text": text, "clear": clear}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath

        try:
            message_id = await self.service.send_command(
                self.session_id,
                "command.type",
                payload
            )
            return {
                "success": True,
                "message_id": message_id
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Command timeout - extension did not respond"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def read(
        self,
        selector: str = None,
        xpath: str = None,
        property: str = "text"
    ) -> Dict[str, Any]:
        """Read content from an element."""
        error = self._check_session()
        if error:
            return error

        payload = {"property": property}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath

        try:
            message_id = await self.service.send_command(
                self.session_id,
                "command.read",
                payload
            )
            return {
                "success": True,
                "message_id": message_id
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Command timeout - extension did not respond"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def scroll(
        self,
        direction: str = None,
        amount: int = None,
        selector: str = None,
        to: str = None
    ) -> Dict[str, Any]:
        """Scroll the page."""
        error = self._check_session()
        if error:
            return error

        payload = {}
        if direction:
            payload["direction"] = direction
        if amount:
            payload["amount"] = amount
        if selector:
            payload["selector"] = selector
        if to:
            payload["to"] = to

        try:
            message_id = await self.service.send_command(
                self.session_id,
                "command.scroll",
                payload
            )
            return {
                "success": True,
                "message_id": message_id
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Command timeout - extension did not respond"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def screenshot(self, fullPage: bool = False) -> Dict[str, Any]:
        """Take a screenshot."""
        error = self._check_session()
        if error:
            return error

        try:
            message_id = await self.service.send_command(
                self.session_id,
                "command.screenshot",
                {"fullPage": fullPage}
            )
            return {
                "success": True,
                "message_id": message_id
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Command timeout - extension did not respond"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def get_state(
        self,
        includeDOM: bool = False,
        includeElements: bool = True
    ) -> Dict[str, Any]:
        """Get current browser state."""
        state = self.service.get_session_state(self.session_id)
        if not state:
            return {
                "success": False,
                "error": "Session not found"
            }
        return state

    async def request_human(
        self,
        reason: str,
        message: str,
        timeout: int = None
    ) -> Dict[str, Any]:
        """Request human assistance."""
        self.service.set_control_mode(self.session_id, "HUMAN")

        # Send handoff request to extension
        try:
            await self.service.send_command(
                self.session_id,
                "handoff.request",
                {
                    "reason": reason,
                    "message": message,
                    "timeout": timeout
                }
            )
            return {
                "success": True,
                "message": f"Handoff requested: {message}"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


# ============================================
# FastAPI MCP Server
# ============================================

app = FastAPI(
    title="Co-Browser MCP Server",
    description="MCP tools for browser automation with human-in-the-loop",
    version="0.1.0"
)


class ToolCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = {}
    session_id: str


@app.get("/")
def read_root():
    """Health check."""
    return {"status": "ok", "service": "cobrowser-mcp"}


@app.get("/mcp/tools")
def list_tools():
    """List available MCP tools."""
    return {"tools": get_tool_definitions()}


@app.post("/mcp/call")
async def call_tool(request: ToolCallRequest):
    """
    Call an MCP tool.

    This endpoint is called by Claude Code to execute browser actions.
    """
    # Import here to avoid circular imports
    from src.Library.cobrowser_service import service

    tools = CoBrowserTools(service, request.session_id)

    tool_map = {
        "cobrowser_navigate": tools.navigate,
        "cobrowser_click": tools.click,
        "cobrowser_type": tools.type,
        "cobrowser_read": tools.read,
        "cobrowser_scroll": tools.scroll,
        "cobrowser_screenshot": tools.screenshot,
        "cobrowser_get_state": tools.get_state,
        "cobrowser_request_human": tools.request_human
    }

    if request.name not in tool_map:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {request.name}")

    handler = tool_map[request.name]
    result = await handler(**request.arguments)

    return {"result": result}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8678)
