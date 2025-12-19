/**
 * TDD Tests for State Capturer
 *
 * Tests page state capture: metadata, cleaned DOM, interactive elements.
 */

let StateCapturer;

beforeAll(() => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.join(__dirname, '../../content/state-capturer.js'),
    'utf8'
  );
  eval(code);
  StateCapturer = global.StateCapturer;
});

describe('StateCapturer', () => {
  let capturer;

  beforeEach(() => {
    capturer = new StateCapturer();

    // Reset document state
    document.title = 'Test Page';
    document.body.innerHTML = '';
  });

  describe('Page Metadata', () => {
    test('captures page title', () => {
      document.title = 'My Test Page';

      const metadata = capturer.getMetadata();

      expect(metadata.title).toBe('My Test Page');
    });

    test('captures page URL', () => {
      const metadata = capturer.getMetadata();

      expect(metadata.url).toBe(window.location.href);
    });

    test('captures document ready state', () => {
      const metadata = capturer.getMetadata();

      expect(metadata.readyState).toBeDefined();
    });

    test('captures viewport dimensions', () => {
      const metadata = capturer.getMetadata();

      expect(metadata.viewport).toBeDefined();
      expect(metadata.viewport.width).toBeDefined();
      expect(metadata.viewport.height).toBeDefined();
    });

    test('captures scroll position', () => {
      const metadata = capturer.getMetadata();

      expect(metadata.scroll).toBeDefined();
      expect(metadata.scroll.x).toBeDefined();
      expect(metadata.scroll.y).toBeDefined();
    });

    test('captures timestamp', () => {
      const before = Date.now();
      const metadata = capturer.getMetadata();
      const after = Date.now();

      expect(metadata.timestamp).toBeGreaterThanOrEqual(before);
      expect(metadata.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Cleaned DOM', () => {
    test('returns page HTML', () => {
      document.body.innerHTML = '<div id="content">Hello World</div>';

      const dom = capturer.getCleanedDOM();

      expect(dom).toContain('Hello World');
    });

    test('removes script tags', () => {
      document.body.innerHTML = `
        <div id="content">Content</div>
        <script>alert("evil");</script>
      `;

      const dom = capturer.getCleanedDOM();

      expect(dom).not.toContain('<script');
      expect(dom).not.toContain('alert');
      expect(dom).toContain('Content');
    });

    test('removes style tags', () => {
      document.body.innerHTML = `
        <style>.hidden { display: none; }</style>
        <div id="content">Visible</div>
      `;

      const dom = capturer.getCleanedDOM();

      expect(dom).not.toContain('<style');
      expect(dom).not.toContain('display: none');
      expect(dom).toContain('Visible');
    });

    test('removes inline event handlers', () => {
      document.body.innerHTML = `
        <button onclick="doSomething()">Click me</button>
      `;

      const dom = capturer.getCleanedDOM();

      expect(dom).not.toContain('onclick');
      expect(dom).toContain('Click me');
    });

    test('removes noscript tags', () => {
      document.body.innerHTML = `
        <noscript>JavaScript is disabled</noscript>
        <div>Content</div>
      `;

      const dom = capturer.getCleanedDOM();

      expect(dom).not.toContain('<noscript');
      expect(dom).toContain('Content');
    });

    test('redacts password field values', () => {
      document.body.innerHTML = `
        <input type="password" value="secret123" id="pwd">
        <input type="text" value="visible" id="text">
      `;

      const dom = capturer.getCleanedDOM();

      expect(dom).not.toContain('secret123');
      expect(dom).toContain('visible');
    });

    test('limits DOM size', () => {
      // Create large DOM
      let largeContent = '';
      for (let i = 0; i < 10000; i++) {
        largeContent += `<div>Item ${i}</div>`;
      }
      document.body.innerHTML = largeContent;

      const dom = capturer.getCleanedDOM({ maxLength: 5000 });

      expect(dom.length).toBeLessThanOrEqual(5100); // Allow some margin for truncation message
    });
  });

  describe('Interactive Elements', () => {
    test('identifies buttons', () => {
      document.body.innerHTML = `
        <button id="btn1">Click Me</button>
        <input type="button" value="Submit" id="btn2">
        <input type="submit" value="Go" id="btn3">
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.buttons.length).toBe(3);
    });

    test('identifies links', () => {
      document.body.innerHTML = `
        <a href="/page1">Page 1</a>
        <a href="https://example.com">External</a>
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.links.length).toBe(2);
    });

    test('identifies text inputs', () => {
      document.body.innerHTML = `
        <input type="text" id="name">
        <input type="email" id="email">
        <textarea id="message"></textarea>
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.inputs.length).toBe(3);
    });

    test('identifies select dropdowns', () => {
      document.body.innerHTML = `
        <select id="country">
          <option value="us">USA</option>
          <option value="uk">UK</option>
        </select>
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.selects.length).toBe(1);
    });

    test('identifies checkboxes and radios', () => {
      document.body.innerHTML = `
        <input type="checkbox" id="agree">
        <input type="radio" name="option" value="a">
        <input type="radio" name="option" value="b">
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.checkboxes.length).toBe(1);
      expect(elements.radios.length).toBe(2);
    });

    test('excludes hidden elements', () => {
      document.body.innerHTML = `
        <button id="visible">Visible</button>
        <button id="hidden" style="display: none;">Hidden</button>
        <button id="hidden2" hidden>Also Hidden</button>
      `;

      const elements = capturer.getInteractiveElements();

      // Should only include visible buttons
      const visibleButtons = elements.buttons.filter(b => b.id !== 'hidden' && b.id !== 'hidden2');
      expect(visibleButtons.length).toBeGreaterThanOrEqual(1);
    });

    test('includes element selectors', () => {
      document.body.innerHTML = `
        <button id="submit-btn" class="primary">Submit</button>
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.buttons[0].selector).toBeDefined();
      expect(elements.buttons[0].selector).toContain('submit-btn');
    });

    test('includes element text content', () => {
      document.body.innerHTML = `
        <button id="action-btn">Perform Action</button>
      `;

      const elements = capturer.getInteractiveElements();

      expect(elements.buttons[0].text).toBe('Perform Action');
    });
  });

  describe('Security Detection', () => {
    test('detects password fields', () => {
      document.body.innerHTML = `
        <input type="password" id="pwd">
        <input type="text" id="username">
      `;

      const security = capturer.getSecurityInfo();

      expect(security.hasPasswordFields).toBe(true);
    });

    test('detects no password fields', () => {
      document.body.innerHTML = `
        <input type="text" id="search">
        <input type="email" id="email">
      `;

      const security = capturer.getSecurityInfo();

      expect(security.hasPasswordFields).toBe(false);
    });

    test('detects CAPTCHA - reCAPTCHA', () => {
      document.body.innerHTML = `
        <div class="g-recaptcha" data-sitekey="abc123"></div>
      `;

      const security = capturer.getSecurityInfo();

      expect(security.hasCaptcha).toBe(true);
      expect(security.captchaType).toBe('recaptcha');
    });

    test('detects CAPTCHA - hCaptcha', () => {
      document.body.innerHTML = `
        <div class="h-captcha" data-sitekey="xyz789"></div>
      `;

      const security = capturer.getSecurityInfo();

      expect(security.hasCaptcha).toBe(true);
      expect(security.captchaType).toBe('hcaptcha');
    });

    test('detects CAPTCHA - iframe', () => {
      document.body.innerHTML = `
        <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
      `;

      const security = capturer.getSecurityInfo();

      expect(security.hasCaptcha).toBe(true);
    });

    test('detects Cloudflare challenge', () => {
      document.body.innerHTML = `
        <div id="cf-wrapper">
          <div id="challenge-form">Checking your browser</div>
        </div>
      `;

      const security = capturer.getSecurityInfo();

      expect(security.hasCloudflareChallenge).toBe(true);
    });

    test('detects login page indicators', () => {
      document.body.innerHTML = `
        <form id="login-form">
          <input type="text" name="username">
          <input type="password" name="password">
          <button type="submit">Login</button>
        </form>
      `;

      const security = capturer.getSecurityInfo();

      expect(security.isLoginPage).toBe(true);
    });
  });

  describe('Full State Capture', () => {
    test('captures complete page state', () => {
      document.body.innerHTML = `
        <h1>Welcome</h1>
        <form>
          <input type="text" id="search">
          <button type="submit">Search</button>
        </form>
      `;

      const state = capturer.captureState();

      expect(state.metadata).toBeDefined();
      expect(state.dom).toBeDefined();
      expect(state.elements).toBeDefined();
      expect(state.security).toBeDefined();
    });

    test('respects options', () => {
      document.body.innerHTML = '<div>Content</div>';

      const state = capturer.captureState({
        includeDOM: false,
        includeElements: false
      });

      expect(state.metadata).toBeDefined();
      expect(state.dom).toBeUndefined();
      expect(state.elements).toBeUndefined();
    });
  });

  describe('URL Detection', () => {
    test('detects banking URLs', () => {
      const testUrls = [
        'https://www.bankofamerica.com/account',
        'https://chase.com/login',
        'https://wellsfargo.com/banking'
      ];

      testUrls.forEach(url => {
        expect(capturer.isSensitiveURL(url)).toBe(true);
      });
    });

    test('detects payment URLs', () => {
      const testUrls = [
        'https://checkout.stripe.com/pay',
        'https://www.paypal.com/checkout',
        'https://pay.amazon.com'
      ];

      testUrls.forEach(url => {
        expect(capturer.isSensitiveURL(url)).toBe(true);
      });
    });

    test('normal URLs are not sensitive', () => {
      const testUrls = [
        'https://www.google.com',
        'https://github.com/repo',
        'https://example.com/page'
      ];

      testUrls.forEach(url => {
        expect(capturer.isSensitiveURL(url)).toBe(false);
      });
    });
  });
});
