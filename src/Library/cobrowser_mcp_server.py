#!/usr/bin/env python3
"""
Co-Browser MCP Server

A Model Context Protocol server that exposes browser automation tools
for Claude Code to control Firefox through the Co-Browser extension.

Usage:
    python -m src.Library.cobrowser_mcp_server

Configure in Claude Code's MCP settings to use this server.
"""

import asyncio
import json
import httpx
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
)

# Configuration
COBROWSER_SERVICE_URL = "http://localhost:8677"

# Create MCP server
server = Server("cobrowser")


async def get_active_session() -> str | None:
    """Get the first active session from the cobrowser service."""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{COBROWSER_SERVICE_URL}/v1/cobrowser/sessions/active"
            )
            data = response.json()
            if data.get("sessions"):
                return data["sessions"][0]
        except Exception as e:
            print(f"Error getting session: {e}")
    return None


async def send_command(command_type: str, payload: dict, wait_for_result: bool = True) -> dict:
    """Send a command to the cobrowser service."""
    session_id = await get_active_session()
    if not session_id:
        return {"success": False, "error": "No active browser session. Make sure the extension is connected."}

    async with httpx.AsyncClient() as client:
        try:
            # Use sync endpoint to wait for actual result from browser
            endpoint = "sync" if wait_for_result else ""
            url = f"{COBROWSER_SERVICE_URL}/v1/cobrowser/command/{session_id}"
            if endpoint:
                url += f"/{endpoint}"

            response = await client.post(
                url,
                json={"type": command_type, "payload": payload, "timeout": 30.0},
                timeout=35.0  # Slightly longer than command timeout
            )
            data = response.json()

            if wait_for_result:
                # Sync endpoint returns result directly
                return data
            else:
                return {"success": True, "response": data}
        except httpx.TimeoutException:
            return {"success": False, "error": "Command timed out"}
        except Exception as e:
            return {"success": False, "error": str(e)}


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available browser automation tools."""
    return [
        Tool(
            name="cobrowser_navigate",
            description="Navigate the browser to a URL. Use this to open web pages.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to navigate to"
                    }
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="cobrowser_click",
            description="Click an element on the page using a CSS selector or coordinates.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to click"
                    },
                    "x": {
                        "type": "number",
                        "description": "X coordinate (viewport) - use with y for canvas elements"
                    },
                    "y": {
                        "type": "number",
                        "description": "Y coordinate (viewport) - use with x for canvas elements"
                    }
                },
                "required": []
            }
        ),
        Tool(
            name="cobrowser_doubleclick",
            description="Double-click an element on the page. Use for opening dialogs, search boxes in canvas UIs like ComfyUI. For canvas elements, use x,y coordinates.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to double-click"
                    },
                    "x": {
                        "type": "number",
                        "description": "X coordinate (viewport) - use with y for canvas elements"
                    },
                    "y": {
                        "type": "number",
                        "description": "Y coordinate (viewport) - use with x for canvas elements"
                    }
                },
                "required": []
            }
        ),
        Tool(
            name="cobrowser_rightclick",
            description="Right-click an element to open a context menu. For canvas elements, use x,y coordinates.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to right-click"
                    },
                    "x": {
                        "type": "number",
                        "description": "X coordinate (viewport) - use with y for canvas elements"
                    },
                    "y": {
                        "type": "number",
                        "description": "Y coordinate (viewport) - use with x for canvas elements"
                    }
                },
                "required": []
            }
        ),
        Tool(
            name="cobrowser_drag",
            description="Drag an element from one location to another. Use for connecting nodes in canvas UIs, moving elements, or drag-and-drop operations.",
            inputSchema={
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
        ),
        Tool(
            name="cobrowser_type",
            description="Type text into an input field. Cannot type into password fields for security.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the input element"
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
                "required": ["selector", "text"]
            }
        ),
        Tool(
            name="cobrowser_read",
            description="Read text content from an element on the page.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to read"
                    }
                },
                "required": ["selector"]
            }
        ),
        Tool(
            name="cobrowser_query_all",
            description="Query all elements matching a selector. Returns count and info about each element including attributes, classes, and text. Useful for finding form fields, list items, or understanding page structure.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to match elements"
                    },
                    "limit": {
                        "type": "number",
                        "description": "Maximum number of elements to return (default: 20, max: 50)"
                    }
                },
                "required": ["selector"]
            }
        ),
        Tool(
            name="cobrowser_scroll",
            description="Scroll the page up or down.",
            inputSchema={
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
                    }
                },
                "required": ["direction"]
            }
        ),
        Tool(
            name="cobrowser_get_page_info",
            description="Get information about the current page including URL and title.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="cobrowser_request_human",
            description="Request human assistance. Use when encountering CAPTCHAs, login pages, or when you need the user to do something.",
            inputSchema={
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
        ),
        Tool(
            name="cobrowser_get_user_requests",
            description="Get pending user requests from the browser. Users can right-click and 'Ask Claude...' to send natural language requests. Check this periodically to see if users need help.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="cobrowser_clear_user_request",
            description="Clear a user request after you've handled it.",
            inputSchema={
                "type": "object",
                "properties": {
                    "request_id": {
                        "type": "string",
                        "description": "The ID of the request to clear"
                    }
                },
                "required": ["request_id"]
            }
        )
    ]


def format_result(result: dict, success_msg: str) -> list[TextContent]:
    """Format a command result into a text response."""
    if result.get("success"):
        # Include actual result data if present
        data = result.get("result", {})
        if data:
            import json
            return [TextContent(type="text", text=f"{success_msg}\n\nResult: {json.dumps(data, indent=2)}")]
        return [TextContent(type="text", text=success_msg)]
    else:
        return [TextContent(type="text", text=f"Error: {result.get('error', 'Unknown error')}")]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Execute a browser automation tool."""

    if name == "cobrowser_navigate":
        url = arguments.get("url")
        if not url:
            return [TextContent(type="text", text="Error: URL is required")]

        result = await send_command("command.navigate", {"url": url})
        return format_result(result, f"Navigated to {url}")

    elif name == "cobrowser_click":
        selector = arguments.get("selector")
        x = arguments.get("x")
        y = arguments.get("y")

        if not selector and (x is None or y is None):
            return [TextContent(type="text", text="Error: selector or x,y coordinates are required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if x is not None and y is not None:
            payload["x"] = x
            payload["y"] = y

        result = await send_command("command.click", payload)
        target = selector if selector else f"({x}, {y})"
        return format_result(result, f"Clicked element: {target}")

    elif name == "cobrowser_doubleclick":
        selector = arguments.get("selector")
        x = arguments.get("x")
        y = arguments.get("y")

        if not selector and (x is None or y is None):
            return [TextContent(type="text", text="Error: selector or x,y coordinates are required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if x is not None and y is not None:
            payload["x"] = x
            payload["y"] = y

        result = await send_command("command.doubleclick", payload)
        target = selector if selector else f"({x}, {y})"
        return format_result(result, f"Double-clicked element: {target}")

    elif name == "cobrowser_rightclick":
        selector = arguments.get("selector")
        x = arguments.get("x")
        y = arguments.get("y")

        if not selector and (x is None or y is None):
            return [TextContent(type="text", text="Error: selector or x,y coordinates are required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if x is not None and y is not None:
            payload["x"] = x
            payload["y"] = y

        result = await send_command("command.rightclick", payload)
        target = selector if selector else f"({x}, {y})"
        return format_result(result, f"Right-clicked element: {target}")

    elif name == "cobrowser_drag":
        selector = arguments.get("selector")
        if not selector:
            return [TextContent(type="text", text="Error: selector is required")]

        payload = {"selector": selector}
        if arguments.get("targetSelector"):
            payload["targetSelector"] = arguments["targetSelector"]
        if arguments.get("targetX") is not None:
            payload["targetX"] = arguments["targetX"]
        if arguments.get("targetY") is not None:
            payload["targetY"] = arguments["targetY"]

        result = await send_command("command.drag", payload)
        target_desc = arguments.get("targetSelector") or f"({arguments.get('targetX')}, {arguments.get('targetY')})"
        return format_result(result, f"Dragged {selector} to {target_desc}")

    elif name == "cobrowser_type":
        selector = arguments.get("selector")
        text = arguments.get("text")
        clear = arguments.get("clear", False)

        if not selector or not text:
            return [TextContent(type="text", text="Error: selector and text are required")]

        result = await send_command("command.type", {
            "selector": selector,
            "text": text,
            "clear": clear
        })
        return format_result(result, f"Typed '{text}' into {selector}")

    elif name == "cobrowser_read":
        selector = arguments.get("selector")
        if not selector:
            return [TextContent(type="text", text="Error: selector is required")]

        result = await send_command("command.read", {"selector": selector})
        if result.get("success") and result.get("result", {}).get("text"):
            text = result["result"]["text"]
            return [TextContent(type="text", text=f"Text content from {selector}:\n\n{text}")]
        return format_result(result, f"Read from {selector}")

    elif name == "cobrowser_query_all":
        selector = arguments.get("selector")
        if not selector:
            return [TextContent(type="text", text="Error: selector is required")]

        limit = min(arguments.get("limit", 20), 50)

        result = await send_command("command.queryAll", {
            "selector": selector,
            "limit": limit
        })

        if result.get("success"):
            data = result.get("result", result)  # Result may be nested under "result"
            count = data.get("count", 0)
            total = data.get("total", count)
            elements = data.get("elements", [])

            lines = [f"Found {len(elements)} elements (of {total} total matching '{selector}'):\n"]
            for el in elements:
                el_info = f"[{el.get('index')}] <{el.get('tagName')}"
                if el.get('id'):
                    el_info += f" id=\"{el['id']}\""
                if el.get('class'):
                    classes = el['class'][:50]
                    el_info += f" class=\"{classes}{'...' if len(el['class']) > 50 else ''}\""
                if el.get('name'):
                    el_info += f" name=\"{el['name']}\""
                if el.get('type'):
                    el_info += f" type=\"{el['type']}\""
                el_info += ">"

                text = el.get('text', '')
                if text:
                    el_info += f" \"{text[:40]}{'...' if len(text) > 40 else ''}\""

                if el.get('selector'):
                    el_info += f"\n    → {el['selector']}"

                lines.append(el_info)

            return [TextContent(type="text", text="\n".join(lines))]

        return format_result(result, f"Query all: {selector}")

    elif name == "cobrowser_scroll":
        direction = arguments.get("direction", "down")
        amount = arguments.get("amount", 300)

        result = await send_command("command.scroll", {
            "direction": direction,
            "amount": amount
        })
        return format_result(result, f"Scrolled {direction} by {amount}px")

    elif name == "cobrowser_get_page_info":
        result = await send_command("command.getState", {})
        if result.get("success") and result.get("result"):
            info = result["result"]
            metadata = info.get("metadata", {})
            url = metadata.get("url", "unknown")
            title = metadata.get("title", "unknown")
            return [TextContent(type="text", text=f"Page Info:\n- URL: {url}\n- Title: {title}")]
        return format_result(result, "Got page info")

    elif name == "cobrowser_request_human":
        reason = arguments.get("reason", "other")
        message = arguments.get("message", "Human assistance needed")

        result = await send_command("handoff.request", {
            "reason": reason,
            "message": message
        }, wait_for_result=False)  # Handoff is fire-and-forget
        if result.get("success"):
            return [TextContent(type="text", text=f"Human assistance requested: {message}")]
        return format_result(result, f"Requested human help: {message}")

    elif name == "cobrowser_get_user_requests":
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(f"{COBROWSER_SERVICE_URL}/v1/cobrowser/user-requests")
                data = response.json()
                requests = data.get("requests", [])
                if not requests:
                    return [TextContent(type="text", text="No pending user requests.")]

                output = "Pending user requests:\n"
                for req in requests:
                    output += f"\n- ID: {req.get('id')}\n"
                    output += f"  Text: {req.get('text')}\n"
                    ctx = req.get('context', {})
                    if ctx.get('url'):
                        output += f"  Page: {ctx.get('url')}\n"
                    if ctx.get('selection'):
                        output += f"  Selected: {ctx.get('selection')[:100]}...\n"
                return [TextContent(type="text", text=output)]
            except Exception as e:
                return [TextContent(type="text", text=f"Error getting user requests: {e}")]

    elif name == "cobrowser_clear_user_request":
        request_id = arguments.get("request_id")
        if not request_id:
            return [TextContent(type="text", text="Error: request_id is required")]

        async with httpx.AsyncClient() as client:
            try:
                response = await client.delete(f"{COBROWSER_SERVICE_URL}/v1/cobrowser/user-requests/{request_id}")
                return [TextContent(type="text", text=f"Cleared request {request_id}")]
            except Exception as e:
                return [TextContent(type="text", text=f"Error clearing request: {e}")]

    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
