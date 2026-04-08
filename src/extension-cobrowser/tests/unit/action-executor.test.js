/**
 * TDD Tests for Action Executor
 *
 * Tests content script actions: click, type, scroll, read.
 */

let ActionExecutor;

beforeAll(() => {
  const fs = require('fs');
  const path = require('path');
  const xpathUtilsCode = fs.readFileSync(
    path.join(__dirname, '../../content/xpath-utils.js'),
    'utf8'
  );
  eval(xpathUtilsCode);
  const code = fs.readFileSync(
    path.join(__dirname, '../../content/action-executor.js'),
    'utf8'
  );
  eval(code);
  ActionExecutor = global.ActionExecutor;
});

// Mock DOM elements
function createMockElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  // Set content - innerHTML overrides textContent, so only set one
  if (options.innerHTML) {
    element.innerHTML = options.innerHTML;
  } else if (options.textContent) {
    element.textContent = options.textContent;
  }

  element.value = options.value || '';

  if (options.type) element.type = options.type;
  if (options.id) element.id = options.id;
  if (options.className) element.className = options.className;

  // Mock methods
  element.click = jest.fn();
  element.focus = jest.fn();
  element.scrollIntoView = jest.fn();
  element.getBoundingClientRect = jest.fn(() => ({
    top: options.top || 100,
    left: options.left || 100,
    width: options.width || 100,
    height: options.height || 50,
    bottom: (options.top || 100) + (options.height || 50),
    right: (options.left || 100) + (options.width || 100)
  }));

  return element;
}

