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


async def send_command(
    command_type: str,
    payload: dict,
    wait_for_result: bool = True,
    tab_id: int | None = None,
    agent_id: str | None = None,
) -> dict:
    """Send a command to the cobrowser service.

    tab_id: if provided, routes the command to that specific browser tab.
            The extension's claim semantics apply — if the tab is claimed by a
            different agent, the command will be rejected by the background script.
    agent_id: identifier for this agent, used for claim ownership checks.
    """
    session_id = await get_active_session()
    if not session_id:
        return {"success": False, "error": "No active browser session. Make sure the extension is connected."}

    # Include tab_id and agent_id in the payload so the extension can route correctly
    if tab_id is not None:
        payload = dict(payload)
        payload["tab_id"] = tab_id
    if agent_id is not None:
        payload = dict(payload)
        payload["agent_id"] = agent_id

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
    """List available browser automation tools.

    Tool definitions are maintained in the shared tool_definitions module.
    """
    from .tool_definitions import get_all_tool_definitions

    return [
        Tool(name=t["name"], description=t["description"], inputSchema=t["inputSchema"])
        for t in get_all_tool_definitions()
    ]


def _format_action_error(data: dict) -> str:
    """Format a structured action error (from the browser extension) as readable text.

    If the error includes fuzzy suggestions, formats them as a numbered list.
    """
    error = data.get("error", "Unknown error")
    suggestions = data.get("suggestions", [])
    hint = data.get("hint", "")

    lines = [f"Error: {error}"]

    if suggestions:
        lines.append("")
        lines.append("Similar elements found:")
        for i, s in enumerate(suggestions, 1):
            label = s.get("text", "").strip()
            sel = s.get("selector", "")
            line = f"  [{i}] {sel}"
            if label:
                line += f' — "{label}"'
            lines.append(line)
        lines.append("")
        lines.append("Try one of these selectors instead.")
    elif hint:
        lines.append("")
        lines.append(hint)

    return "\n".join(lines)


