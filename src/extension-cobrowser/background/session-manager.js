/**
 * Session Manager for Co-Browser Extension
 *
 * Manages client-side session state including:
 * - Control modes (CLAUDE, HUMAN, SHARED)
 * - Session state tracking
 * - Handoff management
 * - Tab associations
 * - Storage persistence
 */

const CONTROL_MODES = ['CLAUDE', 'HUMAN', 'SHARED'];

class SessionManager {
  constructor() {
    // Sessions map: sessionId -> session object
    this.sessions = new Map();

    // Tab to session mapping: tabId -> sessionId
    this.tabSessions = new Map();

    // Event listeners
    this.listeners = {
      modeChanged: [],
      stateChanged: [],
      sessionRemoved: [],
      handoffRequested: [],
      handoffCompleted: []
    };
  }

  /**
   * Generate a UUID
   */
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Create a new session
   * @param {string} [sessionId] - Optional session ID (generated if not provided)
   * @returns {object} - Session object
   */
  createSession(sessionId = null) {
    const id = sessionId || this.generateId();

    const session = {
      sessionId: id,
      controlMode: 'CLAUDE',
      state: {},
      handoff: null,
      createdAt: Date.now(),
      activeTabId: null
    };

    this.sessions.set(id, session);

    return { ...session };
  }

  /**
   * Get a session by ID
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  /**
   * Get all sessions
   * @returns {array}
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(s => ({ ...s }));
  }

  /**
   * Remove a session
   * @param {string} sessionId
   */
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Remove tab association
      if (session.activeTabId) {
        this.tabSessions.delete(session.activeTabId);
      }

      this.sessions.delete(sessionId);
      this.emit('sessionRemoved', { sessionId });
    }
  }

  /**
   * Get current control mode for a session
   * @param {string} sessionId
   * @returns {string|null}
   */
  getControlMode(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.controlMode : null;
  }

  /**
   * Set control mode for a session
   * @param {string} sessionId
   * @param {string} mode - CLAUDE, HUMAN, or SHARED
   */
  setControlMode(sessionId, mode) {
    if (!CONTROL_MODES.includes(mode)) {
      throw new Error(`Invalid control mode: ${mode}. Must be one of: ${CONTROL_MODES.join(', ')}`);
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const previousMode = session.controlMode;
    session.controlMode = mode;

    if (previousMode !== mode) {
      this.emit('modeChanged', {
        sessionId,
        previousMode,
        newMode: mode
      });
    }
  }

  /**
   * Get session state
   * @param {string} sessionId
   * @returns {object|null}
   */
  getState(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.state } : null;
  }

  /**
   * Update session state
   * @param {string} sessionId
   * @param {object} changes - State changes to merge
   */
  updateState(sessionId, changes) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.state = { ...session.state, ...changes };

    this.emit('stateChanged', {
      sessionId,
      changes,
      state: { ...session.state }
    });
  }

  /**
   * Request handoff to human
   * @param {string} sessionId
   * @param {object} options - Handoff options (reason, message, timeout)
   */
  requestHandoff(sessionId, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.handoff = {
      reason: options.reason || 'manual',
      message: options.message || null,
      timeout: options.timeout || null,
      requestedAt: Date.now()
    };

    // Set mode to HUMAN
    const previousMode = session.controlMode;
    session.controlMode = 'HUMAN';

    this.emit('modeChanged', {
      sessionId,
      previousMode,
      newMode: 'HUMAN'
    });

    this.emit('handoffRequested', {
      sessionId,
      reason: session.handoff.reason,
      message: session.handoff.message
    });
  }

  /**
   * Resume automation after handoff
   * @param {string} sessionId
   */
  resumeAutomation(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.handoff = null;

    // Set mode back to CLAUDE
    const previousMode = session.controlMode;
    session.controlMode = 'CLAUDE';

    this.emit('modeChanged', {
      sessionId,
      previousMode,
      newMode: 'CLAUDE'
    });

    this.emit('handoffCompleted', { sessionId });
  }

  /**
   * Associate session with a browser tab
   * @param {string} sessionId
   * @param {number} tabId
   */
  setActiveTab(sessionId, tabId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Remove old tab association
    if (session.activeTabId) {
      this.tabSessions.delete(session.activeTabId);
    }

    session.activeTabId = tabId;
    this.tabSessions.set(tabId, sessionId);
  }

  /**
   * Get active tab for session
   * @param {string} sessionId
   * @returns {number|null}
   */
  getActiveTab(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.activeTabId : null;
  }

  /**
   * Get session ID for a tab
   * @param {number} tabId
   * @returns {string|null}
   */
  getSessionForTab(tabId) {
    return this.tabSessions.get(tabId) || null;
  }

  /**
   * Save sessions to browser storage
   */
  async saveToStorage() {
    const sessionsObj = {};
    this.sessions.forEach((session, id) => {
      sessionsObj[id] = session;
    });

    await browser.storage.local.set({
      cobrowser_sessions: sessionsObj
    });
  }

  /**
   * Load sessions from browser storage
   */
  async loadFromStorage() {
    const result = await browser.storage.local.get('cobrowser_sessions');
    const sessionsObj = result.cobrowser_sessions || {};

    Object.entries(sessionsObj).forEach(([id, session]) => {
      this.sessions.set(id, session);

      // Rebuild tab associations
      if (session.activeTabId) {
        this.tabSessions.set(session.activeTabId, id);
      }
    });
  }

  /**
   * Register event listener
   * @param {string} event
   * @param {function} callback
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   * @param {string} event
   * @param {function} callback
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  /**
   * Emit event
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error('Error in event handler:', e);
        }
      });
    }
  }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionManager;
}
if (typeof global !== 'undefined') {
  global.SessionManager = SessionManager;
}
