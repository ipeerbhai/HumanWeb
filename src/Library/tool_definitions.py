"""
Shared tool definitions for Co-Browser MCP servers.

This is the single source of truth for all cobrowser tool definitions.
Both the STDIO server (cobrowser_mcp_server.py) and the HTTP server
(cobrowser_service.py) import from here.
"""

from typing import List, Dict, Any


# ============================================
# Tab targeting injection
# ============================================

_TAB_TARGETING_PROPERTIES = {
    "tab_id": {
        "type": "integer",
        "description": "Target a specific browser tab by ID (from cobrowser_tab_list). Omit to use the active tab."
    },
    "agent_id": {
        "type": "string",
        "description": "Agent identifier for tab claim ownership checks."
    },
}

# Tools that should NOT get tab_id/agent_id injected
NO_TAB_TARGETING = {
    "cobrowser_delay",
    "cobrowser_get_user_requests",
    "cobrowser_clear_user_request",
}


def _with_tab_targeting(schema: dict) -> dict:
    """Add tab_id and agent_id properties to a tool's inputSchema."""
    props = schema.get("properties", {})
    props.update(_TAB_TARGETING_PROPERTIES)
    schema["properties"] = props
    return schema


# ============================================
# Core tool definitions (without tab_id/agent_id)
# ============================================

_BASE_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "cobrowser_navigate",
        "description": "Navigate the browser to a URL. Use this to open web pages. Optional delay (in seconds) waits after page load for JavaScript to hydrate dynamic content.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to navigate to"
                },
                "delay": {
                    "type": "number",
                    "description": "Seconds to wait after page load for JS hydration (e.g. 2). Default: 0"
                }
            },
            "required": ["url"]
        }
    },
    {
        "name": "cobrowser_click",
        "description": "Click an element on the page using a CSS selector, XPath, or coordinates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector for the element to click"
                },
                "xpath": {
                    "type": "string",
                    "description": "XPath expression for the element (e.g., //a[text()='Enter manually'])"
                },
                "index": {
                    "type": "number",
                    "description": "0-based index of which matching element to click (default: 0, first match)"
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
            },
            "required": []
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
            },
            "required": []
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
                    "description": "XPath expression for the input element"
                },
                "index": {
                    "type": "number",
                    "description": "0-based index of which matching element to type into (default: 0, first match)"
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
        "description": "Read text content from an element on the page.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector for the element to read"
                },
                "xpath": {
                    "type": "string",
                    "description": "XPath expression for the element to read"
                },
                "index": {
                    "type": "number",
                    "description": "0-based index of which matching element to read (default: 0, first match)"
                }
            },
            "required": []
        }
    },
    {
        "name": "cobrowser_query_all",
        "description": "Query all elements matching a selector. Returns count and info about each element including attributes, classes, and text. Useful for finding form fields, list items, or understanding page structure.",
        "inputSchema": {
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
    },
    {
        "name": "cobrowser_scroll",
        "description": "Scroll the page up or down.",
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
                }
            },
            "required": ["direction"]
        }
    },
    # ---- Page introspection tools ----
    {
        "name": "cobrowser_page_identity",
        "description": "Get basic page identity: URL, title, description, page type (search_results/article/form/login/product/listing), language, security flags. Cheapest orientation tool — use first after navigation to understand what kind of page you're on. Returns ~50 tokens.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "cobrowser_page_structure",
        "description": "Get page structure overview: headings, landmarks (nav/main/aside/header/footer with sizes), buttons, links, forms, inputs, actionable elements, repeated content patterns (cards/rows/list items), scroll depth. Returns compact overview with CSS selectors for each element. Use after navigation to understand page layout and find what to interact with. Returns 200-800 tokens.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "cobrowser_page_section",
        "description": "Read a specific section of a webpage by CSS selector. Returns scoped text content, interactive elements (buttons, inputs, forms), and links within that region. Optionally extract structured data from repeating child elements using a declarative field map (e.g. {\"title\": \"h3\", \"url\": \"a@href\", \"price\": \".cost\"}). Use after cobrowser_page_structure to zoom into a region of interest.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector targeting a page region (e.g. 'main', '#results', 'nav.sidebar')"
                },
                "max_chars": {
                    "type": "integer",
                    "description": "Maximum characters of text content to return (default 3000)"
                },
                "fields": {
                    "type": "object",
                    "description": "Declarative field map for structured extraction from repeating child elements. Keys are field names, values are CSS selectors (optionally with @attribute suffix). Example: {\"title\": \"h3\", \"url\": \"a@href\", \"price\": \".cost\"}"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max items when using fields extraction (default 25)"
                }
            },
            "required": ["selector"]
        }
    },
    {
        "name": "cobrowser_page_html",
        "description": "Get raw HTML of a page section by CSS selector. Last resort — prefer cobrowser_page_section for structured content. Use only when you need exact markup (e.g. to understand a custom widget or complex layout).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector targeting a page region"
                },
                "max_chars": {
                    "type": "integer",
                    "description": "Maximum characters of HTML to return (default 5000)"
                }
            },
            "required": ["selector"]
        }
    },
    # ---- Legacy / deprecated ----
    {
        "name": "cobrowser_get_page_info",
        "description": "[DEPRECATED — use cobrowser_page_identity + cobrowser_page_structure instead] Get basic page URL and title.",
        "inputSchema": {
            "type": "object",
            "properties": {}
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
    # ---- Human interaction ----
    {
        "name": "cobrowser_request_human",
        "description": "Request human assistance. Use when encountering CAPTCHAs, login pages, or when you need the user to do something.",
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
    # ---- Native OS automation ----
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
            },
            "required": []
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
            },
            "required": []
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
            },
            "required": []
        }
    },
    # ---- Server-side utility ----
    {
        "name": "cobrowser_delay",
        "description": "Wait for a specified amount of time. Use this between actions when you need to wait for animations, page loads, or modal dialogs to appear.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "seconds": {
                    "type": "number",
                    "description": "Time to wait in seconds (e.g., 0.5 for half a second, 2.0 for two seconds). Maximum 30 seconds."
                }
            },
            "required": ["seconds"]
        }
    },
    # ---- Tab management ----
    {
        "name": "cobrowser_tab_list",
        "description": "List all open browser tabs with tab ID, URL, title, and claim status. Use to find available tabs for parallel browsing.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "cobrowser_tab_new",
        "description": "Open a new browser tab, optionally navigating to a URL. Returns the tab ID for targeting future commands.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to open in the new tab (optional, opens blank tab if omitted)"
                }
            },
            "required": []
        }
    },
    {
        "name": "cobrowser_tab_close",
        "description": "Close a browser tab by ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tab_id": {
                    "type": "integer",
                    "description": "The tab ID to close (from cobrowser_tab_list)"
                }
            },
            "required": ["tab_id"]
        }
    },
    {
        "name": "cobrowser_tab_claim",
        "description": "Claim exclusive access to a browser tab. Other agents' commands to this tab will be rejected until released.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tab_id": {
                    "type": "integer",
                    "description": "The tab ID to claim (from cobrowser_tab_list)"
                },
                "agent_id": {
                    "type": "string",
                    "description": "Identifier for this agent (used to match ownership on release)"
                }
            },
            "required": ["tab_id"]
        }
    },
    {
        "name": "cobrowser_tab_release",
        "description": "Release exclusive claim on a browser tab.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tab_id": {
                    "type": "integer",
                    "description": "The tab ID to release"
                }
            },
            "required": ["tab_id"]
        }
    },
]