def format_result(result: dict, success_msg: str) -> list[TextContent]:
    """Format a command result into a text response.

    Handles two levels of success:
    - Outer: did the service successfully deliver the command? (result["success"])
    - Inner: did the browser action itself succeed? (result["result"]["success"])

    When the action fails with suggestions, formats them as readable text.
    """
    if result.get("success"):
        data = result.get("result", {})

        # Check if the action itself failed (inner failure from the extension)
        if isinstance(data, dict) and not data.get("success", True):
            return [TextContent(type="text", text=_format_action_error(data))]

        # Action succeeded — include result data if it has meaningful content beyond {success: true}
        if data and set(data.keys()) - {"success", "message_type"}:
            return [TextContent(type="text", text=f"{success_msg}\n\nResult: {json.dumps(data, indent=2)}")]
        return [TextContent(type="text", text=success_msg)]
    else:
        # Service-level failure (no connection, timeout, etc.)
        return [TextContent(type="text", text=f"Error: {result.get('error', 'Unknown error')}")]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Execute a browser automation tool."""

    # Extract optional tab routing params common to all action tools
    _tab_id: int | None = arguments.get("tab_id")
    _agent_id: str | None = arguments.get("agent_id")

    if name == "cobrowser_navigate":
        url = arguments.get("url")
        if not url:
            return [TextContent(type="text", text="Error: URL is required")]

        delay = arguments.get("delay", 0)
        result = await send_command("command.navigate", {"url": url}, tab_id=_tab_id, agent_id=_agent_id)
        if delay and delay > 0:
            delay = min(float(delay), 30.0)
            await asyncio.sleep(delay)
        return format_result(result, f"Navigated to {url}")

    elif name == "cobrowser_click":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        index = arguments.get("index")
        x = arguments.get("x")
        y = arguments.get("y")

        if not selector and not xpath and (x is None or y is None):
            return [TextContent(type="text", text="Error: selector, xpath, or x,y coordinates are required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if index is not None:
            payload["index"] = index
        if x is not None and y is not None:
            payload["x"] = x
            payload["y"] = y

        result = await send_command("command.click", payload, tab_id=_tab_id, agent_id=_agent_id)
        target = selector or xpath or f"({x}, {y})"
        if index is not None:
            target += f"[{index}]"
        return format_result(result, f"Clicked element: {target}")

    elif name == "cobrowser_doubleclick":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        x = arguments.get("x")
        y = arguments.get("y")

        if not selector and not xpath and (x is None or y is None):
            return [TextContent(type="text", text="Error: selector, xpath, or x,y coordinates are required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if x is not None and y is not None:
            payload["x"] = x
            payload["y"] = y

        result = await send_command("command.doubleclick", payload, tab_id=_tab_id, agent_id=_agent_id)
        target = selector or xpath or f"({x}, {y})"
        return format_result(result, f"Double-clicked element: {target}")

    elif name == "cobrowser_rightclick":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        x = arguments.get("x")
        y = arguments.get("y")

        if not selector and not xpath and (x is None or y is None):
            return [TextContent(type="text", text="Error: selector, xpath, or x,y coordinates are required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if x is not None and y is not None:
            payload["x"] = x
            payload["y"] = y

        result = await send_command("command.rightclick", payload, tab_id=_tab_id, agent_id=_agent_id)
        target = selector or xpath or f"({x}, {y})"
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

        result = await send_command("command.drag", payload, tab_id=_tab_id, agent_id=_agent_id)
        target_desc = arguments.get("targetSelector") or f"({arguments.get('targetX')}, {arguments.get('targetY')})"
        return format_result(result, f"Dragged {selector} to {target_desc}")

    elif name == "cobrowser_type":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        index = arguments.get("index")
        text = arguments.get("text")
        clear = arguments.get("clear", False)

        if not selector and not xpath:
            return [TextContent(type="text", text="Error: selector or xpath is required")]
        if not text:
            return [TextContent(type="text", text="Error: text is required")]

        payload = {"text": text, "clear": clear}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if index is not None:
            payload["index"] = index

        result = await send_command("command.type", payload, tab_id=_tab_id, agent_id=_agent_id)
        target = selector or xpath
        if index is not None:
            target += f"[{index}]"
        return format_result(result, f"Typed '{text}' into {target}")

    elif name == "cobrowser_read":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        index = arguments.get("index")
        if not selector and not xpath:
            return [TextContent(type="text", text="Error: selector or xpath is required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if index is not None:
            payload["index"] = index

        result = await send_command("command.read", payload, tab_id=_tab_id, agent_id=_agent_id)
        target = selector or xpath
        if index is not None:
            target += f"[{index}]"
        if result.get("success") and result.get("result", {}).get("text"):
            text = result["result"]["text"]
            return [TextContent(type="text", text=f"Text content from {target}:\n\n{text}")]
        return format_result(result, f"Read from {target}")

    elif name == "cobrowser_query_all":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        if not selector and not xpath:
            return [TextContent(type="text", text="Error: selector or xpath is required")]

        limit = min(arguments.get("limit", 20), 50)

        payload = {"limit": limit}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath

        result = await send_command("command.queryAll", payload, tab_id=_tab_id, agent_id=_agent_id)

        if result.get("success"):
            data = result.get("result", result)  # Result may be nested under "result"
            count = data.get("count", 0)
            total = data.get("total", count)
            elements = data.get("elements", [])

            query_desc = selector or xpath or '?'
            lines = [f"Found {len(elements)} elements (of {total} total matching '{query_desc}'):\n"]
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

                if el.get('xpath'):
                    el_info += f"\n    xpath: {el['xpath']}"
                elif el.get('selector'):
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
        }, tab_id=_tab_id, agent_id=_agent_id)
        return format_result(result, f"Scrolled {direction} by {amount}px")

    elif name == "cobrowser_page_identity":
        result = await send_command("command.getIdentity", {})
        if result.get("success") and result.get("result"):
            info = result["result"]
            lines = []
            lines.append(f"Page: {info.get('title', 'unknown')}")
            lines.append(f"URL: {info.get('url', 'unknown')}")
            if info.get('meta_description'):
                lines.append(f"Description: {info['meta_description']}")
            lines.append(f"Type: {info.get('page_type', 'unknown')}")
            if info.get('lang'):
                lines.append(f"Language: {info['lang']}")
            security = info.get('security', {})
            flags = []
            if security.get('isLoginPage'):
                flags.append('login page')
            if security.get('hasCaptcha'):
                flags.append(f"captcha ({security.get('captchaType', 'unknown')})")
            if security.get('hasCloudflareChallenge'):
                flags.append('cloudflare challenge')
            if security.get('hasPasswordFields'):
                flags.append('has password fields')
            if info.get('is_sensitive'):
                flags.append('sensitive URL (banking/payment)')
            if flags:
                lines.append(f"Security: {', '.join(flags)}")
            return [TextContent(type="text", text="\n".join(lines))]
        return format_result(result, "Got page identity")

    elif name == "cobrowser_page_structure":
        result = await send_command("command.getStructure", {})
        if result.get("success") and result.get("result"):
            info = result["result"]
            lines = []

            # Landmarks
            landmarks = info.get('landmarks', [])
            if landmarks:
                lines.append("Landmarks:")
                for lm in landmarks:
                    label = lm.get('label', lm.get('tag', '?'))
                    chars = lm.get('chars', 0)
                    size = f"{chars:,}" if chars < 10000 else f"{chars // 1000}K"
                    lines.append(f"  [{lm.get('tag', '?')}] {label} ({size} chars, {lm.get('children', 0)} children) → {lm.get('selector', '?')}")

            # Headings
            headings = info.get('headings', [])
            if headings:
                lines.append("\nHeadings:")
                for h in headings:
                    indent = "  " + "  " * (h.get('level', 1) - 1)
                    lines.append(f"{indent}h{h.get('level', '?')}: {h.get('text', '')} → {h.get('selector', '?')}")

            # Top actions
            actions = info.get('actions', [])
            if actions:
                lines.append("\nActions:")
                for a in actions:
                    lines.append(f"  [{a.get('type', '?')}] \"{a.get('text', '')}\" → {a.get('selector', '?')}")

            # Counts
            counts = info.get('counts', {})
            if counts:
                parts = [f"{v} {k}" for k, v in counts.items() if v > 0]
                lines.append(f"\nElement counts: {', '.join(parts)}")

            # Scroll depth
            scroll = info.get('scroll_pages', 1)
            if scroll > 1:
                lines.append(f"Scroll depth: {scroll} pages")

            # Repeated regions
            regions = info.get('repeated_regions', [])
            if regions:
                lines.append("\nRepeated patterns:")
                for r in regions:
                    lines.append(f"  {r.get('count', '?')}x {r.get('item_selector', r.get('selector', '?'))} — \"{r.get('sample_text', '')}\"")
                    lines.append(f"    selector: {r.get('selector', '?')}")

            return [TextContent(type="text", text="\n".join(lines))]
        return format_result(result, "Got page structure")

    elif name == "cobrowser_page_section":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        if not selector and not xpath:
            return [TextContent(type="text", text="Error: selector or xpath is required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if "max_chars" in arguments:
            payload["maxChars"] = arguments["max_chars"]
        if "fields" in arguments:
            payload["fields"] = arguments["fields"]
        if "limit" in arguments:
            payload["limit"] = arguments["limit"]

        result = await send_command("command.getSection", payload)
        if result.get("success") and result.get("result"):
            info = result["result"]

            if not info.get("success", True):
                return [TextContent(type="text", text=f"Error: {info.get('error', 'Unknown error')}")]

            lines = [f"Section: {selector} ({info.get('tag', '?')}, {info.get('chars', 0):,} chars)"]

            # Declarative extraction mode
            if "items" in info:
                lines.append(f"\nExtracted {info.get('item_count', 0)} items:")
                for i, item in enumerate(info["items"]):
                    parts = [f"{k}: {v}" for k, v in item.items() if v is not None]
                    lines.append(f"  [{i}] {' | '.join(parts)}")
                return [TextContent(type="text", text="\n".join(lines))]

            # Standard section mode
            if info.get("text"):
                text = info["text"]
                if info.get("text_truncated"):
                    text += "\n... (truncated)"
                lines.append(f"\nText:\n{text}")

            inputs = info.get("inputs", [])
            if inputs:
                lines.append(f"\nInputs ({len(inputs)}):")
                for inp in inputs:
                    label = inp.get("text", "") or inp.get("type", "")
                    ref = inp.get('xpath') or inp.get('selector', '?')
                    lines.append(f"  [{inp.get('type', '?')}] {label} → {ref}")

            buttons = info.get("buttons", [])
            if buttons:
                lines.append(f"\nButtons ({len(buttons)}):")
                for btn in buttons:
                    ref = btn.get('xpath') or btn.get('selector', '?')
                    lines.append(f"  \"{btn.get('text', '')}\" → {ref}")

            links = info.get("links", [])
            if links:
                lines.append(f"\nLinks ({len(links)}):")
                for lnk in links:
                    ref = lnk.get('xpath') or lnk.get('selector', '?')
                    lines.append(f"  \"{lnk.get('text', '')}\" → {ref}")

            return [TextContent(type="text", text="\n".join(lines))]
        return format_result(result, f"Got section: {selector}")

    elif name == "cobrowser_page_html":
        selector = arguments.get("selector")
        if not selector:
            return [TextContent(type="text", text="Error: selector is required")]

        max_chars = arguments.get("max_chars", 5000)
        result = await send_command("command.getSection", {"selector": selector, "maxChars": max_chars})
        if result.get("success") and result.get("result"):
            info = result["result"]
            if not info.get("success", True):
                return [TextContent(type="text", text=f"Error: {info.get('error', 'Unknown error')}")]
            # For HTML mode, re-fetch using getState with a targeted approach
            # Since we don't have a dedicated HTML extraction command yet,
            # use the cleaned DOM approach scoped to the selector
        # Fall back to reading via the section's text for now
        # TODO: Add a dedicated command.getHTML that returns outerHTML
        result = await send_command("command.read", {"selector": selector, "property": "html"})
        if result.get("success") and result.get("result"):
            data = result["result"]
            html = data.get("value", "")
            if len(html) > max_chars:
                html = html[:max_chars] + "\n<!-- truncated -->"
            return [TextContent(type="text", text=f"HTML for {selector}:\n\n{html}")]
        return format_result(result, f"Got HTML: {selector}")

    elif name == "cobrowser_get_page_info":
        # Deprecated — backwards compatibility
        result = await send_command("command.getState", {}, tab_id=_tab_id, agent_id=_agent_id)
        if result.get("success") and result.get("result"):
            info = result["result"]
            metadata = info.get("metadata", {})
            url = metadata.get("url", "unknown")
            title = metadata.get("title", "unknown")
            return [TextContent(type="text", text=f"Page Info:\n- URL: {url}\n- Title: {title}")]
        return format_result(result, "Got page info")

    elif name == "cobrowser_screenshot":
        result = await send_command("command.screenshot", {}, tab_id=_tab_id, agent_id=_agent_id)
        return format_result(result, "Took screenshot")

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

    elif name == "cobrowser_native_click":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        index = arguments.get("index")

        if not selector and not xpath:
            return [TextContent(type="text", text="Error: selector or xpath is required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if index is not None:
            payload["index"] = index

        result = await send_command("command.nativeClick", payload)
        target = selector or xpath
        if index is not None:
            target += f"[{index}]"
        return format_result(result, f"Native click on: {target}")

    elif name == "cobrowser_native_move":
        selector = arguments.get("selector")
        xpath = arguments.get("xpath")
        index = arguments.get("index")

        if not selector and not xpath:
            return [TextContent(type="text", text="Error: selector or xpath is required")]

        payload = {}
        if selector:
            payload["selector"] = selector
        if xpath:
            payload["xpath"] = xpath
        if index is not None:
            payload["index"] = index

        result = await send_command("command.nativeMove", payload)
        target = selector or xpath
        if index is not None:
            target += f"[{index}]"
        return format_result(result, f"Moved mouse to: {target}")

    elif name == "cobrowser_native_type":
        text = arguments.get("text")
        if not text:
            return [TextContent(type="text", text="Error: text is required")]

        result = await send_command("command.nativeType", {"text": text})
        preview = text[:30] + "..." if len(text) > 30 else text
        return format_result(result, f"Typed (native): {preview}")

    elif name == "cobrowser_native_hotkey":
        keys = arguments.get("keys")
        if not keys:
            return [TextContent(type="text", text="Error: keys array is required")]

        result = await send_command("command.nativeHotkey", {"keys": keys})
        return format_result(result, f"Pressed hotkey: {'+'.join(keys)}")

    elif name == "cobrowser_native_scroll":
        clicks = arguments.get("clicks", -3)
        result = await send_command("command.nativeScroll", {"clicks": clicks})
        direction = "up" if clicks > 0 else "down"
        return format_result(result, f"Scrolled {direction} by {abs(clicks)} clicks")

    elif name == "cobrowser_tab_list":
        result = await send_command("tab.list", {})
        if result.get("success"):
            inner = result.get("result", {})
            if not inner.get("success", True):
                return [TextContent(type="text", text=f"Error: {inner.get('error', 'Unknown error')}")]
            tabs = inner.get("tabs", [])
            if not tabs:
                return [TextContent(type="text", text="No open tabs.")]
            lines = [f"Open tabs ({len(tabs)}):"]
            for tab in tabs:
                claimed = f" [claimed by {tab['claimed_by']}]" if tab.get("claimed_by") else ""
                active = " [active]" if tab.get("active") else ""
                lines.append(f"  tab_id={tab['tab_id']}{active}{claimed} — {tab.get('title', 'untitled')}")
                lines.append(f"    {tab.get('url', '')}")
            return [TextContent(type="text", text="\n".join(lines))]
        return format_result(result, "Listed tabs")

    elif name == "cobrowser_tab_new":
        url = arguments.get("url")
        payload = {}
        if url:
            payload["url"] = url
        result = await send_command("tab.new", payload)
        if result.get("success"):
            inner = result.get("result", {})
            if not inner.get("success", True):
                return [TextContent(type="text", text=f"Error: {inner.get('error', 'Unknown error')}")]
            tab_id = inner.get("tab_id")
            tab_url = inner.get("url", url or "about:blank")
            return [TextContent(type="text", text=f"Opened new tab: tab_id={tab_id}, url={tab_url}")]
        return format_result(result, "Opened new tab")

    elif name == "cobrowser_tab_close":
        tab_id = arguments.get("tab_id")
        if tab_id is None:
            return [TextContent(type="text", text="Error: tab_id is required")]
        result = await send_command("tab.close", {"tab_id": tab_id})
        if result.get("success"):
            inner = result.get("result", {})
            if not inner.get("success", True):
                return [TextContent(type="text", text=f"Error: {inner.get('error', 'Unknown error')}")]
            return [TextContent(type="text", text=f"Closed tab {tab_id}")]
        return format_result(result, f"Closed tab {tab_id}")

    elif name == "cobrowser_tab_claim":
        tab_id = arguments.get("tab_id")
        agent_id = arguments.get("agent_id")
        if tab_id is None:
            return [TextContent(type="text", text="Error: tab_id is required")]
        payload = {"tab_id": tab_id}
        if agent_id:
            payload["agent_id"] = agent_id
        result = await send_command("tab.claim", payload)
        if result.get("success"):
            inner = result.get("result", {})
            if not inner.get("success", True):
                return [TextContent(type="text", text=f"Error: {inner.get('error', 'Unknown error')}")]
            return [TextContent(type="text", text=f"Claimed tab {tab_id} for agent '{agent_id or 'unknown'}'")]
        return format_result(result, f"Claimed tab {tab_id}")

    elif name == "cobrowser_tab_release":
        tab_id = arguments.get("tab_id")
        if tab_id is None:
            return [TextContent(type="text", text="Error: tab_id is required")]
        result = await send_command("tab.release", {"tab_id": tab_id})
        if result.get("success"):
            inner = result.get("result", {})
            if not inner.get("success", True):
                return [TextContent(type="text", text=f"Error: {inner.get('error', 'Unknown error')}")]
            return [TextContent(type="text", text=f"Released claim on tab {tab_id}")]
        return format_result(result, f"Released tab {tab_id}")

    elif name == "cobrowser_delay":
        seconds = arguments.get("seconds", 0)
        if not isinstance(seconds, (int, float)):
            return [TextContent(type="text", text="Error: seconds must be a number")]
        seconds = min(max(0, float(seconds)), 30.0)
        await asyncio.sleep(seconds)
        return [TextContent(type="text", text=f"Waited {seconds} seconds")]

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
