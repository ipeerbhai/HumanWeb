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
            description="Click an element on the page using a CSS selector.",
            inputSchema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to click"
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
        if not selector:
            return [TextContent(type="text", text="Error: selector is required")]

        result = await send_command("command.click", {"selector": selector})
        return format_result(result, f"Clicked element: {selector}")

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