# ============================================
# Command dispatch mapping
# ============================================

# Maps tool name -> (command_type, payload_builder_fn)
# Used by the HTTP server for dispatching commands.
# The STDIO server has its own dispatch logic in call_tool().
TOOL_TO_COMMAND: Dict[str, tuple] = {
    "cobrowser_navigate": ("command.navigate", lambda a: {k: v for k, v in a.items() if v is not None and k != "delay"}),
    "cobrowser_click": ("command.click", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_doubleclick": ("command.doubleclick", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_rightclick": ("command.rightclick", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_drag": ("command.drag", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_type": ("command.type", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_read": ("command.read", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_scroll": ("command.scroll", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_get_page_info": ("command.getState", lambda a: {k: v for k, v in a.items() if k in ("tab_id", "agent_id") and v is not None}),
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
    # Page introspection — server-side formatting, but dispatched as commands
    "cobrowser_page_identity": ("command.getIdentity", lambda a: {}),
    "cobrowser_page_structure": ("command.getStructure", lambda a: {}),
    "cobrowser_page_section": ("command.getSection", lambda a: {
        "selector": a.get("selector"),
        **({"maxChars": a["max_chars"]} if "max_chars" in a else {}),
        **({"fields": a["fields"]} if "fields" in a else {}),
        **({"limit": a["limit"]} if "limit" in a else {}),
    }),
    "cobrowser_page_html": ("command.read", lambda a: {
        "selector": a.get("selector"),
        "property": "html",
    }),
    # Tab management — routed to extension via WebSocket
    "cobrowser_tab_list": ("tab.list", lambda a: {}),
    "cobrowser_tab_new": ("tab.new", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_tab_close": ("tab.close", lambda a: {"tab_id": a.get("tab_id")}),
    "cobrowser_tab_claim": ("tab.claim", lambda a: {k: v for k, v in a.items() if v is not None}),
    "cobrowser_tab_release": ("tab.release", lambda a: {"tab_id": a.get("tab_id")}),
}


# ============================================
# Public API
# ============================================

def get_all_tool_definitions() -> List[Dict[str, Any]]:
    """Return all tool definitions with tab_id/agent_id injected on browsing tools.

    This is the single source of truth used by both the HTTP and STDIO MCP servers.
    Returns deep copies so callers can safely mutate.
    """
    import copy
    tools = copy.deepcopy(_BASE_TOOLS)

    # Add tab_id and agent_id to all browsing tools for multi-tab parallel support
    for tool in tools:
        if tool["name"] not in NO_TAB_TARGETING:
            _with_tab_targeting(tool["inputSchema"])

    return tools
