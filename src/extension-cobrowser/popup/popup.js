/**
 * Co-Browser Extension - Popup Script
 */

// Get background page
const background = browser.extension.getBackgroundPage();

// UI Elements
const connectionStatus = document.getElementById('connection-status');
const controlMode = document.getElementById('control-mode');
const sessionId = document.getElementById('session-id');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const toggleModeBtn = document.getElementById('toggle-mode-btn');
const urlGroup = document.getElementById('url-group');
const serviceUrl = document.getElementById('service-url');
const optionsLink = document.getElementById('options-link');

/**
 * Update UI based on current state
 */
function updateUI() {
  const cobrowser = background.cobrowser;
  const state = cobrowser.getState();
  const mode = cobrowser.getControlMode();
  const session = cobrowser.getSessionId();

  // Connection status
  if (state === 'connected') {
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'status-value status-connected';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'block';
    toggleModeBtn.style.display = 'block';
    urlGroup.style.display = 'none';
  } else if (state === 'connecting') {
    connectionStatus.textContent = 'Connecting...';
    connectionStatus.className = 'status-value';
    connectBtn.disabled = true;
  } else {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'status-value status-disconnected';
    connectBtn.style.display = 'block';
    connectBtn.disabled = false;
    disconnectBtn.style.display = 'none';
    toggleModeBtn.style.display = 'none';
    urlGroup.style.display = 'block';
  }

  // Control mode
  if (mode) {
    switch (mode) {
      case 'CLAUDE':
        controlMode.textContent = '🤖 AI';
        controlMode.className = 'mode-badge mode-claude';
        toggleModeBtn.textContent = 'Switch to Human Control';
        break;
      case 'HUMAN':
        controlMode.textContent = '👤 YOU';
        controlMode.className = 'mode-badge mode-human';
        toggleModeBtn.textContent = 'Resume AI Control';
        break;
      case 'SHARED':
        controlMode.textContent = '🤝 BOTH';
        controlMode.className = 'mode-badge mode-shared';
        toggleModeBtn.textContent = 'Switch to AI Control';
        break;
    }
  } else {
    controlMode.textContent = '—';
    controlMode.className = 'mode-badge';
  }

  // Session ID
  if (session) {
    sessionId.textContent = session.substring(0, 8) + '...';
    sessionId.title = session;
  } else {
    sessionId.textContent = '—';
    sessionId.title = '';
  }
}

/**
 * Connect to service
 */
function connect() {
  const cobrowser = background.cobrowser;
  cobrowser.connect();

  // Start polling for state updates
  const pollInterval = setInterval(() => {
    updateUI();
    if (cobrowser.getState() === 'connected') {
      clearInterval(pollInterval);
    }
  }, 500);
}

/**
 * Disconnect from service
 */
function disconnect() {
  const cobrowser = background.cobrowser;
  cobrowser.disconnect();
  updateUI();
}

/**
 * Toggle control mode
 */
function toggleMode() {
  const cobrowser = background.cobrowser;
  const currentMode = cobrowser.getControlMode();

  // This is simplified - in reality we'd send a message to the service
  browser.runtime.sendMessage({
    type: currentMode === 'CLAUDE' ? 'handoff.request' : 'handoff.complete'
  });

  setTimeout(updateUI, 100);
}

// Event listeners
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
toggleModeBtn.addEventListener('click', toggleMode);

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

// Initial UI update
updateUI();

// Poll for updates while popup is open
setInterval(updateUI, 1000);
