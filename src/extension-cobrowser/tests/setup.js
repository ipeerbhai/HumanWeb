/**
 * Jest test setup for Co-Browser extension
 */

// Mock browser APIs (Firefox WebExtension APIs)
global.browser = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    getURL: jest.fn(path => `moz-extension://test-id/${path}`)
  },
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve())
    },
    sync: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve())
    }
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn(() => Promise.resolve()),
    onUpdated: {
      addListener: jest.fn()
    }
  },
  contextMenus: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn()
    }
  },
  commands: {
    onCommand: {
      addListener: jest.fn()
    }
  }
};

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;

    // Track all instances for testing
    MockWebSocket.instances.push(this);
    MockWebSocket.lastInstance = this;
  }

  send(data) {
    MockWebSocket.sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  // Simulate server sending a message
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // Simulate connection opening
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen({});
    }
  }

  // Simulate connection error
  simulateError(error) {
    if (this.onerror) {
      this.onerror(error);
    }
  }

  // Simulate connection close
  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}

MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;
MockWebSocket.instances = [];
MockWebSocket.lastInstance = null;
MockWebSocket.sentMessages = [];

// Reset mocks before each test
beforeEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.lastInstance = null;
  MockWebSocket.sentMessages = [];
  jest.clearAllMocks();
});

global.WebSocket = MockWebSocket;
global.MockWebSocket = MockWebSocket;
