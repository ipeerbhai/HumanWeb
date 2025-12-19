/**
 * TDD Tests for Message Router
 *
 * Tests message routing and handoff protocol handling.
 */

let MessageRouter;
let SessionManager;
let WebSocketManager;

beforeAll(() => {
  const fs = require('fs');
  const path = require('path');

  // Load dependencies
  const sessionCode = fs.readFileSync(
    path.join(__dirname, '../../background/session-manager.js'),
    'utf8'
  );
  eval(sessionCode);
  SessionManager = global.SessionManager;

  const wsCode = fs.readFileSync(
    path.join(__dirname, '../../background/websocket-manager.js'),
    'utf8'
  );
  eval(wsCode);
  WebSocketManager = global.WebSocketManager;

  // Load module under test
  const code = fs.readFileSync(
    path.join(__dirname, '../../background/message-router.js'),
    'utf8'
  );
  eval(code);
  MessageRouter = global.MessageRouter;
});

describe('MessageRouter', () => {
  let router;
  let sessionManager;
  let wsManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    wsManager = new WebSocketManager('ws://localhost:8677');
    router = new MessageRouter(sessionManager, wsManager);
  });

  describe('Message Routing', () => {
    test('routes command messages to handler', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true });
      router.registerHandler('command.navigate', handler);

      const message = {
        id: 'msg-1',
        type: 'command.navigate',
        session_id: 'session-1',
        payload: { url: 'https://example.com' }
      };

      await router.route(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    test('routes to wildcard handlers', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true });
      router.registerHandler('command.*', handler);

      const message = {
        id: 'msg-1',
        type: 'command.click',
        session_id: 'session-1',
        payload: {}
      };

      await router.route(message);

      expect(handler).toHaveBeenCalled();
    });

    test('returns error for unknown message type', async () => {
      const result = await router.route({
        id: 'msg-1',
        type: 'unknown.type',
        session_id: 'session-1',
        payload: {}
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No handler');
    });

    test('sends response back through WebSocket', async () => {
      sessionManager.createSession('session-1');
      wsManager.send = jest.fn();

      router.registerHandler('command.test', async () => ({
        success: true,
        data: 'result'
      }));

      await router.route({
        id: 'msg-1',
        type: 'command.test',
        session_id: 'session-1',
        payload: {}
      });

      expect(wsManager.send).toHaveBeenCalled();
      const response = wsManager.send.mock.calls[0][0];
      expect(response.type).toBe('command.test.result');
      expect(response.correlation_id).toBe('msg-1');
    });
  });

  describe('Handoff Request', () => {
    beforeEach(() => {
      sessionManager.createSession('session-1');
    });

    test('handles handoff.request message', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.request',
        session_id: 'session-1',
        payload: {
          reason: 'captcha',
          message: 'Please solve the CAPTCHA'
        }
      };

      const result = await router.route(message);

      expect(result.success).toBe(true);
    });

    test('changes control mode to HUMAN on handoff', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.request',
        session_id: 'session-1',
        payload: { reason: 'login' }
      };

      await router.route(message);

      expect(sessionManager.getControlMode('session-1')).toBe('HUMAN');
    });

    test('stores handoff reason in session', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.request',
        session_id: 'session-1',
        payload: {
          reason: 'sensitive_page',
          message: 'Banking site detected'
        }
      };

      await router.route(message);

      const session = sessionManager.getSession('session-1');
      expect(session.handoff).toBeDefined();
      expect(session.handoff.reason).toBe('sensitive_page');
    });

    test('emits handoff event', async () => {
      const handoffHandler = jest.fn();
      router.on('handoff', handoffHandler);

      const message = {
        id: 'msg-1',
        type: 'handoff.request',
        session_id: 'session-1',
        payload: { reason: 'captcha' }
      };

      await router.route(message);

      expect(handoffHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          reason: 'captcha'
        })
      );
    });

    test('handles handoff with timeout', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.request',
        session_id: 'session-1',
        payload: {
          reason: 'captcha',
          timeout: 60000
        }
      };

      await router.route(message);

      const session = sessionManager.getSession('session-1');
      expect(session.handoff.timeout).toBe(60000);
    });
  });

  describe('Handoff Complete', () => {
    beforeEach(() => {
      sessionManager.createSession('session-1');
      sessionManager.requestHandoff('session-1', { reason: 'captcha' });
    });

    test('handles handoff.complete message', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.complete',
        session_id: 'session-1',
        payload: {}
      };

      const result = await router.route(message);

      expect(result.success).toBe(true);
    });

    test('changes control mode back to CLAUDE', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.complete',
        session_id: 'session-1',
        payload: {}
      };

      await router.route(message);

      expect(sessionManager.getControlMode('session-1')).toBe('CLAUDE');
    });

    test('clears handoff state', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.complete',
        session_id: 'session-1',
        payload: {}
      };

      await router.route(message);

      const session = sessionManager.getSession('session-1');
      expect(session.handoff).toBeNull();
    });

    test('emits resume event', async () => {
      const resumeHandler = jest.fn();
      router.on('resume', resumeHandler);

      const message = {
        id: 'msg-1',
        type: 'handoff.complete',
        session_id: 'session-1',
        payload: {}
      };

      await router.route(message);

      expect(resumeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1'
        })
      );
    });
  });

  describe('State Messages', () => {
    beforeEach(() => {
      sessionManager.createSession('session-1');
    });

    test('handles state.get request', async () => {
      wsManager.send = jest.fn();

      const message = {
        id: 'msg-1',
        type: 'state.get',
        session_id: 'session-1',
        payload: {}
      };

      await router.route(message);

      expect(wsManager.send).toHaveBeenCalled();
      const response = wsManager.send.mock.calls[0][0];
      expect(response.payload.controlMode).toBeDefined();
    });

    test('handles state.update message', async () => {
      const message = {
        id: 'msg-1',
        type: 'state.update',
        session_id: 'session-1',
        payload: {
          currentUrl: 'https://example.com',
          title: 'Example'
        }
      };

      await router.route(message);

      const state = sessionManager.getState('session-1');
      expect(state.currentUrl).toBe('https://example.com');
    });
  });

  describe('Control Mode Messages', () => {
    beforeEach(() => {
      sessionManager.createSession('session-1');
    });

    test('handles mode.set message', async () => {
      const message = {
        id: 'msg-1',
        type: 'mode.set',
        session_id: 'session-1',
        payload: { mode: 'SHARED' }
      };

      await router.route(message);

      expect(sessionManager.getControlMode('session-1')).toBe('SHARED');
    });

    test('rejects invalid mode', async () => {
      const message = {
        id: 'msg-1',
        type: 'mode.set',
        session_id: 'session-1',
        payload: { mode: 'INVALID' }
      };

      const result = await router.route(message);

      expect(result.success).toBe(false);
    });
  });

  describe('Emergency Handoff', () => {
    beforeEach(() => {
      sessionManager.createSession('session-1');
    });

    test('handles emergency handoff for CAPTCHA', async () => {
      const message = {
        id: 'msg-1',
        type: 'handoff.emergency',
        session_id: 'session-1',
        payload: {
          reason: 'captcha_detected',
          captchaType: 'recaptcha'
        }
      };

      await router.route(message);

      expect(sessionManager.getControlMode('session-1')).toBe('HUMAN');
      const session = sessionManager.getSession('session-1');
      expect(session.handoff.reason).toBe('captcha_detected');
    });

    test('emits emergency event', async () => {
      const emergencyHandler = jest.fn();
      router.on('emergency', emergencyHandler);

      const message = {
        id: 'msg-1',
        type: 'handoff.emergency',
        session_id: 'session-1',
        payload: { reason: 'captcha_detected' }
      };

      await router.route(message);

      expect(emergencyHandler).toHaveBeenCalled();
    });
  });

  describe('Content Script Communication', () => {
    test('forwards commands to content script', async () => {
      sessionManager.createSession('session-1');
      sessionManager.setActiveTab('session-1', 123);

      browser.tabs.sendMessage = jest.fn().mockResolvedValue({ success: true });

      router.registerHandler('command.click', async (msg) => {
        return router.forwardToContentScript(msg);
      });

      const message = {
        id: 'msg-1',
        type: 'command.click',
        session_id: 'session-1',
        payload: { selector: '#btn' }
      };

      await router.route(message);

      expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: 'command.click',
          payload: { selector: '#btn' }
        })
      );
    });

    test('returns error if no active tab', async () => {
      sessionManager.createSession('session-1');
      // No active tab set

      const result = await router.forwardToContentScript({
        id: 'msg-1',
        type: 'command.click',
        session_id: 'session-1',
        payload: {}
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active tab');
    });
  });
});
