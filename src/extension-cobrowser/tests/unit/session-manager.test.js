/**
 * TDD Tests for Session Manager
 *
 * Tests the client-side session state tracking with control modes.
 */

let SessionManager;

beforeAll(() => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.join(__dirname, '../../background/session-manager.js'),
    'utf8'
  );
  eval(code);
  SessionManager = global.SessionManager;
});

describe('SessionManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe('Session Creation', () => {
    test('creates new session with generated ID', () => {
      const session = manager.createSession();

      expect(session.sessionId).toBeDefined();
      expect(session.sessionId.length).toBeGreaterThan(0);
    });

    test('creates session with provided ID', () => {
      const session = manager.createSession('custom-session-id');

      expect(session.sessionId).toBe('custom-session-id');
    });

    test('new session has CLAUDE as default control mode', () => {
      const session = manager.createSession();

      expect(session.controlMode).toBe('CLAUDE');
    });

    test('new session has empty state', () => {
      const session = manager.createSession();

      expect(session.state).toEqual({});
    });
  });

  describe('Control Modes', () => {
    test('gets current control mode', () => {
      const session = manager.createSession('test-session');

      expect(manager.getControlMode('test-session')).toBe('CLAUDE');
    });

    test('sets control mode to HUMAN', () => {
      const session = manager.createSession('test-session');
      manager.setControlMode('test-session', 'HUMAN');

      expect(manager.getControlMode('test-session')).toBe('HUMAN');
    });

    test('sets control mode to SHARED', () => {
      const session = manager.createSession('test-session');
      manager.setControlMode('test-session', 'SHARED');

      expect(manager.getControlMode('test-session')).toBe('SHARED');
    });

    test('rejects invalid control mode', () => {
      const session = manager.createSession('test-session');

      expect(() => {
        manager.setControlMode('test-session', 'INVALID');
      }).toThrow();
    });

    test('emits mode change event', (done) => {
      const session = manager.createSession('test-session');

      manager.on('modeChanged', (event) => {
        expect(event.sessionId).toBe('test-session');
        expect(event.previousMode).toBe('CLAUDE');
        expect(event.newMode).toBe('HUMAN');
        done();
      });

      manager.setControlMode('test-session', 'HUMAN');
    });
  });

  describe('Session State', () => {
    test('gets session state', () => {
      manager.createSession('test-session');
      manager.updateState('test-session', { url: 'https://example.com' });

      const state = manager.getState('test-session');
      expect(state.url).toBe('https://example.com');
    });

    test('updates session state', () => {
      manager.createSession('test-session');
      manager.updateState('test-session', { url: 'https://example.com' });
      manager.updateState('test-session', { title: 'Example' });

      const state = manager.getState('test-session');
      expect(state.url).toBe('https://example.com');
      expect(state.title).toBe('Example');
    });

    test('returns null for non-existent session', () => {
      expect(manager.getState('nonexistent')).toBeNull();
    });

    test('emits state change event', (done) => {
      manager.createSession('test-session');

      manager.on('stateChanged', (event) => {
        expect(event.sessionId).toBe('test-session');
        expect(event.changes.url).toBe('https://example.com');
        done();
      });

      manager.updateState('test-session', { url: 'https://example.com' });
    });
  });

  describe('Session Lifecycle', () => {
    test('gets session by ID', () => {
      manager.createSession('test-session');

      const session = manager.getSession('test-session');
      expect(session).not.toBeNull();
      expect(session.sessionId).toBe('test-session');
    });

    test('lists all sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-2');
      manager.createSession('session-3');

      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(3);
    });

    test('removes session', () => {
      manager.createSession('test-session');
      manager.removeSession('test-session');

      expect(manager.getSession('test-session')).toBeNull();
    });

    test('emits session removed event', (done) => {
      manager.createSession('test-session');

      manager.on('sessionRemoved', (event) => {
        expect(event.sessionId).toBe('test-session');
        done();
      });

      manager.removeSession('test-session');
    });
  });

  describe('Handoff Tracking', () => {
    test('tracks handoff request', () => {
      manager.createSession('test-session');
      manager.requestHandoff('test-session', {
        reason: 'captcha',
        message: 'Please solve the CAPTCHA'
      });

      const session = manager.getSession('test-session');
      expect(session.handoff).toBeDefined();
      expect(session.handoff.reason).toBe('captcha');
      expect(session.handoff.requestedAt).toBeDefined();
    });

    test('handoff changes mode to HUMAN', () => {
      manager.createSession('test-session');
      manager.requestHandoff('test-session', { reason: 'captcha' });

      expect(manager.getControlMode('test-session')).toBe('HUMAN');
    });

    test('clears handoff on resume', () => {
      manager.createSession('test-session');
      manager.requestHandoff('test-session', { reason: 'captcha' });
      manager.resumeAutomation('test-session');

      const session = manager.getSession('test-session');
      expect(session.handoff).toBeNull();
    });

    test('resume changes mode to CLAUDE', () => {
      manager.createSession('test-session');
      manager.requestHandoff('test-session', { reason: 'captcha' });
      manager.resumeAutomation('test-session');

      expect(manager.getControlMode('test-session')).toBe('CLAUDE');
    });

    test('emits handoff request event', (done) => {
      manager.createSession('test-session');

      manager.on('handoffRequested', (event) => {
        expect(event.sessionId).toBe('test-session');
        expect(event.reason).toBe('login');
        done();
      });

      manager.requestHandoff('test-session', { reason: 'login' });
    });

    test('emits handoff completed event on resume', (done) => {
      manager.createSession('test-session');
      manager.requestHandoff('test-session', { reason: 'login' });

      manager.on('handoffCompleted', (event) => {
        expect(event.sessionId).toBe('test-session');
        done();
      });

      manager.resumeAutomation('test-session');
    });
  });

  describe('Storage Persistence', () => {
    test('saves session to storage', async () => {
      manager.createSession('test-session');
      await manager.saveToStorage();

      expect(browser.storage.local.set).toHaveBeenCalled();
    });

    test('loads sessions from storage', async () => {
      browser.storage.local.get.mockResolvedValueOnce({
        cobrowser_sessions: {
          'stored-session': {
            sessionId: 'stored-session',
            controlMode: 'HUMAN',
            state: { url: 'https://example.com' }
          }
        }
      });

      await manager.loadFromStorage();

      const session = manager.getSession('stored-session');
      expect(session).not.toBeNull();
      expect(session.controlMode).toBe('HUMAN');
    });
  });

  describe('Active Tab Tracking', () => {
    test('associates session with tab', () => {
      manager.createSession('test-session');
      manager.setActiveTab('test-session', 123);

      expect(manager.getActiveTab('test-session')).toBe(123);
    });

    test('gets session for tab', () => {
      manager.createSession('session-a');
      manager.createSession('session-b');
      manager.setActiveTab('session-a', 100);
      manager.setActiveTab('session-b', 200);

      expect(manager.getSessionForTab(100)).toBe('session-a');
      expect(manager.getSessionForTab(200)).toBe('session-b');
    });

    test('returns null for untracked tab', () => {
      expect(manager.getSessionForTab(999)).toBeNull();
    });
  });
});