describe('ActionExecutor', () => {
  let executor;
  let container;

  beforeEach(() => {
    executor = new ActionExecutor();

    // Create test container in DOM
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Click Actions', () => {
    test('clicks element by CSS selector', async () => {
      const button = createMockElement('button', { id: 'submit-btn' });
      container.appendChild(button);

      const result = await executor.click({ selector: '#submit-btn' });

      expect(result.success).toBe(true);
      expect(button.click).toHaveBeenCalled();
    });

    test('clicks element by XPath', async () => {
      const button = createMockElement('button', { id: 'xpath-btn' });
      container.appendChild(button);

      const result = await executor.click({
        xpath: '//button[@id="xpath-btn"]'
      });

      expect(result.success).toBe(true);
      expect(button.click).toHaveBeenCalled();
    });

    test('clicks at coordinates', async () => {
      const mockDispatchEvent = jest.fn();
      document.elementFromPoint = jest.fn(() => {
        const el = createMockElement('div');
        el.dispatchEvent = mockDispatchEvent;
        return el;
      });

      const result = await executor.click({ x: 150, y: 200 });

      expect(result.success).toBe(true);
      expect(document.elementFromPoint).toHaveBeenCalledWith(150, 200);
      // Coordinate-based clicks use synthetic MouseEvents (not element.click())
      // This is intentional for precision clicking on canvas elements
      expect(mockDispatchEvent).toHaveBeenCalled();
      // Verify click event was dispatched
      const clickCall = mockDispatchEvent.mock.calls.find(call => call[0].type === 'click');
      expect(clickCall).toBeTruthy();
    });

    test('rejects click on password field', async () => {
      const passwordInput = createMockElement('input', {
        type: 'password',
        id: 'password-field'
      });
      container.appendChild(passwordInput);

      const result = await executor.click({ selector: '#password-field' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('password');
      expect(passwordInput.click).not.toHaveBeenCalled();
    });

    test('scrolls element into view before click', async () => {
      const button = createMockElement('button', { id: 'offscreen-btn' });
      container.appendChild(button);

      await executor.click({ selector: '#offscreen-btn' });

      expect(button.scrollIntoView).toHaveBeenCalled();
    });

    test('returns error for non-existent element', async () => {
      const result = await executor.click({ selector: '#nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('highlights element before click when option set', async () => {
      const button = createMockElement('button', { id: 'highlight-btn' });
      container.appendChild(button);

      await executor.click({
        selector: '#highlight-btn',
        highlight: true
      });

      // Check that highlight was applied (via data attribute or class)
      expect(button.dataset.cobrowserHighlight || button.classList.contains('cobrowser-highlight')).toBeTruthy();
    });
  });

  describe('Type Actions', () => {
    test('types text into input', async () => {
      const input = createMockElement('input', { type: 'text', id: 'text-input' });
      container.appendChild(input);

      const result = await executor.type({
        selector: '#text-input',
        text: 'Hello World'
      });

      expect(result.success).toBe(true);
      expect(input.value).toBe('Hello World');
    });

    test('types text into textarea', async () => {
      const textarea = createMockElement('textarea', { id: 'message-area' });
      container.appendChild(textarea);

      const result = await executor.type({
        selector: '#message-area',
        text: 'Multi-line\ntext content'
      });

      expect(result.success).toBe(true);
      expect(textarea.value).toBe('Multi-line\ntext content');
    });

    test('clears field first if option set', async () => {
      const input = createMockElement('input', {
        type: 'text',
        id: 'prefilled-input',
        value: 'existing value'
      });
      container.appendChild(input);

      await executor.type({
        selector: '#prefilled-input',
        text: 'New value',
        clear: true
      });

      expect(input.value).toBe('New value');
    });

    test('appends to existing value by default', async () => {
      const input = createMockElement('input', {
        type: 'text',
        id: 'append-input'
      });
      input.value = 'existing ';
      container.appendChild(input);

      await executor.type({
        selector: '#append-input',
        text: 'appended'
      });

      expect(input.value).toBe('existing appended');
    });

    test('rejects typing into password field', async () => {
      const passwordInput = createMockElement('input', {
        type: 'password',
        id: 'password-input'
      });
      container.appendChild(passwordInput);

      const result = await executor.type({
        selector: '#password-input',
        text: 'secret123'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('password');
      expect(passwordInput.value).toBe('');
    });

    test('fires input events', async () => {
      const input = createMockElement('input', { type: 'text', id: 'event-input' });
      container.appendChild(input);

      const inputHandler = jest.fn();
      const changeHandler = jest.fn();
      input.addEventListener('input', inputHandler);
      input.addEventListener('change', changeHandler);

      await executor.type({
        selector: '#event-input',
        text: 'Test'
      });

      expect(inputHandler).toHaveBeenCalled();
    });

    test('focuses element before typing', async () => {
      const input = createMockElement('input', { type: 'text', id: 'focus-input' });
      container.appendChild(input);

      await executor.type({
        selector: '#focus-input',
        text: 'Text'
      });

      expect(input.focus).toHaveBeenCalled();
    });
  });

  describe('Scroll Actions', () => {
    beforeEach(() => {
      // Mock window scroll
      window.scrollBy = jest.fn();
      window.scrollTo = jest.fn();
    });

    test('scrolls down by amount', async () => {
      const result = await executor.scroll({ direction: 'down', amount: 500 });

      expect(result.success).toBe(true);
      expect(window.scrollBy).toHaveBeenCalledWith(0, 500);
    });

    test('scrolls up by amount', async () => {
      const result = await executor.scroll({ direction: 'up', amount: 300 });

      expect(result.success).toBe(true);
      expect(window.scrollBy).toHaveBeenCalledWith(0, -300);
    });

    test('scrolls to element', async () => {
      const element = createMockElement('div', { id: 'scroll-target' });
      container.appendChild(element);

      const result = await executor.scroll({ selector: '#scroll-target' });

      expect(result.success).toBe(true);
      expect(element.scrollIntoView).toHaveBeenCalled();
    });

    test('scrolls to bottom of page', async () => {
      Object.defineProperty(document.body, 'scrollHeight', { value: 5000 });

      const result = await executor.scroll({ to: 'bottom' });

      expect(result.success).toBe(true);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 5000);
    });

    test('scrolls to top of page', async () => {
      const result = await executor.scroll({ to: 'top' });

      expect(result.success).toBe(true);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('Read Actions', () => {
    test('extracts text content', async () => {
      const div = createMockElement('div', {
        id: 'text-div',
        textContent: 'Hello World'
      });
      container.appendChild(div);

      const result = await executor.read({
        selector: '#text-div',
        property: 'text'
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('Hello World');
    });

    test('extracts attribute value', async () => {
      const link = document.createElement('a');
      link.id = 'test-link';
      link.href = 'https://example.com';
      link.textContent = 'Click me';
      container.appendChild(link);

      const result = await executor.read({
        selector: '#test-link',
        property: 'href'
      });

      expect(result.success).toBe(true);
      expect(result.value).toContain('example.com');
    });

    test('returns element HTML', async () => {
      const div = createMockElement('div', {
        id: 'html-div',
        innerHTML: '<span>Inner content</span>'
      });
      container.appendChild(div);

      const result = await executor.read({
        selector: '#html-div',
        property: 'html'
      });

      expect(result.success).toBe(true);
      expect(result.value).toContain('<span>');
    });

    test('extracts input value', async () => {
      const input = createMockElement('input', {
        type: 'text',
        id: 'value-input'
      });
      input.value = 'Input Value';
      container.appendChild(input);

      const result = await executor.read({
        selector: '#value-input',
        property: 'value'
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('Input Value');
    });

    test('returns error for non-existent element', async () => {
      const result = await executor.read({
        selector: '#nonexistent',
        property: 'text'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('redacts password field values', async () => {
      const passwordInput = createMockElement('input', {
        type: 'password',
        id: 'secret-input'
      });
      passwordInput.value = 'supersecret';
      container.appendChild(passwordInput);

      const result = await executor.read({
        selector: '#secret-input',
        property: 'value'
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('[REDACTED]');
    });
  });

  describe('Security Checks', () => {
    test('identifies password fields by type', () => {
      const input = createMockElement('input', { type: 'password' });
      expect(executor.isPasswordField(input)).toBe(true);
    });

    test('identifies password fields by name', () => {
      const input = createMockElement('input', { type: 'text' });
      input.name = 'user_password';
      expect(executor.isPasswordField(input)).toBe(true);
    });

    test('identifies password fields by id', () => {
      const input = createMockElement('input', { type: 'text', id: 'pwd-field' });
      expect(executor.isPasswordField(input)).toBe(true);
    });

    test('identifies password fields by autocomplete', () => {
      const input = createMockElement('input', { type: 'text' });
      input.autocomplete = 'current-password';
      expect(executor.isPasswordField(input)).toBe(true);
    });

    test('non-password fields return false', () => {
      const input = createMockElement('input', { type: 'text', id: 'username' });
      expect(executor.isPasswordField(input)).toBe(false);
    });
  });

  describe('Element Finding', () => {
    test('finds element by CSS selector', () => {
      const div = createMockElement('div', { id: 'css-target' });
      container.appendChild(div);

      const found = executor.findElement({ selector: '#css-target' });
      expect(found).toBe(div);
    });

    test('finds element by XPath', () => {
      const div = createMockElement('div', { id: 'xpath-target' });
      container.appendChild(div);

      const found = executor.findElement({ xpath: '//div[@id="xpath-target"]' });
      expect(found).toBe(div);
    });

    test('returns null for non-existent selector', () => {
      const found = executor.findElement({ selector: '#nonexistent' });
      expect(found).toBeNull();
    });

    test('returns null for non-existent XPath', () => {
      const found = executor.findElement({ xpath: '//div[@id="nonexistent"]' });
      expect(found).toBeNull();
    });
  });

  describe('XPath generation', () => {
    test('skips generated IDs when building smart XPath', () => {
      container.innerHTML = `
        <main id="results">
          <div id="f99665ae-0cbc-4539-af56-506b0ce99836"><button>First</button></div>
          <div id="a99665ae-0cbc-4539-af56-506b0ce99837"><button>Second</button></div>
        </main>
      `;

      const target = container.querySelectorAll('button')[1];
      const xpath = executor.getSmartXPath(target);

      expect(xpath).not.toContain('f99665ae-0cbc-4539-af56-506b0ce99836');
      expect(xpath).not.toContain('a99665ae-0cbc-4539-af56-506b0ce99837');
      expect(xpath).toContain('//*[@id="results"]');
    });

    test('ignores puisg utility classes in favor of semantic classes', () => {
      const semanticClass = executor.findSemanticClass(['puisg-row', 's-result-item']);

      expect(semanticClass).toBe('s-result-item');
    });
  });
});
