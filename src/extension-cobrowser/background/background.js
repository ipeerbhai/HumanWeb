/**
 * Co-Browser Extension - Background Script
 *
 * Main entry point that wires together all background components:
 * - WebSocketManager: Connection to the Co-Browser service
 * - SessionManager: Session and control mode tracking
 * - MessageRouter: Message routing and handoff handling
 */

// Configuration
const CONFIG = {
  serviceUrl: 'ws://localhost:8677',
  reconnectOnStartup: true
};

// Global instances
let wsManager = null;
let sessionManager = null;
let messageRouter = null;
let currentSessionId = null;

/**
 * Initialize the extension
 */
async function initialize() {
  console.log('[Co-Browser] Initializing extension...');

  // Create managers
  sessionManager = new SessionManager();
  wsManager = new WebSocketManager(CONFIG.serviceUrl);
  messageRouter = new MessageRouter(sessionManager, wsManager);

  // Load saved sessions
  await sessionManager.loadFromStorage();

  // Set up WebSocket event handlers
  setupWebSocketHandlers();

  // Set up message router event handlers
  setupRouterHandlers();

  // Set up browser event handlers
  setupBrowserHandlers();

  // Set up context menu
  setupContextMenu();

  console.log('[Co-Browser] Extension initialized');
}

/**
 * Set up WebSocket event handlers
 */
function setupWebSocketHandlers() {
  wsManager.on('connected', (event) => {
    console.log('[Co-Browser] Connected to service:', event.sessionId);
    currentSessionId = event.sessionId;

    // Update badge to show connected
    browser.browserAction.setBadgeText({ text: 'ON' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });

    // Notify all tabs
    notifyAllTabs({ type: 'connection.established', sessionId: currentSessionId });
  });

  wsManager.on('disconnected', (event) => {
    console.log('[Co-Browser] Disconnected from service:', event.reason);

    // Update badge to show disconnected
    browser.browserAction.setBadgeText({ text: 'OFF' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#F44336' });

    // Notify all tabs
    notifyAllTabs({ type: 'connection.lost' });
  });

  wsManager.on('message', async (message) => {
    console.log('[Co-Browser] Received message:', message.type);

    // Route the message
    const result = await messageRouter.route(message);

    // Handle commands
    if (message.type.startsWith('command.')) {
      // Handle navigation in background script (content scripts can't navigate)
      if (message.type === 'command.navigate') {
        await handleNavigateCommand(message);
      } else {
        await forwardCommandToActiveTab(message);
      }
    }
  });

  wsManager.on('error', (error) => {
    console.error('[Co-Browser] WebSocket error:', error);
  });
}

/**
 * Set up message router event handlers
 */
function setupRouterHandlers() {
  messageRouter.on('handoff', (event) => {
    console.log('[Co-Browser] Handoff requested:', event.reason);

    // Show notification to user
    browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-48.png'),
      title: 'Co-Browser: Your Help Needed',
      message: event.message || `Claude needs your help: ${event.reason}`
    });

    // Notify active tab to show handoff UI
    notifyActiveTab({
      type: 'handoff.show',
      reason: event.reason,
      message: event.message
    });
  });

  messageRouter.on('resume', (event) => {
    console.log('[Co-Browser] Automation resumed');

    // Notify active tab to hide handoff UI
    notifyActiveTab({
      type: 'handoff.hide'
    });
  });

  messageRouter.on('emergency', (event) => {
    console.log('[Co-Browser] Emergency handoff:', event.reason);

    // Show urgent notification
    browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-48.png'),
      title: 'Co-Browser: Immediate Help Needed',
      message: `Claude detected: ${event.reason}. Please take over.`,
      priority: 2
    });
  });
}

/**
 * Set up browser event handlers
 */
function setupBrowserHandlers() {
  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleContentScriptMessage(message, sender).then(sendResponse);
    return true; // Keep channel open for async response
  });

  // Listen for tab updates
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && currentSessionId) {
      // Update session with current URL
      sessionManager.updateState(currentSessionId, {
        currentUrl: tab.url,
        title: tab.title
      });

      // Send state update to service
      wsManager.send({
        type: 'state.update',
        session_id: currentSessionId,
        payload: {
          url: tab.url,
          title: tab.title
        }
      });
    }
  });

  // Listen for keyboard commands
  browser.commands.onCommand.addListener((command) => {
    handleKeyboardCommand(command);
  });
}

/**
 * Set up context menu
 */
function setupContextMenu() {
  browser.contextMenus.create({
    id: 'ask-claude',
    title: 'Ask Claude...',
    contexts: ['page', 'selection', 'link', 'image']
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'ask-claude') {
      // Send message to content script to show command modal
      browser.tabs.sendMessage(tab.id, {
        type: 'contextmenu.askClaude',
        selectionText: info.selectionText,
        linkUrl: info.linkUrl,
        srcUrl: info.srcUrl,
        pageUrl: info.pageUrl
      });
    }
  });
}

/**
 * Handle messages from content scripts
 */
