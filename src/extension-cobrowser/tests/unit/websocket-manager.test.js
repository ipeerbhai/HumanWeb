/**
 * TDD Tests for WebSocket Manager
 *
 * These tests define the expected behavior of the WebSocketManager
 * before implementation. Run with: npm test
 */

// Will be loaded from the actual implementation
let WebSocketManager;

beforeAll(() => {
  // Load the module under test
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.join(__dirname, '../../background/websocket-manager.js'),
    'utf8'
  );
  // Execute in global scope to define WebSocketManager
  eval(code);
  WebSocketManager = global.WebSocketManager;
});

describe('WebSocketManager', () => {
  let manager;

  beforeEach(() => {
    manager = new WebSocketManager('ws://localhost:8677');
  });

  afterEach(() => {
    if (manager && manager.disconnect) {
      manager.disconnect();
    }
  });

  describe('Connection', () => {
    test('connects to service URL', () => {
      const sessionId = 'test-session-123';
      manager.connect(sessionId);

      expect(MockWebSocket.lastInstance).not.toBeNull();
      expect(MockWebSocket.lastInstance.url).toBe(
        `ws://localhost:8677/v1/cobrowser/ws/${sessionId}`
      );
    });

    test('sets readyState to CONNECTING initially', () => {
      manager.connect('test-session');

      expect(manager.getState()).toBe('connecting');
    });

    test('sets readyState to OPEN after connection', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      expect(manager.getState()).toBe('connected');
    });

    test('emits connected event on open', (done) => {
      manager.on('connected', () => {
        done();
      });

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();
    });

    test('emits disconnected event on close', (done) => {
      manager.on('disconnected', (event) => {
        expect(event.code).toBeDefined();
        done();
      });

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();
      MockWebSocket.lastInstance.simulateClose(1000, 'Normal close');
    });

    test('emits error event on error', (done) => {
      manager.on('error', (error) => {
        done();
      });

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateError(new Error('Connection failed'));
    });
  });

  describe('Message Queue', () => {
    test('queues messages when disconnected', () => {
      // Don't connect - should queue
      manager.send({ type: 'test', payload: {} });

      expect(manager.getQueueLength()).toBe(1);
    });

    test('sends messages immediately when connected', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      manager.send({ type: 'test', payload: { data: 'hello' } });

      expect(MockWebSocket.sentMessages).toHaveLength(1);
      expect(MockWebSocket.sentMessages[0].type).toBe('test');
    });

    test('flushes queue on reconnect', () => {
      // Queue messages while disconnected
      manager.send({ type: 'msg1', payload: {} });
      manager.send({ type: 'msg2', payload: {} });
      manager.send({ type: 'msg3', payload: {} });

      expect(manager.getQueueLength()).toBe(3);

      // Connect
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      // Queue should be flushed
      expect(manager.getQueueLength()).toBe(0);
      expect(MockWebSocket.sentMessages).toHaveLength(3);
    });

    test('preserves message order when flushing', () => {
      manager.send({ type: 'first', payload: {} });
      manager.send({ type: 'second', payload: {} });
      manager.send({ type: 'third', payload: {} });

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      expect(MockWebSocket.sentMessages[0].type).toBe('first');
      expect(MockWebSocket.sentMessages[1].type).toBe('second');
      expect(MockWebSocket.sentMessages[2].type).toBe('third');
    });
  });

  describe('Heartbeat', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('sends heartbeat at interval', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      // Clear initial messages
      MockWebSocket.sentMessages = [];

      // Advance time by heartbeat interval (30 seconds)
      jest.advanceTimersByTime(30000);

      expect(MockWebSocket.sentMessages.length).toBeGreaterThanOrEqual(1);
      const heartbeat = MockWebSocket.sentMessages.find(m => m.type === 'heartbeat');
      expect(heartbeat).toBeDefined();
    });

    test('stops heartbeat on disconnect', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      // Disconnect
      manager.disconnect();

      // Clear messages
      MockWebSocket.sentMessages = [];

      // Advance time
      jest.advanceTimersByTime(60000);

      // Should not have sent any heartbeats
      const heartbeats = MockWebSocket.sentMessages.filter(m => m.type === 'heartbeat');
      expect(heartbeats).toHaveLength(0);
    });
  });

  describe('Reconnection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('attempts reconnect on unexpected close', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      const initialInstanceCount = MockWebSocket.instances.length;

      // Simulate unexpected close
      MockWebSocket.lastInstance.simulateClose(1006, 'Abnormal close');

      // Advance time to trigger reconnect
      jest.advanceTimersByTime(5000);

      // Should have created a new connection
      expect(MockWebSocket.instances.length).toBeGreaterThan(initialInstanceCount);
    });

    test('does not reconnect on clean close', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      const initialInstanceCount = MockWebSocket.instances.length;

      // Clean disconnect
      manager.disconnect();

      // Advance time
      jest.advanceTimersByTime(10000);

      // Should not have created a new connection
      expect(MockWebSocket.instances.length).toBe(initialInstanceCount);
    });

    test('uses exponential backoff', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      // First failure
      MockWebSocket.lastInstance.simulateClose(1006);
      jest.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(2);

      // Second failure
      MockWebSocket.lastInstance.simulateClose(1006);
      jest.advanceTimersByTime(1000); // Not enough time
      expect(MockWebSocket.instances.length).toBe(2);

      jest.advanceTimersByTime(1000); // 2 seconds total
      expect(MockWebSocket.instances.length).toBe(3);
    });

    test('caps reconnect attempts', () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      // Simulate many failures
      for (let i = 0; i < 10; i++) {
        MockWebSocket.lastInstance.simulateClose(1006);
        jest.advanceTimersByTime(120000); // 2 minutes
      }

      // Should stop attempting after max retries
      expect(manager.getState()).toBe('disconnected');
    });
  });

  describe('Message Handling', () => {
    test('emits message event for incoming messages', (done) => {
      manager.on('message', (data) => {
        expect(data.type).toBe('test.response');
        expect(data.payload.result).toBe('success');
        done();
      });

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();
      MockWebSocket.lastInstance.simulateMessage({
        id: '123',
        type: 'test.response',
        timestamp: Date.now(),
        session_id: 'test-session',
        payload: { result: 'success' }
      });
    });

    test('handles heartbeat.ack silently', () => {
      const messageHandler = jest.fn();
      manager.on('message', messageHandler);

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();
      MockWebSocket.lastInstance.simulateMessage({
        id: '123',
        type: 'heartbeat.ack',
        timestamp: Date.now(),
        session_id: 'test-session',
        payload: {}
      });

      expect(messageHandler).not.toHaveBeenCalled();
    });

    test('resolves pending request on response', async () => {
      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      const responsePromise = manager.sendRequest({
        type: 'command.navigate',
        payload: { url: 'https://example.com' }
      });

      // Find the sent message to get its ID
      const sentMsg = MockWebSocket.sentMessages[0];

      // Simulate response
      MockWebSocket.lastInstance.simulateMessage({
        id: 'resp-123',
        type: 'command.navigate.result',
        timestamp: Date.now(),
        session_id: 'test-session',
        correlation_id: sentMsg.id,
        payload: { success: true }
      });

      const response = await responsePromise;
      expect(response.payload.success).toBe(true);
    });

    test('rejects pending request on timeout', async () => {
      jest.useFakeTimers();

      manager.connect('test-session');
      MockWebSocket.lastInstance.simulateOpen();

      const responsePromise = manager.sendRequest({
        type: 'command.navigate',
        payload: { url: 'https://example.com' }
      }, { timeout: 5000 });

      // Advance past timeout
      jest.advanceTimersByTime(6000);

      await expect(responsePromise).rejects.toThrow('timeout');

      jest.useRealTimers();
    });
  });

  describe('Session Management', () => {
    test('stores session ID after connect', () => {
      manager.connect('my-session-456');

      expect(manager.getSessionId()).toBe('my-session-456');
    });

    test('clears session ID on disconnect', () => {
      manager.connect('my-session-456');
      MockWebSocket.lastInstance.simulateOpen();
      manager.disconnect();

      expect(manager.getSessionId()).toBeNull();
    });

    test('reconnects with same session ID', () => {
      manager.connect('persistent-session');
      MockWebSocket.lastInstance.simulateOpen();
      MockWebSocket.lastInstance.simulateClose(1006);

      jest.useFakeTimers();
      jest.advanceTimersByTime(5000);
      jest.useRealTimers();

      // New connection should use same session ID
      expect(MockWebSocket.lastInstance.url).toContain('persistent-session');
    });
  });
});
