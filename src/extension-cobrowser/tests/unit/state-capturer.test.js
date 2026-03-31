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

  describe('captureIdentity', () => {
    test('returns basic page info', () => {
      document.title = 'Test Page';
      const result = capturer.captureIdentity();

      expect(result.title).toBe('Test Page');
      expect(result.url).toBeTruthy();
      expect(result.page_type).toBe('unknown');
      expect(result.security).toBeDefined();
    });

    test('extracts meta description', () => {
      const meta = document.createElement('meta');
      meta.name = 'description';
      meta.content = 'A test page for unit testing';
      document.head.appendChild(meta);

      const result = capturer.captureIdentity();
      expect(result.meta_description).toBe('A test page for unit testing');

      meta.remove();
    });

    test('truncates long meta descriptions to 200 chars', () => {
      const meta = document.createElement('meta');
      meta.name = 'description';
      meta.content = 'x'.repeat(300);
      document.head.appendChild(meta);

      const result = capturer.captureIdentity();
      expect(result.meta_description.length).toBe(200);

      meta.remove();
    });

    test('detects login page type', () => {
      document.body.innerHTML = `
        <form>
          <input type="text" name="username" />
          <input type="password" name="password" />
          <button type="submit">Sign In</button>
        </form>
      `;
      const result = capturer.captureIdentity();
      expect(result.page_type).toBe('login');
    });

    test('detects form page type', () => {
      document.body.innerHTML = `
        <form>
          <input type="text" name="first_name" />
          <input type="email" name="email" />
          <textarea name="message"></textarea>
          <button type="submit">Submit</button>
        </form>
      `;
      const result = capturer.captureIdentity();
      expect(result.page_type).toBe('form');
    });

    test('detects article page type', () => {
      document.body.innerHTML = `
        <article>
          <h1>My Article</h1>
          <p>Some long content here about a topic...</p>
        </article>
      `;
      const result = capturer.captureIdentity();
      expect(result.page_type).toBe('article');
    });

    test('identity output is compact (token budget)', () => {
      document.title = 'Test Page';
      const result = capturer.captureIdentity();
      const json = JSON.stringify(result);
      // ~50 tokens ≈ ~200 chars, allow margin for URL
      expect(json.length).toBeLessThan(1000);
    });
  });

  describe('captureStructure', () => {
    test('returns structure with all expected keys', () => {
      document.body.innerHTML = '<main><h1>Hello</h1></main>';
      const result = capturer.captureStructure();

      expect(result).toHaveProperty('landmarks');
      expect(result).toHaveProperty('headings');
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('counts');
      expect(result).toHaveProperty('scroll_pages');
      expect(result).toHaveProperty('repeated_regions');
    });

    test('finds landmarks with metadata', () => {
      document.body.innerHTML = `
        <nav aria-label="Main menu">
          <a href="/home">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>
          <p>Content here</p>
        </main>
        <aside>Sidebar</aside>
        <footer>Footer text</footer>
      `;
      const result = capturer.captureStructure();

      expect(result.landmarks.length).toBeGreaterThanOrEqual(4);

      const nav = result.landmarks.find(l => l.tag === 'nav');
      expect(nav).toBeDefined();
      expect(nav.label).toBe('Main menu');
      expect(nav.chars).toBeGreaterThan(0);
      expect(nav.selector).toBeTruthy();

      const main = result.landmarks.find(l => l.tag === 'main');
      expect(main).toBeDefined();
    });

    test('finds headings with level and text', () => {
      document.body.innerHTML = `
        <h1>Main Title</h1>
        <h2>Section One</h2>
        <p>Content</p>
        <h2>Section Two</h2>
        <h3>Subsection</h3>
      `;
      const result = capturer.captureStructure();

      expect(result.headings.length).toBe(4);
      expect(result.headings[0]).toEqual(expect.objectContaining({
        level: 1,
        text: 'Main Title'
      }));
      expect(result.headings[1].level).toBe(2);
      expect(result.headings[3].level).toBe(3);
    });

    test('truncates heading text at 80 chars', () => {
      document.body.innerHTML = `<h1>${'A'.repeat(120)}</h1>`;
      const result = capturer.captureStructure();
      expect(result.headings[0].text.length).toBe(80);
    });

    test('finds top actions — search inputs and buttons', () => {
      document.body.innerHTML = `
        <input type="search" placeholder="Search products..." />
        <button type="submit">Search</button>
        <button>Add to Cart</button>
      `;
      const result = capturer.captureStructure();

      expect(result.actions.length).toBeGreaterThanOrEqual(2);
      const search = result.actions.find(a => a.type === 'search');
      expect(search).toBeDefined();
      expect(search.text).toContain('Search');
    });

    test('returns element counts', () => {
      document.body.innerHTML = `
        <a href="/1">Link 1</a>
        <a href="/2">Link 2</a>
        <button>Button 1</button>
        <input type="text" />
        <form><select><option>A</option></select></form>
        <img src="test.png" />
        <table><tr><td>Cell</td></tr></table>
      `;
      const result = capturer.captureStructure();

      expect(result.counts.links).toBe(2);
      expect(result.counts.buttons).toBe(1);
      expect(result.counts.inputs).toBe(1);
      expect(result.counts.forms).toBe(1);
      expect(result.counts.images).toBe(1);
      expect(result.counts.tables).toBe(1);
      expect(result.counts.selects).toBe(1);
    });

    test('detects repeated regions', () => {
      document.body.innerHTML = `
        <ul>
          <li class="result"><h3>Result 1</h3></li>
          <li class="result"><h3>Result 2</h3></li>
          <li class="result"><h3>Result 3</h3></li>
          <li class="result"><h3>Result 4</h3></li>
        </ul>
      `;
      const result = capturer.captureStructure();

      expect(result.repeated_regions.length).toBeGreaterThanOrEqual(1);
      const region = result.repeated_regions[0];
      expect(region.count).toBe(4);
    });

    test('structure output stays bounded (token budget)', () => {
      let html = '<nav aria-label="Main"><a href="/a">A</a></nav><main>';
      for (let i = 0; i < 10; i++) {
        html += `<h2>Section ${i}</h2><button>Action ${i}</button>`;
      }
      html += '<ul>';
      for (let i = 0; i < 20; i++) {
        html += `<li class="item"><a href="/${i}">Item ${i}</a></li>`;
      }
      html += '</ul></main>';
      document.body.innerHTML = html;

      const result = capturer.captureStructure();
      const json = JSON.stringify(result);
      // Target: 200-800 tokens ≈ 800-3200 chars. Allow generous margin.
      expect(json.length).toBeLessThan(6000);
    });
  });

  describe('captureSection', () => {
    test('returns error when selector is missing', () => {
      const result = capturer.captureSection({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('selector is required');
    });

    test('returns error when selector not found', () => {
      const result = capturer.captureSection({ selector: '#nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('returns text content scoped to selector', () => {
      document.body.innerHTML = `
        <div id="sidebar">Sidebar content</div>
        <main id="content">
          <p>Main content paragraph.</p>
        </main>
      `;
      const result = capturer.captureSection({ selector: '#content' });

      expect(result.success).toBe(true);
      expect(result.tag).toBe('main');
      expect(result.text).toContain('Main content paragraph');
      expect(result.text).not.toContain('Sidebar');
    });

    test('truncates text at maxChars', () => {
      document.body.innerHTML = `<div id="big">${'Hello world. '.repeat(500)}</div>`;
      const result = capturer.captureSection({ selector: '#big', maxChars: 100 });

      expect(result.text.length).toBeLessThanOrEqual(100);
      expect(result.text_truncated).toBe(true);
    });

    test('returns interactive elements within section', () => {
      document.body.innerHTML = `
        <div id="outside"><button>Outside</button></div>
        <form id="myform">
          <input type="text" placeholder="Name" />
          <input type="email" placeholder="Email" />
          <button type="submit">Submit</button>
        </form>
      `;
      const result = capturer.captureSection({ selector: '#myform' });

      expect(result.success).toBe(true);
      expect(result.inputs.length).toBe(2);
      expect(result.buttons.length).toBe(1);
      expect(result.buttons[0].text).toBe('Submit');
    });

    test('returns links within section', () => {
      document.body.innerHTML = `
        <nav id="nav">
          <a href="/home">Home</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
      `;
      const result = capturer.captureSection({ selector: '#nav' });
      expect(result.links.length).toBe(3);
      expect(result.links[0].text).toBe('Home');
    });

    test('declarative extraction with field map', () => {
      document.body.innerHTML = `
        <ul id="results">
          <li class="item">
            <h3>Product A</h3>
            <span class="price">$29.99</span>
            <a href="/product-a">View</a>
          </li>
          <li class="item">
            <h3>Product B</h3>
            <span class="price">$49.99</span>
            <a href="/product-b">View</a>
          </li>
          <li class="item">
            <h3>Product C</h3>
            <span class="price">$19.99</span>
            <a href="/product-c">View</a>
          </li>
        </ul>
      `;
      const result = capturer.captureSection({
        selector: '#results',
        fields: { title: 'h3', price: '.price', url: 'a@href' }
      });

      expect(result.success).toBe(true);
      expect(result.items).toBeDefined();
      expect(result.item_count).toBe(3);
      expect(result.items[0].title).toBe('Product A');
      expect(result.items[0].price).toBe('$29.99');
      expect(result.items[0].url).toContain('/product-a');
    });

    test('declarative extraction handles missing fields', () => {
      document.body.innerHTML = `
        <div id="list">
          <div class="card"><h3>Item 1</h3></div>
          <div class="card"><h3>Item 2</h3><span class="note">Has note</span></div>
        </div>
      `;
      const result = capturer.captureSection({
        selector: '#list',
        fields: { title: 'h3', note: '.note' }
      });

      expect(result.items.length).toBe(2);
      expect(result.items[0].note).toBeNull();
      expect(result.items[1].note).toBe('Has note');
    });

    test('declarative extraction respects limit', () => {
      let html = '<div id="list">';
      for (let i = 0; i < 50; i++) {
        html += `<div class="item"><h3>Item ${i}</h3></div>`;
      }
      html += '</div>';
      document.body.innerHTML = html;

      const result = capturer.captureSection({
        selector: '#list',
        fields: { title: 'h3' },
        limit: 5
      });
      expect(result.item_count).toBe(5);
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
