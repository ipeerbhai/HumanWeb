/**
 * Action Executor for Co-Browser Extension
 *
 * Executes browser actions (click, type, scroll, read) in the content script.
 * Includes security checks to prevent interaction with sensitive fields.
 */

class ActionExecutor {
  constructor() {
    // Password-related patterns for security checks
    this.passwordPatterns = [
      /password/i,
      /passwd/i,
      /pwd/i,
      /secret/i,
      /pin/i
    ];

    this.passwordAutocompleteValues = [
      'current-password',
      'new-password',
      'one-time-code'
    ];
  }

  /**
   * Find an element by selector or XPath
   * @param {object} options - { selector, xpath, x, y }
   * @returns {Element|null}
   */
  findElement(options) {
    if (options.selector) {
      return document.querySelector(options.selector);
    }

    if (options.xpath) {
      const result = document.evaluate(
        options.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    }

    if (options.x !== undefined && options.y !== undefined) {
      return document.elementFromPoint(options.x, options.y);
    }

    return null;
  }

  /**
   * Check if an element is a password field
   * @param {Element} element
   * @returns {boolean}
   */
  isPasswordField(element) {
    if (!element) return false;

    // Check type attribute
    if (element.type === 'password') {
      return true;
    }

    // Check autocomplete attribute
    if (element.autocomplete && this.passwordAutocompleteValues.includes(element.autocomplete)) {
      return true;
    }

    // Check name, id, and class for password patterns
    const identifiers = [
      element.name || '',
      element.id || '',
      element.className || ''
    ].join(' ');

    return this.passwordPatterns.some(pattern => pattern.test(identifiers));
  }

  /**
   * Highlight an element temporarily
   * @param {Element} element
   */
  highlightElement(element) {
    if (!element) return;

    element.dataset.cobrowserHighlight = 'true';
    element.classList.add('cobrowser-highlight');

    const originalOutline = element.style.outline;
    element.style.outline = '3px solid #4CAF50';

    setTimeout(() => {
      element.style.outline = originalOutline;
      delete element.dataset.cobrowserHighlight;
      element.classList.remove('cobrowser-highlight');
    }, 500);
  }

  /**
   * Execute a click action
   * @param {object} options - { selector, xpath, x, y, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async click(options) {
    try {
      const element = this.findElement(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${options.selector || options.xpath || `(${options.x}, ${options.y})`}`
        };
      }

      // Security check
      if (this.isPasswordField(element)) {
        return {
          success: false,
          error: 'Cannot click on password fields for security reasons'
        };
      }

      // Scroll into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight if requested
      if (options.highlight) {
        this.highlightElement(element);
      }

      // Small delay to allow scroll animation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Perform click
      element.click();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Click failed: ${error.message}`
      };
    }
  }

  /**
   * Execute a type action
   * @param {object} options - { selector, xpath, text, clear }
   * @returns {Promise<object>} - { success, error }
   */
  async type(options) {
    try {
      const element = this.findElement(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${options.selector || options.xpath}`
        };
      }

      // Security check
      if (this.isPasswordField(element)) {
        return {
          success: false,
          error: 'Cannot type into password fields for security reasons'
        };
      }

      // Focus the element
      element.focus();

      // Clear if requested
      if (options.clear) {
        element.value = '';
      }

      // Type the text
      const currentValue = element.value || '';
      element.value = currentValue + options.text;

      // Dispatch input event
      const inputEvent = new Event('input', { bubbles: true, cancelable: true });
      element.dispatchEvent(inputEvent);

      // Dispatch change event
      const changeEvent = new Event('change', { bubbles: true, cancelable: true });
      element.dispatchEvent(changeEvent);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Type failed: ${error.message}`
      };
    }
  }

  /**
   * Execute a scroll action
   * @param {object} options - { direction, amount, selector, to }
   * @returns {Promise<object>} - { success, error }
   */
  async scroll(options) {
    try {
      // Scroll to element
      if (options.selector) {
        const element = this.findElement(options);
        if (!element) {
          return {
            success: false,
            error: `Element not found: ${options.selector}`
          };
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      }

      // Scroll to position
      if (options.to === 'bottom') {
        window.scrollTo(0, document.body.scrollHeight);
        return { success: true };
      }

      if (options.to === 'top') {
        window.scrollTo(0, 0);
        return { success: true };
      }

      // Scroll by amount
      if (options.direction) {
        const amount = options.amount || 300;
        const y = options.direction === 'up' ? -amount : amount;
        window.scrollBy(0, y);
        return { success: true };
      }

      return {
        success: false,
        error: 'Invalid scroll options'
      };
    } catch (error) {
      return {
        success: false,
        error: `Scroll failed: ${error.message}`
      };
    }
  }

  /**
   * Execute a read action
   * @param {object} options - { selector, xpath, property }
   * @returns {Promise<object>} - { success, value, error }
   */
  async read(options) {
    try {
      const element = this.findElement(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${options.selector || options.xpath}`
        };
      }

      const property = options.property || 'text';
      let value;

      switch (property) {
        case 'text':
          value = element.textContent;
          break;

        case 'html':
          value = element.innerHTML;
          break;

        case 'value':
          // Redact password fields
          if (this.isPasswordField(element)) {
            value = '[REDACTED]';
          } else {
            value = element.value;
          }
          break;

        default:
          // Get attribute
          value = element.getAttribute(property);
          if (value === null) {
            value = element[property];
          }
          break;
      }

      return {
        success: true,
        value: value
      };
    } catch (error) {
      return {
        success: false,
        error: `Read failed: ${error.message}`
      };
    }
  }

  /**
   * Execute an action by type
   * @param {string} actionType - click, type, scroll, read
   * @param {object} options - Action-specific options
   * @returns {Promise<object>}
   */
  async execute(actionType, options) {
    switch (actionType) {
      case 'click':
        return this.click(options);
      case 'type':
        return this.type(options);
      case 'scroll':
        return this.scroll(options);
      case 'read':
        return this.read(options);
      default:
        return {
          success: false,
          error: `Unknown action type: ${actionType}`
        };
    }
  }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionExecutor;
}
if (typeof global !== 'undefined') {
  global.ActionExecutor = ActionExecutor;
}
