# Co-Browser Extension Specification

A Firefox extension for collaborative web browsing between Claude (LLM) and a human user.

## 1. Overview

### Vision

Co-Browser enables Claude and a human to work together on web tasks. Claude automates repetitive actions while the human handles authentication, CAPTCHAs, and decisions requiring judgment.

### Design Principle

**"Human Authority, AI Assistance"**: The human always has ultimate control. Claude can automate, but the human can interrupt anytime.

### Use Cases

| Scenario | Claude Does | Human Does |
|----------|-------------|------------|
| LinkedIn Post | Navigate, compose post, submit | Log in, approve content |
| Job Search | Search listings, track applications | Fill application forms |
| Research | Navigate sources, extract content | Handle paywalls, logins |
| Data Entry | Fill repetitive fields | Verify, handle CAPTCHAs |
| Context Commands | Execute natural language task | Right-click, speak/type command |

### Context Menu Commands

The extension adds a right-click context menu that lets humans issue natural language commands to Claude about the current page.

**Example Workflow:**
1. Human is watching a YouTube video
2. Right-clicks anywhere on the page
3. Selects "Ask Claude..." from context menu
4. Types or speaks: "Find and download the transcript for this video, summarize it, then add a nudge"
5. Claude executes the task autonomously

**Implementation:**
- Context menu item: "Ask Claude about this page..."
- Opens input modal for text or voice input
- Sends command + current page context to Claude
- Claude breaks down task into steps and executes

## 2. Architecture

### System Overview

```
┌─────────────┐     WebSocket     ┌─────────────┐     WebSocket     ┌─────────────┐
│ Claude Code │ <===============> │   Browser   │ <===============> │   Firefox   │
│   (LLM)     │                   │   Service   │                   │ + Extension │
│             │                   │  Port 8676  │                   │             │
└─────────────┘                   └─────────────┘                   └─────────────┘
      │                                 │                                  │
      v                                 v                                  v
  Commands:                       Routing:                          Execution:
  - navigate                      - Session mgmt                    - DOM actions
  - click, type                   - State sync                      - Screenshots
  - read, screenshot              - Handoff coord                   - User UI
  - request_human                 - Message queue                   - Overlays
```

### Key Difference from Current Architecture

**Current**: Selenium controls a separate browser window
**New**: Extension controls the user's actual Firefox browser

This enables true co-browsing where both Claude and the human see and interact with the same browser.

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Claude Code** | Sends commands, receives state, decides when to request human help |
| **Browser Service** | Routes messages, manages sessions, coordinates handoffs |
| **Co-Browser Extension** | Executes commands, captures state, shows UI, handles human input |

## 3. Communication Protocol

### Transport: WebSocket

Primary protocol is WebSocket for bidirectional, real-time communication.

**Why WebSocket over HTTP:**
- Real-time state updates (page loads, DOM changes)
- Bidirectional (both sides can initiate)
- Lower latency for rapid command sequences
- Persistent connection for session continuity

### Message Envelope

```typescript
interface Message {
  id: string;              // UUID for request/response correlation
  type: MessageType;       // Category.action format
  timestamp: number;       // Unix timestamp (ms)
  session_id: string;      // Browser session identifier
  payload: object;         // Type-specific data
}
```

### Message Types

#### Commands (Claude → Extension)

| Type | Purpose | Payload |
|------|---------|---------|
| `command.navigate` | Go to URL | `{url, wait_for?, timeout_ms?}` |
| `command.click` | Click element | `{selector?, coordinates?, options?}` |
| `command.type` | Enter text | `{selector, text, clear_first?, human_like?}` |
| `command.scroll` | Scroll page | `{direction, amount?, selector?}` |
| `command.read` | Extract content | `{selector, attribute?}` |
| `command.screenshot` | Capture viewport | `{full_page?, redact_sensitive?}` |
| `command.wait` | Wait for condition | `{selector?, timeout_ms?}` |
| `command.natural_language` | Execute NL command | `{command, context, input_method}` |

