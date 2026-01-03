# CoBrowser MCP HTTP API

This document describes how to integrate with CoBrowser using the MCP (Model Context Protocol) HTTP transport.

## Quick Start

```bash
# 1. Initialize a session
curl -s -X POST http://localhost:8678/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"MyApp","version":"1.0"}}}' \
  -D -

# Note the Mcp-Session-Id header in the response

# 2. List available tools
curl -s -X POST http://localhost:8678/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: YOUR_SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3. Call a tool
curl -s -X POST http://localhost:8678/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: YOUR_SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cobrowser_navigate","arguments":{"url":"https://example.com"}}}'
```

## Architecture

```
┌─────────────┐     JSON-RPC/HTTP      ┌────────────────┐       HTTP        ┌──────────────────┐
│  Your App   │ ────────────────────► │  MCP Server    │ ──────────────► │ CoBrowser Service │
│             │      :8678/mcp         │  (mcp_tools)   │     :8677        │   (WebSocket)     │
└─────────────┘                        └────────────────┘                   └────────┬─────────┘
                                                                                     │ WS
                                                                             ┌───────▼────────┐
                                                                             │ Browser Ext.   │
                                                                             │  (Firefox)     │
                                                                             └────────────────┘
```

| Service | Port | Purpose |
|---------|------|---------|
| MCP HTTP Server | 8678 | JSON-RPC API for tool discovery and execution |
| CoBrowser Service | 8677 | WebSocket backend connecting to browser extension |

## Protocol Overview

CoBrowser implements the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification):

- **Endpoint**: `POST /mcp`
- **Format**: JSON-RPC 2.0
- **Session**: Managed via `Mcp-Session-Id` header
- **Protocol Versions**: `2025-06-18`, `2025-03-26`, `2024-11-05`

## API Reference

### Initialize Session

Start a new MCP session. This must be called first.

**Request:**
```http
POST /mcp HTTP/1.1
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "YourAppName",
      "version": "1.0.0"
    }
  }
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
Mcp-Session-Id: abc123xyz...

{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "cobrowser-mcp",
      "version": "0.2.0"
    }
  }
}
```

**Important:** Save the `Mcp-Session-Id` header value for subsequent requests.

### List Tools

Discover all available browser automation tools.

**Request:**
```http
POST /mcp HTTP/1.1
Content-Type: application/json
Mcp-Session-Id: YOUR_SESSION_ID

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "cobrowser_navigate",
        "description": "Navigate the browser to a URL.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "url": {"type": "string", "description": "The URL to navigate to"}
          },
          "required": ["url"]
        }
      },
      ...
    ]
  }
}
```

### Call Tool

Execute a browser automation tool.

**Request:**
```http
POST /mcp HTTP/1.1
Content-Type: application/json
Mcp-Session-Id: YOUR_SESSION_ID

{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "cobrowser_navigate",
    "arguments": {
      "url": "https://example.com"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\": true, \"url\": \"https://example.com\"}"
      }
    ],
    "isError": false
  }
}
```

### Ping

Health check for the session.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "ping",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {}
}
```

## Available Tools

### Navigation & Page Info

| Tool | Description |
|------|-------------|
| `cobrowser_navigate` | Navigate to a URL |
| `cobrowser_get_page_info` | Get current page URL and title |
| `cobrowser_screenshot` | Capture visible tab as PNG |

### Element Interaction

| Tool | Description |
|------|-------------|
| `cobrowser_click` | Click an element (CSS selector, XPath, or coordinates) |
| `cobrowser_doubleclick` | Double-click an element |
| `cobrowser_rightclick` | Right-click to open context menu |
| `cobrowser_type` | Type text into an input field |
| `cobrowser_read` | Read text content from an element |
| `cobrowser_scroll` | Scroll page or to an element |
| `cobrowser_drag` | Drag from source to target |
| `cobrowser_query_all` | Query multiple elements matching a selector |

### Native OS Automation

These tools use OS-level mouse/keyboard control via `xdotool`. Required for popups, file dialogs, and elements that don't respond to synthetic events.

| Tool | Description |
|------|-------------|
| `cobrowser_native_click` | OS-level mouse click |
| `cobrowser_native_move` | Move mouse to element (without clicking) |
| `cobrowser_native_type` | OS-level keyboard typing |
| `cobrowser_native_hotkey` | Press key combinations (e.g., Ctrl+L) |
| `cobrowser_native_scroll` | Mouse wheel scroll |

### Human-in-the-Loop

| Tool | Description |
|------|-------------|
| `cobrowser_request_human` | Request human assistance (CAPTCHA, login, etc.) |
| `cobrowser_get_user_requests` | Get pending user requests from browser |
| `cobrowser_clear_user_request` | Clear a handled request |

## Tool Examples

### Navigate to a URL

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "cobrowser_navigate",
    "arguments": {
      "url": "https://www.google.com"
    }
  }
}
```

