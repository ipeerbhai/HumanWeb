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
   * Generate a description of the element target for error messages
   * @param {object} options - { selector, xpath, index, x, y }
   * @returns {string}
   */
  describeTarget(options) {
    let target = options.selector || options.xpath || (options.x !== undefined ? `(${options.x}, ${options.y})` : 'unknown');
    if (options.index !== undefined && options.index > 0) {
      target += `[${options.index}]`;
    }
    return target;
  }

  /**
   * Get screen coordinates for an element (for native mouse automation)
   * @param {Element} element
   * @returns {object} - { screenX, screenY }
   */
  getScreenCoordinates(element) {
    const rect = element.getBoundingClientRect();
    // Viewport coordinates + window position on screen
    const screenX = window.screenX + rect.left + rect.width / 2;
    const screenY = window.screenY + rect.top + rect.height / 2;
    return {
      screenX,
      screenY,
      debug: {
        windowScreenX: window.screenX,
        windowScreenY: window.screenY,
        windowOuterWidth: window.outerWidth,
        windowOuterHeight: window.outerHeight,
        windowInnerWidth: window.innerWidth,
        windowInnerHeight: window.innerHeight,
        screenLeft: window.screenLeft,  // Alternative to screenX
        screenTop: window.screenTop,    // Alternative to screenY
        rectLeft: rect.left,
        rectTop: rect.top,
        rectWidth: rect.width,
        rectHeight: rect.height
      }
    };
  }

  /**
   * Get screen coordinates for an element by selector/xpath
   * @param {object} options - { selector, xpath, index }
   * @returns {object} - { success, screenX, screenY, error }
   */
  async getElementScreenCoordinates(options) {
    try {
      const element = this.findElement(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${this.describeTarget(options)}`
        };
      }

      // Scroll into view first (including parent overflow containers)
      this.scrollIntoViewRecursive(element, 'instant');
      await new Promise(resolve => setTimeout(resolve, 100));

      const coords = this.getScreenCoordinates(element);
      return {
        success: true,
        screenX: coords.screenX,
        screenY: coords.screenY,
        debug: coords.debug
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get coordinates: ${error.message}`
      };
    }
  }

  /**
   * Find an element by selector or XPath
   * @param {object} options - { selector, xpath, index, x, y }
   * @returns {Element|null}
   */
  findElement(options) {
    const index = options.index || 0;

    if (options.selector) {
      const elements = document.querySelectorAll(options.selector);
      if (index >= elements.length) {
        return null;
      }
      return elements[index];
    }

    if (options.xpath) {
      const result = document.evaluate(
        options.xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      if (index >= result.snapshotLength) {
        return null;
      }
      return result.snapshotItem(index);
    }

    if (options.x !== undefined && options.y !== undefined) {
      return document.elementFromPoint(options.x, options.y);
    }

    return null;
  }

  /**
   * Find all elements by selector or XPath
   * @param {object} options - { selector, xpath, limit }
   * @returns {Element[]}
   */
  findAllElements(options) {
    const limit = options.limit || 50;  // Default max 50 elements

    if (options.selector) {
      const elements = document.querySelectorAll(options.selector);
      return Array.from(elements).slice(0, limit);
    }

    if (options.xpath) {
      const result = document.evaluate(
        options.xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_ITERATOR_TYPE,
        null
      );
      const elements = [];
      let node;
      while ((node = result.iterateNext()) && elements.length < limit) {
        elements.push(node);
      }
      return elements;
    }

    return [];
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
   * Scroll element into view, including scrolling all parent overflow containers.
   * Standard scrollIntoView() may not scroll parent containers with overflow.
   * @param {Element} element
   * @param {string} behavior - 'instant' or 'smooth'
   */
  scrollIntoViewRecursive(element, behavior = 'smooth') {
    // Walk up the DOM, scrolling each overflow container
    let current = element;
    let parent = current.parentElement;

    while (parent && parent !== document.body && parent !== document.documentElement) {
      const style = window.getComputedStyle(parent);
      const isScrollable =
        style.overflowY === 'auto' || style.overflowY === 'scroll' ||
        style.overflow === 'auto' || style.overflow === 'scroll';

      if (isScrollable && parent.scrollHeight > parent.clientHeight) {
        // Scroll parent to center the element within it
        const elementRect = current.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const elementCenter = elementRect.top + elementRect.height / 2;
        const parentCenter = parentRect.top + parentRect.height / 2;
        const scrollOffset = elementCenter - parentCenter;

        parent.scrollTop += scrollOffset;
      }

      current = parent;
      parent = parent.parentElement;
    }

    // Finally scroll into viewport
    element.scrollIntoView({ behavior, block: 'center' });
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
          error: `Element not found: ${this.describeTarget(options)}`
        };
      }

      // Security check
      if (this.isPasswordField(element)) {
        return {
          success: false,
          error: 'Cannot click on password fields for security reasons'
        };
      }

      // Scroll into view including parent overflow containers (skip for coordinate-based clicks on canvas)
      if (!options.x && !options.y) {
        this.scrollIntoViewRecursive(element, 'smooth');
      }

      // Highlight if requested
      if (options.highlight) {
        this.highlightElement(element);
      }

      // Small delay to allow scroll animation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Use native click for standard elements (creates trusted event that can open popups)
      // Only use synthetic events for canvas or coordinate-based clicks
      const isCoordinateClick = options.x !== undefined && options.y !== undefined;
      const isCanvasElement = element instanceof HTMLCanvasElement;

      if (!isCoordinateClick && !isCanvasElement && element.click) {
        // Native click - creates trusted event (isTrusted = true)
        element.click();

        // For links/buttons that open popups, also try focus + keyboard
        // This can help with some sites that check for keyboard activation
        if (element.tagName === 'A' || element.tagName === 'BUTTON' ||
            element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link') {
          element.focus();
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
      } else {
        // Synthetic events for canvas/coordinate-based clicks
        // Note: These have isTrusted = false and can't trigger popups
        let clientX, clientY;
        if (isCoordinateClick) {
          clientX = options.x;
          clientY = options.y;
        } else {
          const rect = element.getBoundingClientRect();
          clientX = rect.left + rect.width / 2;
          clientY = rect.top + rect.height / 2;
        }

        const mousedownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0
        });
        element.dispatchEvent(mousedownEvent);

        const mouseupEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0
        });
        element.dispatchEvent(mouseupEvent);

        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0
        });
        element.dispatchEvent(clickEvent);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Click failed: ${error.message}`
      };
    }
  }

  /**
   * Execute a double-click action
   * @param {object} options - { selector, xpath, x, y, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async doubleClick(options) {
    try {
      const element = this.findElement(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${this.describeTarget(options)}`
        };
      }

      // Security check
      if (this.isPasswordField(element)) {
        return {
          success: false,
          error: 'Cannot double-click on password fields for security reasons'
        };
      }

      // Scroll into view including parent overflow containers (skip for coordinate-based clicks on canvas)
      if (!options.x && !options.y) {
        this.scrollIntoViewRecursive(element, 'smooth');
      }

      // Highlight if requested
      if (options.highlight) {
        this.highlightElement(element);
      }

      // Small delay to allow scroll animation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Use native events for standard elements (creates trusted events)
      // Only use synthetic events for canvas or coordinate-based clicks
      const isCoordinateClick = options.x !== undefined && options.y !== undefined;
      const isCanvasElement = element instanceof HTMLCanvasElement;

      if (!isCoordinateClick && !isCanvasElement && element.click) {
        // Native double-click via two rapid clicks
        // Creates trusted events (isTrusted = true)
        element.click();
        await new Promise(resolve => setTimeout(resolve, 50));
        element.click();
        // Dispatch dblclick event (still synthetic but the clicks were trusted)
        element.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, view: window, button: 0, detail: 2
        }));
      } else {
        // Synthetic events for canvas/coordinate-based clicks
        let clientX, clientY;
        if (isCoordinateClick) {
          clientX = options.x;
          clientY = options.y;
        } else {
          const rect = element.getBoundingClientRect();
          clientX = rect.left + rect.width / 2;
          clientY = rect.top + rect.height / 2;
        }

        // Dispatch full event sequence for canvas compatibility (both Pointer and Mouse events)
        const pointerOpts = {
          bubbles: true, cancelable: true, view: window, clientX, clientY,
          button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, pointerId: 1
        };

        // First click - Pointer events
        element.dispatchEvent(new PointerEvent('pointerdown', { ...pointerOpts, detail: 1 }));
        element.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 1
        }));
        element.dispatchEvent(new PointerEvent('pointerup', { ...pointerOpts, buttons: 0, detail: 1 }));
        element.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 1
        }));
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 1
        }));

        // Small delay between clicks
        await new Promise(resolve => setTimeout(resolve, 50));

        // Second click - Pointer events
        element.dispatchEvent(new PointerEvent('pointerdown', { ...pointerOpts, detail: 2 }));
        element.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 2
        }));
        element.dispatchEvent(new PointerEvent('pointerup', { ...pointerOpts, buttons: 0, detail: 2 }));
        element.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 2
        }));
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 2
        }));

        // Finally dispatch dblclick
        element.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, detail: 2
        }));
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Double-click failed: ${error.message}`
      };
    }
  }

  /**
   * Execute a right-click (context menu) action
   * @param {object} options - { selector, xpath, x, y, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async rightClick(options) {
    try {
      const element = this.findElement(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${this.describeTarget(options)}`
        };
      }

      // Security check
      if (this.isPasswordField(element)) {
        return {
          success: false,
          error: 'Cannot right-click on password fields for security reasons'
        };
      }

      // Scroll into view including parent overflow containers (skip for coordinate-based clicks on canvas)
      if (!options.x && !options.y) {
        this.scrollIntoViewRecursive(element, 'smooth');
      }

      // Highlight if requested
      if (options.highlight) {
        this.highlightElement(element);
      }

      // Small delay to allow scroll animation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get click coordinates - use provided x,y or element center
      let clientX, clientY;
      if (options.x !== undefined && options.y !== undefined) {
        clientX = options.x;
        clientY = options.y;
      } else {
        const rect = element.getBoundingClientRect();
        clientX = rect.left + rect.width / 2;
        clientY = rect.top + rect.height / 2;
      }

      // Dispatch mousedown with right button first for canvas compatibility
      element.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 2,
        buttons: 2
      }));

      // Dispatch contextmenu event
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 2
      }));

      // Dispatch mouseup
      element.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 2
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Right-click failed: ${error.message}`
      };
    }
  }

  /**
   * Execute a drag action (mousedown -> mousemove -> mouseup)
   * @param {object} options - { selector, targetSelector, targetX, targetY, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async drag(options) {
    try {
      const sourceElement = this.findElement(options);

      if (!sourceElement) {
        return {
          success: false,
          error: `Source element not found: ${options.selector || options.xpath}`
        };
      }

      // Security check
      if (this.isPasswordField(sourceElement)) {
        return {
          success: false,
          error: 'Cannot drag password fields for security reasons'
        };
      }

      // Get source position
      const sourceRect = sourceElement.getBoundingClientRect();
      const startX = sourceRect.left + sourceRect.width / 2;
      const startY = sourceRect.top + sourceRect.height / 2;

      // Determine target position
      let endX, endY, targetElement;
      if (options.targetSelector) {
        targetElement = document.querySelector(options.targetSelector);
        if (!targetElement) {
          return {
            success: false,
            error: `Target element not found: ${options.targetSelector}`
          };
        }
        const targetRect = targetElement.getBoundingClientRect();
        endX = targetRect.left + targetRect.width / 2;
        endY = targetRect.top + targetRect.height / 2;
      } else if (options.targetX !== undefined && options.targetY !== undefined) {
        endX = options.targetX;
        endY = options.targetY;
        targetElement = document.elementFromPoint(endX, endY);
      } else {
        return {
          success: false,
          error: 'Target not specified. Provide targetSelector or targetX/targetY'
        };
      }

      // Scroll source into view including parent overflow containers
      this.scrollIntoViewRecursive(sourceElement, 'smooth');

      // Highlight if requested
      if (options.highlight) {
        this.highlightElement(sourceElement);
      }

      // Small delay to allow scroll
      await new Promise(resolve => setTimeout(resolve, 100));

      // Dispatch mousedown on source
      const mousedownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: startX,
        clientY: startY,
        button: 0
      });
      sourceElement.dispatchEvent(mousedownEvent);

      // Small delay between events
      await new Promise(resolve => setTimeout(resolve, 50));

      // Dispatch mousemove events (interpolate for smoother drag)
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const currentX = startX + (endX - startX) * progress;
        const currentY = startY + (endY - startY) * progress;

        const mousemoveEvent = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: currentX,
          clientY: currentY,
          button: 0
        });
        document.dispatchEvent(mousemoveEvent);

        await new Promise(resolve => setTimeout(resolve, 20));
      }

      // Dispatch mouseup at target
      const mouseupEvent = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: endX,
        clientY: endY,
        button: 0
      });
      (targetElement || document).dispatchEvent(mouseupEvent);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Drag failed: ${error.message}`
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
          error: `Element not found: ${this.describeTarget(options)}`
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
      // Scroll to element including parent overflow containers
      if (options.selector) {
        const element = this.findElement(options);
        if (!element) {
          return {
            success: false,
            error: `Element not found: ${this.describeTarget(options)}`
          };
        }
        this.scrollIntoViewRecursive(element, 'smooth');
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
          error: `Element not found: ${this.describeTarget(options)}`
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
   * Query all matching elements and return their info
   * @param {object} options - { selector, xpath, limit, attributes }
   * @returns {Promise<object>} - { success, count, elements, error }
   */
  async queryAll(options) {
    try {
      const elements = this.findAllElements(options);
      const attributes = options.attributes || ['id', 'class', 'name', 'type', 'href', 'value'];

      const elementInfos = elements.map((el, index) => {
        const info = {
          index,
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 100),  // First 100 chars
        };

        // Add requested attributes
        for (const attr of attributes) {
          if (attr === 'value' && this.isPasswordField(el)) {
            info[attr] = '[REDACTED]';
          } else if (el.hasAttribute && el.hasAttribute(attr)) {
            info[attr] = el.getAttribute(attr);
          } else if (el[attr] !== undefined && typeof el[attr] !== 'function') {
            info[attr] = String(el[attr]);
          }
        }

        // Generate a unique selector for this element
        info.selector = this.generateSelector(el);

        return info;
      });

      return {
        success: true,
        count: elements.length,
        total: options.selector ? document.querySelectorAll(options.selector).length : elements.length,
        elements: elementInfos
      };
    } catch (error) {
      return {
        success: false,
        error: `Query failed: ${error.message}`
      };
    }
  }

  /**
   * Generate a unique CSS selector for an element
   * @param {Element} el
   * @returns {string}
   */
  generateSelector(el) {
    if (el.id) {
      return `#${el.id}`;
    }

    // Try nth-of-type
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === el.tagName
      );
      const index = siblings.indexOf(el) + 1;
      const parentSelector = parent.id ? `#${parent.id}` : parent.tagName.toLowerCase();
      return `${parentSelector} > ${el.tagName.toLowerCase()}:nth-of-type(${index})`;
    }

    return el.tagName.toLowerCase();
  }

  /**
   * Execute an action by type
   * @param {string} actionType - click, doubleclick, rightclick, drag, type, scroll, read
   * @param {object} options - Action-specific options
   * @returns {Promise<object>}
   */
  async execute(actionType, options) {
    switch (actionType) {
      case 'click':
        return this.click(options);
      case 'doubleclick':
        return this.doubleClick(options);
      case 'rightclick':
        return this.rightClick(options);
      case 'drag':
        return this.drag(options);
      case 'type':
        return this.type(options);
      case 'scroll':
        return this.scroll(options);
      case 'read':
        return this.read(options);
      case 'queryAll':
        return this.queryAll(options);
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