#### State Updates (Extension → Claude)

| Type | Purpose | Payload |
|------|---------|---------|
| `state.page_loaded` | Page finished loading | `{url, title, ready_state}` |
| `state.dom_changed` | Significant DOM mutation | `{changes_summary}` |
| `state.navigation` | URL changed | `{from_url, to_url, type}` |
| `state.error` | Action failed | `{error, context}` |

#### Handoff (Bidirectional)

| Type | Purpose | Payload |
|------|---------|---------|
| `handoff.request` | Claude asks for human | `{reason, message, timeout_ms}` |
| `handoff.complete` | Human finished | `{context?}` |
| `handoff.interrupt` | Human takes over | `{reason?}` |
| `handoff.resume` | Human returns control | `{}` |

#### Session

| Type | Purpose |
|------|---------|
| `session.connect` | Initial connection |
| `session.disconnect` | Clean disconnect |
| `session.heartbeat` | Keep-alive ping |

### Message Examples

**Navigate Command:**
```json
{
  "id": "msg-001",
  "type": "command.navigate",
  "timestamp": 1702900000000,
  "session_id": "session-abc",
  "payload": {
    "url": "https://linkedin.com",
    "wait_for": "networkidle",
    "timeout_ms": 30000
  }
}
```

**Handoff Request:**
```json
{
  "id": "msg-002",
  "type": "handoff.request",
  "timestamp": 1702900001000,
  "session_id": "session-abc",
  "payload": {
    "reason": "authentication_required",
    "message": "Please log in to LinkedIn. Click 'Resume' when done.",
    "timeout_ms": 300000
  }
}
```

**State Update:**
```json
{
  "id": "msg-003",
  "type": "state.page_loaded",
  "timestamp": 1702900005000,
  "session_id": "session-abc",
  "payload": {
    "url": "https://linkedin.com/feed",
    "title": "LinkedIn Feed",
    "ready_state": "complete"
  }
}
```

## 4. Control Modes & Handoffs

### Control Modes

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    CLAUDE    │ ←→  │    SHARED    │ ←→  │    HUMAN     │
│   DRIVING    │     │     MODE     │     │   DRIVING    │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ Claude acts  │     │ Both can act │     │ Human acts   │
│ Human sees   │     │ Last wins    │     │ Claude waits │
│ Human can    │     │ Conflict     │     │ Claude sees  │
│ interrupt    │     │ detection    │     │ state only   │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Mode Transitions

| From | To | Trigger |
|------|-----|---------|
| CLAUDE | HUMAN | Claude sends `handoff.request` |
| CLAUDE | HUMAN | Human clicks "Take Control" |
| CLAUDE | SHARED | Human starts interacting (mouse/keyboard) |
| HUMAN | CLAUDE | Human clicks "Resume Automation" |
| SHARED | CLAUDE | No human input for 5 seconds |
| SHARED | HUMAN | Human clicks "Take Control" |

### Handoff Types

| Type | Initiator | Use Case |
|------|-----------|----------|
| **Planned** | Claude | Login needed, payment form, sensitive decision |
| **Emergency** | Extension (auto) | CAPTCHA detected, 2FA prompt |
| **Voluntary** | Human | User wants to take over |

### Handoff Flow

```
Claude                    Service                   Extension/Human
  │                          │                          │
  │──handoff.request────────>│                          │
  │                          │──handoff.request────────>│
  │                          │                          │ [Shows notification]
  │                          │                          │ [Human works...]
  │                          │                          │
  │                          │<──state.dom_changed──────│
  │<──state.dom_changed──────│                          │
  │                          │                          │
  │                          │                          │ [Human clicks Resume]
  │                          │<──handoff.complete───────│
  │<──handoff.complete───────│                          │
  │                          │                          │
  │──command.read───────────>│                          │
```