### Click an Element

By CSS selector:
```json
{
  "params": {
    "name": "cobrowser_click",
    "arguments": {
      "selector": "button.submit-btn"
    }
  }
}
```

By XPath:
```json
{
  "params": {
    "name": "cobrowser_click",
    "arguments": {
      "xpath": "//button[contains(text(), 'Submit')]"
    }
  }
}
```

By coordinates:
```json
{
  "params": {
    "name": "cobrowser_click",
    "arguments": {
      "x": 500,
      "y": 300
    }
  }
}
```

### Type Text

```json
{
  "params": {
    "name": "cobrowser_type",
    "arguments": {
      "selector": "input[name='search']",
      "text": "hello world",
      "clear": true
    }
  }
}
```

### Take Screenshot

```json
{
  "params": {
    "name": "cobrowser_screenshot",
    "arguments": {}
  }
}
```

Response includes base64-encoded PNG:
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"success\": true, \"dataUrl\": \"data:image/png;base64,iVBORw0KGgo...\"}"
    }]
  }
}
```

### Query Multiple Elements

```json
{
  "params": {
    "name": "cobrowser_query_all",
    "arguments": {
      "selector": "a.nav-link",
      "limit": 10
    }
  }
}
```

### Native Click (for popups)

```json
{
  "params": {
    "name": "cobrowser_native_click",
    "arguments": {
      "selector": "button.apply-now"
    }
  }
}
```

### Request Human Help

```json
{
  "params": {
    "name": "cobrowser_request_human",
    "arguments": {
      "reason": "captcha",
      "message": "Please solve the CAPTCHA and click Continue"
    }
  }
}
```

## Error Handling

Errors follow JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found: invalid_method"
  }
}
```

| Code | Meaning |
|------|---------|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |

Tool execution errors are returned in the result with `isError: true`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"success\": false, \"error\": \"No active browser session\"}"
    }],
    "isError": true
  }
}
```

## Client Examples

### Python

```python
import requests

class CoBrowserClient:
    def __init__(self, base_url="http://localhost:8678"):
        self.base_url = base_url
        self.session_id = None
        self.request_id = 0

    def _next_id(self):
        self.request_id += 1
        return self.request_id

    def _request(self, method, params=None):
        headers = {"Content-Type": "application/json"}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id

        response = requests.post(
            f"{self.base_url}/mcp",
            json={
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": method,
                "params": params or {}
            },
            headers=headers
        )

        # Capture session ID from initialize
        if "Mcp-Session-Id" in response.headers:
            self.session_id = response.headers["Mcp-Session-Id"]

        return response.json()

    def initialize(self, client_name="PythonClient"):
        return self._request("initialize", {
            "protocolVersion": "2024-11-05",
            "clientInfo": {"name": client_name, "version": "1.0"}
        })

    def list_tools(self):
        result = self._request("tools/list")
        return result.get("result", {}).get("tools", [])

    def call_tool(self, name, arguments=None):
        return self._request("tools/call", {
            "name": name,
            "arguments": arguments or {}
        })

# Usage
client = CoBrowserClient()
client.initialize()

tools = client.list_tools()
print(f"Available tools: {[t['name'] for t in tools]}")

