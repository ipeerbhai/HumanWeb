/**
 * WebSocket Manager for Co-Browser Extension
 *
 * Handles WebSocket connection to the Co-Browser service with:
 * - Automatic reconnection with exponential backoff
 * - Message queuing when disconnected
 * - Heartbeat keep-alive
 * - Request/response correlation
 */

class WebSocketManager {
  /**
   * @param {string} baseUrl - Base URL of the Co-Browser service (e.g., 'ws://localhost:8677')
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.sessionId = null;
    this.state = 'disconnected';

    // Message queue for when disconnected
    this.messageQueue = [];

    // Event listeners
    this.listeners = {
      connected: [],
      disconnected: [],
      error: [],
      message: []
    };

    // Pending requests awaiting response
    this.pendingRequests = new Map();

    // Reconnection settings.
    // We retry indefinitely (capped delay) rather than giving up after a fixed
    // count: a co-browsing session may outlive transient outages, laptop sleep,
    // or service restarts, and a permanently-dead socket strands the agent.
    this.reconnectAttempts = 0;
    this.maxBackoffExponent = 5; // caps growth; delay still clamped below
    this.baseReconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;

    // Heartbeat settings
    this.heartbeatInterval = 30000; // 30 seconds
    this.heartbeatTimer = null;
    // Liveness tracking: any inbound frame (incl. heartbeat.ack) updates this.
    // If we go longer than heartbeatTimeout without hearing anything while
    // "connected", the socket is a zombie (send() succeeds into the void) and
    // we force a reconnect.
    this.lastInboundTime = 0;
    this.heartbeatTimeout = this.heartbeatInterval * 2;
  }

  /**
   * Generate a UUID for message IDs
   */
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Connect to the Co-Browser service
   * @param {string} sessionId - Session ID to connect with
   */
  connect(sessionId) {
    this.sessionId = sessionId;
    this.intentionalDisconnect = false;
    this.state = 'connecting';

    const url = `${this.baseUrl}/v1/cobrowser/ws/${sessionId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.state = 'connected';
      this.reconnectAttempts = 0;
      this.lastInboundTime = Date.now();
      this.startHeartbeat();
      this.flushQueue();
      this.emit('connected', { sessionId });
    };

    this.ws.onclose = (event) => {
      this.state = 'disconnected';
      this.stopHeartbeat();
      this.emit('disconnected', { code: event.code, reason: event.reason });

      // Attempt reconnect if not intentional
      if (!this.intentionalDisconnect && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      this.emit('error', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }

  /**
   * Disconnect from the service
   */
  disconnect() {
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    this.stopReconnect();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.sessionId = null;
    this.state = 'disconnected';
  }

  /**
   * Get current connection state
   * @returns {string} - 'connecting', 'connected', or 'disconnected'
   */
  getState() {
    return this.state;
  }

  /**
   * Get current session ID
   * @returns {string|null}
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Get number of queued messages
   * @returns {number}
   */
  getQueueLength() {
    return this.messageQueue.length;
  }

  /**
   * Send a message (queues if disconnected)
   * @param {object} message - Message to send
   */
  send(message) {
    // Add ID and timestamp if not present
    if (!message.id) {
      message.id = this.generateId();
    }
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }
    if (!message.session_id && this.sessionId) {
      message.session_id = this.sessionId;
    }

    if (this.state === 'connected' && this.ws) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  /**
   * Send a request and wait for response
   * @param {object} message - Message to send
   * @param {object} options - Options (timeout)
   * @returns {Promise<object>} - Response message
   */
  sendRequest(message, options = {}) {
    const timeout = options.timeout || 30000;

    return new Promise((resolve, reject) => {
      // Add ID if not present
      if (!message.id) {
        message.id = this.generateId();
      }

      const messageId = message.id;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Request timeout'));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(messageId, {
        resolve,
        reject,
        timeoutId
      });

      // Send the message
      this.send(message);
    });
  }

  /**
   * Register event listener
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  /**
   * Emit event to listeners
   * @param {string} event - Event name
   * @param {*} data - Event data
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

  /**
   * Handle incoming message
   * @param {object} data - Parsed message data
   */
  handleMessage(data) {
    // Any inbound frame proves the connection is alive.
    this.lastInboundTime = Date.now();

    // Handle heartbeat ack silently
    if (data.type === 'heartbeat.ack') {
      return;
    }

    // Check for pending request
    if (data.correlation_id && this.pendingRequests.has(data.correlation_id)) {
      const pending = this.pendingRequests.get(data.correlation_id);
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(data.correlation_id);
      pending.resolve(data);
      return;
    }

    // Emit for other handlers
    this.emit('message', data);
  }

  /**
   * Flush queued messages
   */
  flushQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (this.ws && this.state === 'connected') {
        this.ws.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Start heartbeat timer
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'connected') return;

      // Zombie-connection guard: if we haven't heard anything back for two
      // heartbeat intervals, the socket is dead despite send() succeeding.
      // Force-close so onclose fires and the normal reconnect path runs.
      if (this.lastInboundTime &&
          Date.now() - this.lastInboundTime > this.heartbeatTimeout) {
        console.warn('[Co-Browser] Heartbeat timeout — forcing reconnect');
        if (this.ws) {
          this.ws.close(4001, 'Heartbeat timeout');
        }
        return;
      }

      this.send({
        type: 'heartbeat',
        payload: {}
      });
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    // Retry indefinitely with exponential backoff capped at maxReconnectDelay.
    // The exponent is clamped so the delay plateaus (rather than terminating),
    // keeping a steady reconnect heartbeat until the service returns.
    const exponent = Math.min(this.reconnectAttempts, this.maxBackoffExponent);
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, exponent),
      this.maxReconnectDelay
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      if (this.sessionId) {
        this.connect(this.sessionId);
      }
    }, delay);
  }

  /**
   * Stop reconnection attempts
   */
  stopReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketManager;
}
if (typeof global !== 'undefined') {
  global.WebSocketManager = WebSocketManager;
}
