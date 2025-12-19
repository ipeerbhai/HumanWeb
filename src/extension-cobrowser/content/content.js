/**
 * Co-Browser Extension - Content Script
 *
 * Main entry point that wires together content script components:
 * - ActionExecutor: Execute browser actions (click, type, scroll, read)
 * - StateCapturer: Capture page state
 * - Overlay: Show mode indicator and action feedback
 */

// Global instances
let actionExecutor = null;
let stateCapturer = null;
let overlay = null;
let isInitialized = false;

/**
 * Initialize content script
 */
function initialize() {
  if (isInitialized) return;

  console.log('[Co-Browser Content] Initializing...');

  // Create instances
  actionExecutor = new ActionExecutor();
  stateCapturer = new StateCapturer();

  // Create overlay UI
  createOverlay();

  // Set up message listener
  browser.runtime.onMessage.addListener(handleMessage);

  // Initial security check
  performSecurityCheck();

  // Set up DOM observer for dynamic content
  setupDOMObserver();

  isInitialized = true;
  console.log('[Co-Browser Content] Initialized');
}

/**
 * Create overlay UI elements
 */
function createOverlay() {
  // Create container
  overlay = document.createElement('div');
  overlay.id = 'cobrowser-overlay';
  overlay.innerHTML = `
    <div id="cobrowser-mode-indicator" class="cobrowser-indicator">
      <span class="cobrowser-mode-icon">🤖</span>
      <span class="cobrowser-mode-text">AI</span>
    </div>
    <div id="cobrowser-action-overlay" class="cobrowser-action" style="display: none;">
      <span class="cobrowser-action-text"></span>
    </div>
    <div id="cobrowser-handoff-notification" class="cobrowser-handoff" style="display: none;">
      <div class="cobrowser-handoff-content">
        <div class="cobrowser-handoff-icon">🙋</div>
        <div class="cobrowser-handoff-message"></div>
        <button id="cobrowser-resume-btn" class="cobrowser-btn">Resume Automation</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Add resume button handler
  document.getElementById('cobrowser-resume-btn').addEventListener('click', () => {
    browser.runtime.sendMessage({ type: 'handoff.resume' });
    hideHandoffNotification();
  });
}

/**
 * Handle messages from background script
 */
async function handleMessage(message, sender, sendResponse) {
  console.log('[Co-Browser Content] Received:', message.type);

  try {
    switch (message.type) {
      // Connection events
      case 'connection.established':
        updateModeIndicator('CLAUDE');
        return { success: true };

      case 'connection.lost':
        updateModeIndicator('DISCONNECTED');
        return { success: true };

      // Mode changes
      case 'mode.changed':
        updateModeIndicator(message.mode);
        return { success: true };

      // Commands
      case 'command.navigate':
        // Navigation is handled by the browser, just acknowledge
        return { success: true };

      case 'command.click':
        showActionOverlay('Clicking...');
        const clickResult = await actionExecutor.click(message.payload);
        hideActionOverlay();
        sendActionResult('command.click', message.correlationId, clickResult);
        return clickResult;

      case 'command.type':
        showActionOverlay('Typing...');
        const typeResult = await actionExecutor.type(message.payload);
        hideActionOverlay();
        sendActionResult('command.type', message.correlationId, typeResult);
        return typeResult;

      case 'command.scroll':
        showActionOverlay('Scrolling...');
        const scrollResult = await actionExecutor.scroll(message.payload);
        hideActionOverlay();
        sendActionResult('command.scroll', message.correlationId, scrollResult);
        return scrollResult;

      case 'command.read':
        const readResult = await actionExecutor.read(message.payload);
        sendActionResult('command.read', message.correlationId, readResult);
        return readResult;

      case 'command.screenshot':
        // Screenshot is handled by background script
        return { success: true };

      case 'command.getState':
        const state = stateCapturer.captureState(message.payload || {});
        sendActionResult('command.getState', message.correlationId, state);
        return state;

      // Handoff UI
      case 'handoff.show':
        showHandoffNotification(message.reason, message.message);
        updateModeIndicator('HUMAN');
        return { success: true };

      case 'handoff.hide':
        hideHandoffNotification();
        updateModeIndicator('CLAUDE');
        return { success: true };

      // Context menu
      case 'contextmenu.askClaude':
        showCommandModal(message);
        return { success: true };

      default:
        console.warn('[Co-Browser Content] Unknown message type:', message.type);
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('[Co-Browser Content] Error handling message:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send action result to background
 */
function sendActionResult(actionType, correlationId, result) {
  browser.runtime.sendMessage({
    type: 'action.result',
    actionType,
    correlationId,
    result
  });
}

/**
 * Update mode indicator
 */
function updateModeIndicator(mode) {
  const indicator = document.getElementById('cobrowser-mode-indicator');
  if (!indicator) return;

  const icon = indicator.querySelector('.cobrowser-mode-icon');
  const text = indicator.querySelector('.cobrowser-mode-text');

  switch (mode) {
    case 'CLAUDE':
      icon.textContent = '🤖';
      text.textContent = 'AI';
      indicator.className = 'cobrowser-indicator cobrowser-mode-claude';
      break;
    case 'HUMAN':
      icon.textContent = '👤';
      text.textContent = 'YOU';
      indicator.className = 'cobrowser-indicator cobrowser-mode-human';
      break;
    case 'SHARED':
      icon.textContent = '🤝';
      text.textContent = 'BOTH';
      indicator.className = 'cobrowser-indicator cobrowser-mode-shared';
      break;
    case 'DISCONNECTED':
      icon.textContent = '⚡';
      text.textContent = 'OFF';
      indicator.className = 'cobrowser-indicator cobrowser-mode-disconnected';
      break;
  }
}

/**
 * Show action overlay
 */
function showActionOverlay(text) {
  const overlay = document.getElementById('cobrowser-action-overlay');
  const textEl = overlay.querySelector('.cobrowser-action-text');
  if (overlay && textEl) {
    textEl.textContent = text;
    overlay.style.display = 'flex';
  }
}

/**
 * Hide action overlay
 */
function hideActionOverlay() {
  const overlay = document.getElementById('cobrowser-action-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * Show handoff notification
 */
function showHandoffNotification(reason, message) {
  const notification = document.getElementById('cobrowser-handoff-notification');
  const messageEl = notification.querySelector('.cobrowser-handoff-message');

  if (notification && messageEl) {
    messageEl.textContent = message || `Claude needs your help: ${reason}`;
    notification.style.display = 'flex';
  }
}

/**
 * Hide handoff notification
 */
function hideHandoffNotification() {
  const notification = document.getElementById('cobrowser-handoff-notification');
  if (notification) {
    notification.style.display = 'none';
  }
}

/**
 * Show command modal for context menu
 */
function showCommandModal(context) {
  // Remove existing modal to ensure clean state with event listeners
  let existingModal = document.getElementById('cobrowser-command-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create fresh modal
  const modal = document.createElement('div');
  modal.id = 'cobrowser-command-modal';
  modal.className = 'cobrowser-modal';
  modal.innerHTML = `
    <div class="cobrowser-modal-content">
      <div class="cobrowser-modal-header">
        <span>Ask Claude</span>
        <button class="cobrowser-modal-close">&times;</button>
      </div>
      <div class="cobrowser-modal-body">
        <textarea id="cobrowser-command-input" placeholder="What would you like Claude to do?"></textarea>
        <div class="cobrowser-modal-context"></div>
      </div>
      <div class="cobrowser-modal-footer">
        <button id="cobrowser-command-submit" class="cobrowser-btn cobrowser-btn-primary">Send</button>
        <button id="cobrowser-command-cancel" class="cobrowser-btn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Add event listeners
  modal.querySelector('.cobrowser-modal-close').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  modal.querySelector('#cobrowser-command-cancel').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  modal.querySelector('#cobrowser-command-submit').addEventListener('click', () => {
    const input = document.getElementById('cobrowser-command-input');
    if (input.value.trim()) {
      browser.runtime.sendMessage({
        type: 'command.natural',
        text: input.value,
        context: {
          url: window.location.href,
          title: document.title,
          selection: context.selectionText
        }
      });
      modal.style.display = 'none';
      input.value = '';
    }
  });

  // Update context display
  const contextEl = modal.querySelector('.cobrowser-modal-context');
  if (context.selectionText) {
    contextEl.textContent = `Selected: "${context.selectionText.substring(0, 100)}..."`;
  } else {
    contextEl.textContent = `Page: ${document.title}`;
  }

  modal.style.display = 'flex';
  document.getElementById('cobrowser-command-input').focus();
}

/**
 * Perform initial security check
 */
function performSecurityCheck() {
  const security = stateCapturer.getSecurityInfo();

  if (security.hasCaptcha || security.hasCloudflareChallenge) {
    browser.runtime.sendMessage({
      type: 'security.detected',
      hasCaptcha: security.hasCaptcha,
      captchaType: security.captchaType,
      hasCloudflareChallenge: security.hasCloudflareChallenge
    });
  }

  if (security.isLoginPage || stateCapturer.isSensitiveURL(window.location.href)) {
    browser.runtime.sendMessage({
      type: 'security.detected',
      isLoginPage: security.isLoginPage,
      isSensitiveURL: true
    });
  }
}

/**
 * Set up DOM observer for dynamic content
 */
function setupDOMObserver() {
  const observer = new MutationObserver((mutations) => {
    // Check for dynamically added CAPTCHAs
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList?.contains('g-recaptcha') ||
              node.classList?.contains('h-captcha') ||
              node.id === 'cf-wrapper') {
            browser.runtime.sendMessage({
              type: 'security.detected',
              hasCaptcha: true,
              captchaType: node.classList.contains('h-captcha') ? 'hcaptcha' : 'recaptcha'
            });
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