result = client.call_tool("cobrowser_navigate", {"url": "https://example.com"})
print(result)
```

### JavaScript/Node.js

```javascript
class CoBrowserClient {
  constructor(baseUrl = 'http://localhost:8678') {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    this.requestId = 0;
  }

  async request(method, params = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method,
        params
      })
    });

    // Capture session ID
    const newSessionId = response.headers.get('Mcp-Session-Id');
    if (newSessionId) this.sessionId = newSessionId;

    return response.json();
  }

  async initialize(clientName = 'JSClient') {
    return this.request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: clientName, version: '1.0' }
    });
  }

  async listTools() {
    const result = await this.request('tools/list');
    return result.result?.tools || [];
  }

  async callTool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }
}

// Usage
const client = new CoBrowserClient();
await client.initialize();

const tools = await client.listTools();
console.log('Available tools:', tools.map(t => t.name));

const result = await client.callTool('cobrowser_navigate', {
  url: 'https://example.com'
});
console.log(result);
```

### GDScript (Godot)

```gdscript
extends Node

var base_url := "http://localhost:8678"
var session_id := ""
var request_id := 0

func _mcp_request(method: String, params: Dictionary = {}) -> Dictionary:
    request_id += 1

    var headers := ["Content-Type: application/json"]
    if session_id:
        headers.append("Mcp-Session-Id: " + session_id)

    var body := JSON.stringify({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params
    })

    var http := HTTPRequest.new()
    add_child(http)

    http.request(base_url + "/mcp", headers, HTTPClient.METHOD_POST, body)
    var result = await http.request_completed

    # Parse response
    var response = JSON.parse_string(result[3].get_string_from_utf8())

    # Capture session ID from headers
    for header in result[2]:
        if header.begins_with("Mcp-Session-Id:"):
            session_id = header.split(": ")[1].strip_edges()

    http.queue_free()
    return response

func initialize() -> Dictionary:
    return await _mcp_request("initialize", {
        "protocolVersion": "2024-11-05",
        "clientInfo": {"name": "Minerva", "version": "1.0"}
    })

func list_tools() -> Array:
    var result = await _mcp_request("tools/list")
    return result.get("result", {}).get("tools", [])

func call_tool(tool_name: String, arguments: Dictionary = {}) -> Dictionary:
    return await _mcp_request("tools/call", {
        "name": tool_name,
        "arguments": arguments
    })
```

## Prerequisites

1. **CoBrowser Service** running on port 8677:
   ```bash
   python -m uvicorn src.Library.cobrowser_service:app --host 0.0.0.0 --port 8677
   ```

2. **MCP HTTP Server** running on port 8678:
   ```bash
   python -m uvicorn src.Library.mcp_tools:app --host 0.0.0.0 --port 8678
   ```

3. **Browser Extension** installed and connected (Firefox with CoBrowser extension)

4. **For native automation**: `xdotool` and `pyautogui` installed:
   ```bash
   sudo apt install xdotool
   pip install pyautogui
   ```

## Health Check

```bash
# Check MCP server (health endpoint is at root)
curl http://localhost:8678/
# {"status":"ok","service":"cobrowser-mcp","version":"0.2.0"}

# Check CoBrowser service
curl http://localhost:8677/
# {"status":"ok",...}

# Check browser connection
curl http://localhost:8677/v1/cobrowser/sessions/active
# {"sessions":["session-id-here"],"count":1}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No active browser session" | Ensure browser extension is connected. Check `sessions/active` endpoint. |
| "CoBrowser service not available" | Start cobrowser_service on port 8677 |
| "Command timed out" | Browser extension may be disconnected. Reload extension. |
| "pyautogui not installed" | Run `pip install pyautogui` and restart cobrowser_service |
| Native clicks miss target | Page may be zoomed. Ensure 100% zoom level. |

## Legacy Endpoints

For backward compatibility, these endpoints still work but are deprecated:

```
GET  /mcp/tools     -> Use tools/list method instead
POST /mcp/call      -> Use tools/call method instead
```