### CAPTCHA Detection

The extension monitors for common CAPTCHA patterns:

```javascript
const CAPTCHA_PATTERNS = [
  { selector: 'iframe[src*="recaptcha"]', type: 'recaptcha' },
  { selector: '.g-recaptcha', type: 'recaptcha' },
  { selector: 'iframe[src*="hcaptcha"]', type: 'hcaptcha' },
  { selector: '#challenge-form', type: 'cloudflare' },
  { selector: '[class*="captcha"]', type: 'generic' }
];
```

When detected, triggers automatic emergency handoff.

## 5. Security & Privacy

### Data Classification

| Data Type | Sent to Claude? | Storage | Notes |
|-----------|-----------------|---------|-------|
| URL | Yes | Session only | Current page location |
| Page Title | Yes | Session only | Tab title |
| Cleaned DOM | Yes (on-demand) | None | Scripts/styles removed |
| Screenshots | Yes (on-demand) | None | Password fields blurred |
| Form Data | **Never** | Never | - |
| Passwords | **Never** | Never | Cannot see or type |
| Cookies | **Never** | Never | - |
| localStorage | **Never** | Never | - |

### Sensitive Page Detection

Auto-handoff to human on pages matching:
- Banking: `/bank/i`, `/finance/i`
- Payments: `/checkout/i`, `/payment/i`, `/billing/i`
- Auth: `/login/i`, `/signin/i`, `/password/i`
- Medical: `/health/i`, `/medical/i`, `/patient/i`

### Password Field Protection

Claude cannot:
- Click on password fields
- Type into password fields
- Read password field values
- See password fields in screenshots (blurred)

### User Consent

On first use, extension shows permissions dialog:

```
Co-Browser Permissions

Claude AI would like to:
[x] Navigate to websites
[x] Click elements on pages
[x] Type text (except passwords)
[x] Read visible page content
[x] Take screenshots (passwords blurred)

Claude AI will NEVER:
- Access your passwords
- Access cookies or local storage
- Act on banking sites without asking

[Allow]  [Deny]
```

## 6. What Claude Sees

### Page Metadata (Always Sent)

```typescript
interface PageMetadata {
  url: string;
  title: string;
  ready_state: "loading" | "interactive" | "complete";
  viewport: { width: number; height: number };
  scroll_position: { x: number; y: number };
  has_forms: boolean;
  has_captcha: boolean;
  is_sensitive: boolean;
}
```

### DOM Snapshot (On-Demand)

```typescript
interface DOMSnapshot {
  html: string;           // Cleaned HTML (no scripts/styles)
  text_content: string;   // Visible text only
  interactive_elements: InteractiveElement[];
}

interface InteractiveElement {
  selector: string;       // CSS selector or XPath
  tag: string;
  type?: string;          // input type
  text?: string;          // visible text
  placeholder?: string;
  aria_label?: string;
}
```

### Screenshot (On-Demand)

```typescript
interface Screenshot {
  data: string;           // Base64 PNG
  viewport: { width: number; height: number };
  redacted_regions: Region[];  // Password fields, etc.
}
```

### Sync Strategy

| Trigger | Data Sent |
|---------|-----------|
| Page load complete | Page metadata |
| Navigation | Page metadata |
| Claude requests | Full snapshot or screenshot |
| Significant DOM change | Change summary |

## 7. API Design

### Browser Service Endpoints

#### WebSocket

```
ws://localhost:8676/v1/cobrowser/ws/{session_id}
```

#### REST (Fallback)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/cobrowser/session` | Create session |
| DELETE | `/v1/cobrowser/session/{id}` | End session |
| GET | `/v1/cobrowser/session/{id}/state` | Current state |
| POST | `/v1/cobrowser/session/{id}/command` | Send command |
| GET | `/v1/cobrowser/session/{id}/screenshot` | Get screenshot |
| GET | `/v1/cobrowser/session/{id}/dom` | Get DOM snapshot |