async function handleContentScriptMessage(message, sender) {
  console.log('[Co-Browser] Content script message:', message.type);

  switch (message.type) {
    case 'action.result':
      // Forward action result to service
      wsManager.send({
        type: `${message.actionType}.result`,
        session_id: currentSessionId,
        correlation_id: message.correlationId,
        payload: message.result
      });
      return { success: true };

    case 'state.captured':
      // Forward captured state to service
      wsManager.send({
        type: 'state.captured',
        session_id: currentSessionId,
        payload: message.state
      });
      return { success: true };

    case 'security.detected':
      // Handle security detection (CAPTCHA, login page, etc.)
      if (message.hasCaptcha || message.isLoginPage) {
        messageRouter.route({
          id: generateId(),
          type: 'handoff.emergency',
          session_id: currentSessionId,
          payload: {
            reason: message.hasCaptcha ? 'captcha_detected' : 'login_page',
            captchaType: message.captchaType
          }
        });
      }
      return { success: true };

    case 'handoff.resume':
      // User clicked resume button
      if (currentSessionId) {
        sessionManager.resumeAutomation(currentSessionId);
        wsManager.send({
          type: 'handoff.complete',
          session_id: currentSessionId,
          payload: {}
        });
      }
      return { success: true };

    case 'getSessionInfo':
      return {
        sessionId: currentSessionId,
        controlMode: currentSessionId ? sessionManager.getControlMode(currentSessionId) : null,
        connected: wsManager.getState() === 'connected'
      };

    case 'handoff.request':
      // Popup requesting to switch to human control
      if (currentSessionId) {
        sessionManager.setControlMode(currentSessionId, 'HUMAN');
        notifyActiveTab({ type: 'mode.changed', mode: 'HUMAN' });
        wsManager.send({
          type: 'handoff.request',
          session_id: currentSessionId,
          payload: { reason: 'user_request' }
        });
      }
      return { success: true, mode: 'HUMAN' };

    case 'handoff.complete':
      // Popup requesting to resume AI control
      if (currentSessionId) {
        sessionManager.resumeAutomation(currentSessionId);
        notifyActiveTab({ type: 'mode.changed', mode: 'CLAUDE' });
        wsManager.send({
          type: 'handoff.complete',
          session_id: currentSessionId,
          payload: {}
        });
      }
      return { success: true, mode: 'CLAUDE' };

    default:
      console.warn('[Co-Browser] Unknown message type:', message.type);
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Handle keyboard commands
 */
function handleKeyboardCommand(command) {
  console.log('[Co-Browser] Keyboard command:', command);

  switch (command) {
    case 'toggle-control':
      if (currentSessionId) {
        const currentMode = sessionManager.getControlMode(currentSessionId);
        const newMode = currentMode === 'CLAUDE' ? 'HUMAN' : 'CLAUDE';
        sessionManager.setControlMode(currentSessionId, newMode);
        notifyActiveTab({ type: 'mode.changed', mode: newMode });
      }
      break;

    case 'resume-automation':
      if (currentSessionId) {
        sessionManager.resumeAutomation(currentSessionId);
        wsManager.send({
          type: 'handoff.complete',
          session_id: currentSessionId,
          payload: {}
        });
      }
      break;

    case 'emergency-stop':
      if (currentSessionId) {
        sessionManager.setControlMode(currentSessionId, 'HUMAN');
        notifyActiveTab({ type: 'mode.changed', mode: 'HUMAN' });
        wsManager.send({
          type: 'handoff.emergency',
          session_id: currentSessionId,
          payload: { reason: 'user_emergency_stop' }
        });
      }
      break;
  }
}

/**
 * Handle navigate command - navigates the active tab to a URL
 */
async function handleNavigateCommand(message) {
  const url = message.payload?.url;
  if (!url) {
    console.error('[Co-Browser] Navigate command missing URL');
    return { success: false, error: 'Missing URL' };
  }

  console.log('[Co-Browser] Navigating to:', url);

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      await browser.tabs.update(tabs[0].id, { url });

      // Send success response back to service
      wsManager.send({
        type: 'command.navigate.result',
        session_id: currentSessionId,
        correlation_id: message.id,
        payload: { success: true, url }
      });

      return { success: true };
    }
    return { success: false, error: 'No active tab' };
  } catch (error) {
    console.error('[Co-Browser] Navigation failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Forward command to active tab's content script
 */
async function forwardCommandToActiveTab(message) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    try {
      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: message.type,
        payload: message.payload,
        correlationId: message.id
      });
      return response;
    } catch (error) {
      console.error('[Co-Browser] Failed to forward command:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'No active tab' };
}

/**
 * Notify all tabs
 */
async function notifyAllTabs(message) {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    try {
      await browser.tabs.sendMessage(tab.id, message);
    } catch (error) {
      // Tab might not have content script loaded
    }
  }
}

/**
 * Notify active tab
 */
async function notifyActiveTab(message) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    try {
      await browser.tabs.sendMessage(tabs[0].id, message);
    } catch (error) {
      console.error('[Co-Browser] Failed to notify active tab:', error);
    }
  }
}

/**
 * Generate UUID
 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Connect to service
 */
function connect(sessionId = null) {
  const id = sessionId || generateId();
  wsManager.connect(id);
  currentSessionId = id;

  // Track in session manager
  if (!sessionManager.getSession(id)) {
    sessionManager.createSession(id);
  }

  return id;
}

/**
 * Disconnect from service
 */
function disconnect() {
  wsManager.disconnect();
  currentSessionId = null;
}

// Expose functions for popup
window.cobrowser = {
  connect,
  disconnect,
  getSessionId: () => currentSessionId,
  getState: () => wsManager.getState(),
  getControlMode: () => currentSessionId ? sessionManager.getControlMode(currentSessionId) : null,
  setControlMode: (mode) => {
    if (currentSessionId) {
      sessionManager.setControlMode(currentSessionId, mode);
      notifyActiveTab({ type: 'mode.changed', mode });
      return true;
    }
    return false;
  }
};

// Initialize on load
initialize();
