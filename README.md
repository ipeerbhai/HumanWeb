# HumanWeb

A tool for LLMs to use the web with human-in-the-loop assistance.

Humans handle authentications and robot checks while LLMs automate mundane and repeatable tasks.

## Two Approaches

### 1. Co-Browser (Recommended)

Real-time browser automation via MCP integration with Claude Code. The human maintains control while Claude assists with web tasks.

### 2. DSL-Based (Legacy)

Script-based automation using a Domain Specific Language with Selenium.

---

## Co-Browser Setup

### Prerequisites

- Firefox browser
- Python 3.11+
- Claude Code CLI

### 1. Install Dependencies

```bash
pip install -r src/requirements.txt
```

### 2. Load the Firefox Extension

1. Open Firefox and go to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `src/extension-cobrowser/manifest.json`

### 3. Start the Co-Browser Service

```bash
python -m uvicorn src.Library.cobrowser_service:app --host 0.0.0.0 --port 8677
```

### 4. Connect the Extension

1. Click the Co-Browser extension icon in Firefox
2. Click "Connect" to establish WebSocket connection
3. The badge should show "ON" when connected

### 5. Use with Claude Code

The `.mcp.json` file configures Claude Code to use the Co-Browser MCP server automatically. Just start Claude Code in this directory:

```bash
claude
```

## MCP Tools

Once connected, Claude Code has access to these browser automation tools:

| Tool | Description |
|------|-------------|
| `cobrowser_navigate` | Navigate to a URL |
| `cobrowser_click` | Click an element by CSS selector |
| `cobrowser_type` | Type text into an input field |
| `cobrowser_read` | Read text content from an element |
| `cobrowser_scroll` | Scroll the page up or down |
| `cobrowser_get_page_info` | Get current page URL and title |
| `cobrowser_request_human` | Request human assistance (for CAPTCHAs, logins) |
| `cobrowser_get_user_requests` | Get pending "Ask Claude..." requests |
| `cobrowser_clear_user_request` | Clear a handled user request |

## "Ask Claude..." Feature

Users can right-click on any webpage and select "Ask Claude..." to send natural language requests:

1. Right-click on the page
2. Select "Ask Claude..." from the context menu
3. Type your request (e.g., "Find all links on this page")
4. Click Send

Claude Code can retrieve these requests using `cobrowser_get_user_requests`.

## Control Modes

The extension supports three control modes:

- **AI (Claude)**: Claude drives the browser
- **YOU (Human)**: User has control (during handoffs)
- **BOTH (Shared)**: Both can interact

Use keyboard shortcuts to switch modes:
- `Ctrl+Shift+.` - Toggle control mode
- `Ctrl+Shift+,` - Resume automation
- `F8` - Emergency stop

## Security

- Claude **cannot** access password fields
- Claude **cannot** type into password fields
- Screenshots blur sensitive content
- Human can take control at any time

---

## DSL-Based Automation (Legacy)

The original approach uses a Domain Specific Language for scripted automation.

### DSL Command Structure

```python
command_structure = {
    "NAVIGATE": ["URL"],
    "ASK_USER": ["Prompt"],
    "CLICK_XPATH": ["XPath"],
    "TYPE_XPATH": ["XPath", "Text"],
    "SAVE_TO_VARIABLE": ["Variable Name", "Value"],
    "READ_XPATH": ["XPath"],
    "FIND_AND_SAVE": ["URL", "Query", "Variable Name"],
    "KEYBOARD_CLICK": ["Keyboard Button"],
}
```

### Running the DSL UI

```bash
# Start the browser service
python -m uvicorn src.Library.browser_service:app --host 0.0.0.0 --port 8676

# Start the Streamlit UI
streamlit run src/UI/ui_experiment.py
```

---

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Claude Code    │◄──────────────────►│  Co-Browser      │
│  (MCP Client)   │                    │  Service         │
└────────┬────────┘                    │  (Port 8677)     │
         │                             └────────┬─────────┘
         │ MCP/stdio                            │ WebSocket
         │                                      │
┌────────┴────────┐                    ┌────────┴─────────┐
│  MCP Server     │                    │  Firefox         │
│  (cobrowser_    │                    │  Extension       │
│   mcp_server.py)│                    │  (Content +      │
└─────────────────┘                    │   Background)    │
                                       └──────────────────┘
```

## License

MIT