### Claude Code Integration

MCP tools for Claude Code:

```
cobrowser_navigate(url, wait_for?, timeout?)
cobrowser_click(selector?, coordinates?)
cobrowser_type(selector, text, clear_first?)
cobrowser_scroll(direction, amount?)
cobrowser_read(selector, attribute?)
cobrowser_screenshot(redact_sensitive?)
cobrowser_request_human(reason, message, timeout?)
cobrowser_get_state()
cobrowser_execute_command(natural_language_command)  # For context menu commands
```

## 8. User Experience

### Control Mode Indicator

Fixed position overlay showing current mode:

```
┌────────────────────────────────────────┐
│ Co-Browser    [Mode Badge]  [Controls] │
└────────────────────────────────────────┘

Mode Badge States:
  [AI]  - Blue, "Claude Driving"
  [YOU] - Green, "You're Driving"
  [BOTH]- Yellow, "Shared Mode"
```

### Action Overlay

When Claude performs an action:

```
┌─────────────────────────────────┐
│ Clicking "Search" button...     │
└─────────────────────────────────┘
```

### Handoff Notification

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Claude needs your help                            │
│                                                     │
│   Please log in to LinkedIn.                        │
│   Click 'Resume' when you're done.                  │
│                                                     │
│   [Resume]  [Take Over Completely]                  │
│                                                     │
│   Timeout in 4:32                                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+T` | Toggle control mode |
| `Alt+Shift+R` | Resume (give back to Claude) |
| `Alt+Shift+P` | Pause (emergency stop) |
| `Escape` | Cancel current Claude action |

### Toolbar Button States

| State | Icon | Badge |
|-------|------|-------|
| Disconnected | Gray | - |
| Claude Driving | Blue | "AI" |
| Human Driving | Green | "YOU" |
| Shared | Yellow | "BOTH" |
| Handoff Pending | Orange | "!" |

## 9. Extension Structure

```
src/extension-cobrowser/
├── manifest.json              # Firefox extension manifest (MV2)
├── background/
│   ├── background.js          # Main background script
│   ├── websocket-manager.js   # WebSocket connection
│   ├── message-router.js      # Message handling
│   └── session-manager.js     # Session state
├── content/
│   ├── content.js             # Main content script
│   ├── action-executor.js     # Execute commands
│   ├── state-capturer.js      # Capture page state
│   ├── dom-observer.js        # Watch for changes
│   └── overlay.js             # Visual overlays
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   └── options.js
└── styles/
    ├── overlay.css
    └── notification.css
```

### Manifest (Key Parts)

```json
{
  "manifest_version": 2,
  "name": "Co-Browser",
  "permissions": [
    "activeTab",
    "tabs",
    "webNavigation",
    "storage",
    "<all_urls>"
  ],
  "background": {
    "scripts": ["background/background.js"],
    "persistent": true
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/content.js"],
    "css": ["styles/overlay.css"],
    "run_at": "document_start",
    "all_frames": true
  }],
  "browser_action": {
    "default_popup": "popup/popup.html"
  },
  "commands": {
    "toggle-control": {
      "suggested_key": { "default": "Alt+Shift+T" }
    }
  }
}
```

**Why Manifest V2**: Persistent background pages provide more reliable WebSocket connections than V3 service workers.

## 10. Implementation Phases

### Phase 1: Foundation
- [ ] New extension structure
- [ ] WebSocket connection to service
- [ ] Basic message routing
- [ ] Session creation/management

### Phase 2: Commands
- [ ] navigate, click, type, scroll
- [ ] read (DOM extraction)
- [ ] screenshot with redaction
- [ ] wait conditions

### Phase 3: Handoffs
- [ ] Request/complete protocol
- [ ] CAPTCHA detection
- [ ] Sensitive page detection
- [ ] Timeout handling

### Phase 4: UX
- [ ] Control mode indicator
- [ ] Action overlays
- [ ] Handoff notifications
- [ ] Keyboard shortcuts
- [ ] Options page

### Phase 5: Context Menu
- [ ] "Ask Claude" context menu item
- [ ] Command input modal (text)
- [ ] Voice input integration
- [ ] Command history/recent
- [ ] Progress overlay for multi-step commands

### Phase 6: Integration
- [ ] MCP tools for Claude Code
- [ ] Update browser service with WebSocket
- [ ] End-to-end testing
- [ ] Documentation

## 11. Context Menu Commands

### Overview

The extension adds a right-click context menu that lets humans issue natural language commands to Claude. This enables ad-hoc automation without switching to Claude Code.

### Context Menu Structure

```
Right-click menu:
├── Ask Claude...              → Opens text input modal
├── Ask Claude (voice)...      → Opens voice input modal
├── ─────────────────
├── Recent Commands            → Submenu
│   ├── "Summarize this page"
│   ├── "Find the main article"
│   └── "Extract all links"
└── ─────────────────
    └── Co-Browser Settings... → Opens options
