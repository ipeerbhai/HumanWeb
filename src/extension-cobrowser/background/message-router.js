/**
 * Message Router for Co-Browser Extension
 *
 * Routes messages between the WebSocket service and content scripts.
 * Handles handoff protocol and control mode changes.
 */

class MessageRouter {
  /**
   * @param {SessionManager} sessionManager
   * @param {WebSocketManager} wsManager
   */
  constructor(sessionManager, wsManager) {
    this.sessionManager = sessionManager;
    this.wsManager = wsManager;

    // Message handlers: type pattern -> handler function
    this.handlers = new Map();

    // Event listeners
    this.listeners = {
      handoff: [],
      resume: [],
      emergency: [],
      error: []
    };

    // Register built-in handlers
    this.registerBuiltInHandlers();
  }

  /**
   * Register built-in message handlers
   */
  registerBuiltInHandlers() {
    // Handoff request
    this.registerHandler('handoff.request', async (message) => {
      return this.handleHandoffRequest(message);
    });

    // Handoff complete
    this.registerHandler('handoff.complete', async (message) => {
      return this.handleHandoffComplete(message);
    });

    // Emergency handoff
    this.registerHandler('handoff.emergency', async (message) => {
      return this.handleEmergencyHandoff(message);
    });

    // State get
    this.registerHandler('state.get', async (message) => {
      return this.handleStateGet(message);
    });

    // State update
    this.registerHandler('state.update', async (message) => {
      return this.handleStateUpdate(message);
    });

    // Mode set
    this.registerHandler('mode.set', async (message) => {
      return this.handleModeSet(message);
    });
  }

  /**
   * Register a message handler
   * @param {string} typePattern - Message type or pattern (supports * wildcard)
   * @param {function} handler - Async handler function
   */
  registerHandler(typePattern, handler) {
    this.handlers.set(typePattern, handler);
  }

  /**
   * Find handler for a message type
   * @param {string} type - Message type
   * @returns {function|null}
   */
  findHandler(type) {
    // Exact match first
    if (this.handlers.has(type)) {
      return this.handlers.get(type);
    }

    // Wildcard match
    for (const [pattern, handler] of this.handlers) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (type.startsWith(prefix + '.')) {
          return handler;
        }
      }
    }

    return null;
  }

  /**
   * Route a message to its handler
   * @param {object} message - Incoming message
   * @returns {Promise<object>} - Result
   */
  async route(message) {
    const { id, type, session_id } = message;

    const handler = this.findHandler(type);

    if (!handler) {
      return {
        success: false,
        error: `No handler for message type: ${type}`
      };
    }

    try {
      const result = await handler(message);

      // Send response back if we have a session
      if (session_id && this.wsManager) {
        const response = {
          id: this.generateId(),
          type: `${type}.result`,
          timestamp: Date.now(),
          session_id: session_id,
          correlation_id: id,
          payload: result
        };
        this.wsManager.send(response);
      }

      return result;
    } catch (error) {
      const errorResult = {
        success: false,
        error: error.message
      };

      this.emit('error', { message, error });

      return errorResult;
    }
  }

  /**
   * Handle handoff request
   */
  async handleHandoffRequest(message) {
    const { session_id, payload } = message;
    const { reason, message: handoffMessage, timeout } = payload;

    this.sessionManager.requestHandoff(session_id, {
      reason,
      message: handoffMessage,
      timeout
    });

    this.emit('handoff', {
      sessionId: session_id,
      reason,
      message: handoffMessage,
      timeout
    });

    return { success: true };
  }

  /**
   * Handle handoff complete
   */
  async handleHandoffComplete(message) {
    const { session_id } = message;

    this.sessionManager.resumeAutomation(session_id);

    this.emit('resume', {
      sessionId: session_id
    });

    return { success: true };
  }

  /**
   * Handle emergency handoff
   */
  async handleEmergencyHandoff(message) {
    const { session_id, payload } = message;
    const { reason, captchaType } = payload;

    this.sessionManager.requestHandoff(session_id, {
      reason,
      emergency: true
    });

    this.emit('emergency', {
      sessionId: session_id,
      reason,
      captchaType
    });

    this.emit('handoff', {
      sessionId: session_id,
      reason,
      emergency: true
    });

    return { success: true };
  }

  /**
   * Handle state get request
   */
  async handleStateGet(message) {
    const { session_id } = message;

    const state = this.sessionManager.getState(session_id);
    const controlMode = this.sessionManager.getControlMode(session_id);
    const session = this.sessionManager.getSession(session_id);

    return {
      success: true,
      controlMode,
      state,
      handoff: session?.handoff || null
    };
  }

  /**
   * Handle state update
   */
  async handleStateUpdate(message) {
    const { session_id, payload } = message;

    this.sessionManager.updateState(session_id, payload);

    return { success: true };
  }

  /**
   * Handle mode set
   */
  async handleModeSet(message) {
    const { session_id, payload } = message;
    const { mode } = payload;

    try {
      this.sessionManager.setControlMode(session_id, mode);
      return { success: true, mode };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Forward a message to the content script
   * @param {object} message - Message to forward
   * @returns {Promise<object>}
   */
  async forwardToContentScript(message) {
    const { session_id } = message;

    const tabId = this.sessionManager.getActiveTab(session_id);

    if (!tabId) {
      return {
        success: false,
        error: 'No active tab for session'
      };
    }

    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: message.type,
        payload: message.payload
      });

      return response;
    } catch (error) {
      return {
        success: false,
        error: `Content script error: ${error.message}`
      };
    }
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
   * Register event listener
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  /**
   * Emit event
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
  module.exports = MessageRouter;
}
if (typeof global !== 'undefined') {
  global.MessageRouter = MessageRouter;
}