```

### Command Input Modal

```
┌─────────────────────────────────────────────────────┐
│  Ask Claude                                    [X]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  What would you like Claude to do?                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Find and download the transcript, summarize   │ │
│  │ it, then add a nudge with the key points     │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  [Voice Input]                                      │
│                                                     │
│  Context included:                                  │
│  • Current URL: youtube.com/watch?v=...             │
│  • Page title: "How to Build..."                    │
│  • Selected text: (none)                            │
│                                                     │
│            [Cancel]  [Send to Claude]               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Voice Input

Uses Web Speech API for voice commands:

```javascript
const recognition = new webkitSpeechRecognition();
recognition.continuous = false;
recognition.interimResults = true;

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  sendCommandToClaude(transcript);
};
```

### Command Message

```json
{
  "type": "command.natural_language",
  "payload": {
    "command": "Find and download the transcript, summarize, add a nudge",
    "context": {
      "url": "https://youtube.com/watch?v=xyz",
      "title": "How to Build a Co-Browser Extension",
      "selected_text": null,
      "selected_element": null,
      "page_type": "video"
    },
    "input_method": "voice"
  }
}
```

### Claude's Response Flow

1. **Parse command** - Understand user intent
2. **Plan steps** - Break into executable actions
3. **Execute** - Run each step, requesting handoff if needed
4. **Report** - Show results in overlay notification

### Example: YouTube Transcript

**User command**: "Find and download the transcript, summarize, add a nudge"

**Claude's plan**:
```
1. Look for transcript button/link on page
2. Click to open transcript panel
3. Extract transcript text
4. Summarize content (internal processing)
5. Call nudge MCP tool to store summary
6. Show confirmation to user
```

**Execution**:
```
[Step 1/6] Looking for transcript...
[Step 2/6] Opening transcript panel...
[Step 3/6] Extracting text...
[Step 4/6] Summarizing (2,847 words → 156 words)...
[Step 5/6] Saving to nudge: youtube/transcript-summary
[Complete] Transcript summarized and saved!
```

### Keyboard Shortcut

`Alt+Shift+A` - Open "Ask Claude" modal directly without right-click

### Integration with Existing Tools

Context commands can leverage:
- **Nudge MCP** - Store findings, summaries, extracted data
- **Beads** - Create issues for follow-up tasks
- **WebSearch** - Research beyond current page
- **File operations** - Save content to local files

## 12. Future Enhancements

- **Multi-tab**: Claude manages multiple tabs
- **Recording**: Human demonstrates, Claude learns pattern
- **Form Memory**: Remember form data (with consent)
- **Site Profiles**: Per-domain automation settings
- **Audit Log**: Review all Claude actions
- **Command Templates**: Save and reuse common commands
- **Scheduled Commands**: "Every morning, check this page and..."
