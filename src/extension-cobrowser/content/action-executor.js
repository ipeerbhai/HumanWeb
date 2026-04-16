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
   * Handles elements in iframes by adding iframe offset
   * @param {Element} element
   * @returns {object} - { screenX, screenY }
   */
  getScreenCoordinates(element) {
    const rect = element.getBoundingClientRect();

    // Start with element position relative to its document viewport
    let offsetX = rect.left + rect.width / 2;
    let offsetY = rect.top + rect.height / 2;

    // If element is in an iframe, add the iframe's position
    const iframe = element._cobrowserIframe;
    if (iframe) {
      const iframeRect = iframe.getBoundingClientRect();
      offsetX += iframeRect.left;
      offsetY += iframeRect.top;
    }

    // Add window position on screen
    const screenX = window.screenX + offsetX;
    const screenY = window.screenY + offsetY;

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
        rectHeight: rect.height,
        inIframe: !!iframe,
        iframeOffset: iframe ? { left: iframe.getBoundingClientRect().left, top: iframe.getBoundingClientRect().top } : null
      }
    };
  }

  /**
   * Get screen coordinates for an element by selector/xpath
   * Uses retry logic for dynamically loaded content
   * @param {object} options - { selector, xpath, index }
   * @returns {object} - { success, screenX, screenY, error }
   */
  async getElementScreenCoordinates(options) {
    try {
      // Use retry logic for dynamic content (e.g., LinkedIn job details pane)
      const element = await this.findElementWithRetry(options);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${this.describeTarget(options)}`
        };
      }

      // Check if element has valid geometry
      if (!this.hasValidGeometry(element)) {
        return {
          success: false,
          error: `Element found but has no dimensions (may be hidden): ${this.describeTarget(options)}`
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
   * Check if an element has valid geometry (is rendered and visible)
   * @param {Element} element
   * @returns {boolean}
   */
  hasValidGeometry(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Find element in shadow DOM trees recursively
   * @param {string} selector - CSS selector
   * @param {Document|ShadowRoot} root - Root to search from
   * @param {number} index - Which match to return
   * @returns {Element|null}
   */
  findInShadowDOM(selector, root = document, index = 0) {
    // First check light DOM at this level
    const elements = root.querySelectorAll(selector);
    if (elements.length > index) {
      return elements[index];
    }

    // Track how many we've found so far for index calculation
    let foundCount = elements.length;

    // Recursively search shadow DOM trees
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        const found = this.findInShadowDOM(selector, el.shadowRoot, index - foundCount);
        if (found) return found;
        // Count elements in this shadow root for index tracking
        foundCount += el.shadowRoot.querySelectorAll(selector).length;
      }
    }

    return null;
  }

  /**
   * Find element in same-origin iframes
   * @param {string} selector - CSS selector
   * @param {number} index - Which match to return
   * @returns {{element: Element, iframe: HTMLIFrameElement}|null}
   */
  findInIframes(selector, index = 0) {
    let foundCount = 0;
    const iframes = document.querySelectorAll('iframe');

    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) continue;

        const elements = iframeDoc.querySelectorAll(selector);
        if (elements.length > 0) {
          const targetIndex = index - foundCount;
          if (targetIndex < elements.length) {
            return { element: elements[targetIndex], iframe };
          }
          foundCount += elements.length;
        }

        // Also check shadow DOM within iframes
        const shadowEl = this.findInShadowDOM(selector, iframeDoc, index - foundCount);
        if (shadowEl) {
          return { element: shadowEl, iframe };
        }
      } catch (e) {
        // Cross-origin iframe - skip silently
      }
    }

    return null;
  }

  /**
   * Find an element by selector or XPath, searching shadow DOM and iframes
   * @param {object} options - { selector, xpath, index, x, y }
   * @returns {Element|null}
   */
  findElement(options) {
    const index = options.index || 0;

    if (options.selector) {
      // 1. Try main document light DOM first
      const elements = document.querySelectorAll(options.selector);
      if (elements.length > index) {
        return elements[index];
      }

      // 2. Try shadow DOM trees
      const shadowEl = this.findInShadowDOM(options.selector, document, index);
      if (shadowEl) {
        return shadowEl;
      }

      // 3. Try same-origin iframes
      const iframeResult = this.findInIframes(options.selector, index);
      if (iframeResult) {
        // Store iframe reference for coordinate calculation
        iframeResult.element._cobrowserIframe = iframeResult.iframe;
        return iframeResult.element;
      }

      return null;
    }

    if (options.xpath) {
      // Try main document first
      const result = document.evaluate(
        options.xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      if (result.snapshotLength > index) {
        return result.snapshotItem(index);
      }

      // Try same-origin iframes for XPath
      const iframes = document.querySelectorAll('iframe');
      let foundCount = result.snapshotLength;

      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) continue;

          const iframeResult = iframeDoc.evaluate(
            options.xpath,
            iframeDoc,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );

          const targetIndex = index - foundCount;
          if (iframeResult.snapshotLength > targetIndex && targetIndex >= 0) {
            const element = iframeResult.snapshotItem(targetIndex);
            element._cobrowserIframe = iframe;
            return element;
          }
          foundCount += iframeResult.snapshotLength;
        } catch (e) {
          // Cross-origin or XPath error - skip
        }
      }

      return null;
    }

    if (options.x !== undefined && options.y !== undefined) {
      return document.elementFromPoint(options.x, options.y);
    }

    return null;
  }

  /**
   * Find element with retry for dynamically loaded content
   * @param {object} options - { selector, xpath, index, x, y }
   * @param {number} maxWait - Maximum wait time in ms (default 3000)
   * @param {number} interval - Retry interval in ms (default 100)
   * @returns {Promise<Element|null>}
   */
  async findElementWithRetry(options, maxWait = 3000, interval = 100) {
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const element = this.findElement(options);

      // Found element with valid geometry - return it
      if (element && this.hasValidGeometry(element)) {
        return element;
      }

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    // Final attempt without geometry check (element might be intentionally hidden)
    return this.findElement(options);
  }

  /**
   * Find all elements by selector or XPath, descending into same-origin iframes.
   * Elements found inside an iframe are tagged with _cobrowserIframe for downstream
   * coordinate translation; cross-origin iframes are skipped silently.
   * @param {object} options - { selector, xpath, limit }
   * @returns {Element[]}
   */
  findAllElements(options) {
    const limit = options.limit || 50;  // Default max 50 elements
    const results = [];

    const collect = (root, iframe = null) => {
      if (results.length >= limit) return;

      let matches = [];
      try {
        if (options.selector) {
          matches = Array.from(root.querySelectorAll(options.selector));
        } else if (options.xpath) {
          const r = root.evaluate(
            options.xpath,
            root,
            null,
            XPathResult.ORDERED_NODE_ITERATOR_TYPE,
            null
          );
          let node;
          while ((node = r.iterateNext())) {
            matches.push(node);
          }
        }
      } catch (e) {
        return;
      }

      for (const el of matches) {
        if (iframe) el._cobrowserIframe = iframe;
        results.push(el);
        if (results.length >= limit) return;
      }
    };

    if (!options.selector && !options.xpath) return results;

    const descendShadow = (root, iframe, depth) => {
      if (results.length >= limit || depth >= 8) return;
      let hosts;
      try {
        hosts = root.querySelectorAll('*');
      } catch (e) {
        return;
      }
      for (const el of hosts) {
        if (results.length >= limit) return;
        if (el.shadowRoot) {
          collect(el.shadowRoot, iframe);
          descendShadow(el.shadowRoot, iframe, depth + 1);
        }
      }
    };

    const visitFrame = (root, iframe = null, depth = 0) => {
      if (results.length >= limit) return;
      collect(root, iframe);
      descendShadow(root, iframe, 0);
      if (results.length >= limit || depth >= 5) return;

      let nestedIframes;
      try {
        nestedIframes = root.querySelectorAll('iframe');
      } catch (e) {
        return;
      }
      for (const child of nestedIframes) {
        if (results.length >= limit) return;
        try {
          const childDoc = child.contentDocument || child.contentWindow?.document;
          if (!childDoc) continue;
          visitFrame(childDoc, child, depth + 1);
        } catch (e) {
          // Cross-origin — skip
        }
      }
    };

    visitFrame(document);

    return results;
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
   * Uses retry logic for dynamically loaded content
   * @param {object} options - { selector, xpath, x, y, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async click(options) {
    try {
      // Use retry for selector/xpath based clicks (not coordinate-based)
      const isCoordinateClick = options.x !== undefined && options.y !== undefined;
      const element = isCoordinateClick
        ? this.findElement(options)
        : await this.findElementWithRetry(options);

      if (!element) {
        if (options.selector) {
          return this.buildNotFoundResponse(options.selector, 'click');
        }
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
   * Uses retry logic for dynamically loaded content
   * @param {object} options - { selector, xpath, x, y, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async doubleClick(options) {
    try {
      // Use retry for selector/xpath based clicks (not coordinate-based)
      const isCoordinateClick = options.x !== undefined && options.y !== undefined;
      const element = isCoordinateClick
        ? this.findElement(options)
        : await this.findElementWithRetry(options);

      if (!element) {
        if (options.selector) {
          return this.buildNotFoundResponse(options.selector, 'doubleclick');
        }
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
   * Uses retry logic for dynamically loaded content
   * @param {object} options - { selector, xpath, x, y, highlight }
   * @returns {Promise<object>} - { success, error }
   */
  async rightClick(options) {
    try {
      // Use retry for selector/xpath based clicks (not coordinate-based)
      const isCoordinateClick = options.x !== undefined && options.y !== undefined;
      const element = isCoordinateClick
        ? this.findElement(options)
        : await this.findElementWithRetry(options);

      if (!element) {
        if (options.selector) {
          return this.buildNotFoundResponse(options.selector, 'rightclick');
        }
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
   * Uses retry logic for dynamically loaded content
   * @param {object} options - { selector, xpath, text, clear }
   * @returns {Promise<object>} - { success, error }
   */
  async type(options) {
    try {
      // Use retry for dynamic content
      const element = await this.findElementWithRetry(options);

      if (!element) {
        if (options.selector) {
          return this.buildNotFoundResponse(options.selector, 'type');
        }
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

      // Contenteditable path: element.value is undefined on divs, so the
      // legacy "value = ..." assignment silently fails. Use execCommand in
      // the element's own document so React-managed editors (Quill, Slate,
      // LinkedIn's composer) receive the change through their normal input
      // pipeline.
      if (element.isContentEditable) {
        const ownerDoc = element.ownerDocument || document;
        const ownerWin = ownerDoc.defaultView || window;

        // execCommand requires an active caret inside the contenteditable.
        // Establish one explicitly; focus() alone does not always place a
        // selection — especially for elements reached through iframe descent
        // or for editors that were never clicked (e.g., React-managed Quill).
        const range = ownerDoc.createRange();
        range.selectNodeContents(element);
        range.collapse(false); // caret at end
        const selection = ownerWin.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        if (options.clear) {
          ownerDoc.execCommand('selectAll', false, null);
          ownerDoc.execCommand('delete', false, null);
        }

        const inserted = ownerDoc.execCommand('insertText', false, options.text);

        // Quill and similar editors listen to beforeinput/input; firing a
        // final input event ensures any observer not triggered by
        // execCommand sees the change.
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

        return { success: inserted !== false };
      }

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
   * Uses retry logic for dynamically loaded content
   * @param {object} options - { selector, xpath, property }
   * @returns {Promise<object>} - { success, value, error }
   */
  async read(options) {
    try {
      // Use retry for dynamic content
      const element = await this.findElementWithRetry(options);

      if (!element) {
        if (options.selector) {
          return this.buildNotFoundResponse(options.selector, 'read');
        }
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

      let iframeScopedCount = 0;

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
        info.xpath = this.getSmartXPath(el);

        if (el._cobrowserIframe) {
          info.iframe = true;
          iframeScopedCount++;
        }

        return info;
      });

      return {
        success: true,
        count: elements.length,
        total: options.selector ? document.querySelectorAll(options.selector).length : elements.length,
        elements: elementInfos,
        iframe_scoped: iframeScopedCount
      };
    } catch (error) {
      return {
        success: false,
        error: `Query failed: ${error.message}`
      };
    }
  }

  /**
   * Generate a stable CSS selector for an element
   * Preference: #id > tag.class > tag[attr=val] > tag:nth-of-type
   * @param {Element} el
   * @returns {string}
   */
  generateSelector(el) {
    if (el.id) {
      return `#${el.id}`;
    }

    const tag = el.tagName.toLowerCase();

    // Build tag.class selector from meaningful classes (skip framework noise)
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(c => c.length > 0 && c.length < 40);
      if (classes.length > 0 && classes.length <= 3) {
        const classSelector = `${tag}.${classes.join('.')}`;
        // Only use if it's reasonably unique on the page
        try {
          if (document.querySelectorAll(classSelector).length <= 3) {
            return classSelector;
          }
        } catch (e) { /* ignore invalid selectors */ }
      }
    }

    // Try a distinguishing attribute
    for (const attr of ['name', 'type', 'aria-label', 'placeholder', 'role', 'href']) {
      const val = el.getAttribute(attr);
      if (val && val.length < 60) {
        const attrSelector = `${tag}[${attr}="${val.replace(/"/g, '\\"')}"]`;
        try {
          if (document.querySelectorAll(attrSelector).length <= 3) {
            return attrSelector;
          }
        } catch (e) { /* ignore */ }
      }
    }

    // Fall back to nth-of-type within parent
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === el.tagName
      );
      const index = siblings.indexOf(el) + 1;
      const parentSelector = parent.id ? `#${parent.id}` : parent.tagName.toLowerCase();
      return `${parentSelector} > ${tag}:nth-of-type(${index})`;
    }

    return tag;
  }

  /**
   * Returns true if an ID attribute value looks generated or dynamic.
   * Catches UUIDs, CSS-in-JS hashes, CSS module IDs, and random alphanumeric tokens.
   * @param {string} id
   * @returns {boolean}
   */
  isGeneratedId(id) {
    return globalThis.CoBrowserXPathUtils.isGeneratedId(id);
  }

  /**
   * Returns the first class name from classList that looks human-authored,
   * or null if none found.
   * Skips framework-generated prefixes, single chars, pure numbers, and very short names.
   * @param {DOMTokenList|string[]} classList
   * @returns {string|null}
   */
  findSemanticClass(classList) {
    return globalThis.CoBrowserXPathUtils.findSemanticClass(classList);
  }

  /**
   * Tests whether an XPath expression uniquely identifies the expected element.
   * Uses XPathResult.ORDERED_NODE_SNAPSHOT_TYPE for reliable multi-node checking.
   * @param {string} xpath
   * @param {Element} expectedElement
   * @returns {boolean} true if xpath resolves to exactly 1 result and it is expectedElement
   */
  verifyXPath(xpath, expectedElement) {
    return globalThis.CoBrowserXPathUtils.verifyXPath(xpath, expectedElement);
  }

  /**
   * Generate a well-generalized XPath expression for a DOM element.
   *
   * Uses an attribute-priority cascade walking up from the element toward root:
   *   1. Stable @id  (skipping generated/dynamic IDs)
   *   2. @data-testid, @aria-label, @role
   *   3. Semantic (human-authored) class via contains(@class, …)
   *   4. Positional fallback: tag[N] among same-tag siblings
   *
   * Stops as soon as the built XPath uniquely identifies the target element.
   * Walks at most 5 ancestor levels before returning the best positional path.
   *
   * @param {Element} element
   * @returns {string}  Always starts with "//"
   */
  getSmartXPath(element) {
    return globalThis.CoBrowserXPathUtils.getSmartXPath(element);
  }

  /**
   * Check if an element is visible (has layout geometry and is not hidden)
   * @param {Element} el
   * @returns {boolean}
   */
  isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * Find fuzzy element suggestions when a selector fails.
   * Searches by tag, text content, class overlap, and ID similarity.
   *
   * @param {string} selector - The failed CSS selector
   * @returns {Array<{selector: string, text: string, tag: string}>} Up to 3 candidates
   */
  findSuggestions(selector) {
    const suggestions = [];
    const seen = new Set();

    const addSuggestion = (el) => {
      const sel = this.generateSelector(el);
      if (seen.has(sel)) return;
      seen.add(sel);
      const rawText = (el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
      const text = rawText.length > 60 ? rawText.substring(0, 57) + '...' : rawText;
      suggestions.push({ selector: sel, text, tag: el.tagName.toLowerCase() });
    };

    try {
      // --- Strategy 1: Tag-based fallback ---
      // Extract tag name from selector (e.g. "button#submit" → "button")
      const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        const byTag = Array.from(document.querySelectorAll(tag))
          .filter(el => this.isElementVisible(el))
          .slice(0, 5);
        byTag.forEach(el => addSuggestion(el));
      }

      // --- Strategy 2: ID similarity ---
      // Extract ID from selector (e.g. "#submit-btn" or "button#foo")
      const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        const targetId = idMatch[1].toLowerCase();
        // Find elements whose ID contains the target or vice versa
        const allWithId = Array.from(document.querySelectorAll('[id]'))
          .filter(el => {
            const elId = el.id.toLowerCase();
            return this.isElementVisible(el) && (
              elId.includes(targetId) || targetId.includes(elId) ||
              this.stringSimilarity(elId, targetId) > 0.5
            );
          })
          .slice(0, 5);
        allWithId.forEach(el => addSuggestion(el));
      }

      // --- Strategy 3: Class overlap ---
      // Extract class names from selector (e.g. ".btn.primary" or "button.submit")
      const classMatches = selector.match(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);
      if (classMatches) {
        const targetClasses = classMatches.map(c => c.slice(1).toLowerCase());
        // Find elements sharing at least one class
        for (const cls of targetClasses) {
          const byClass = Array.from(document.querySelectorAll(`.${cls}`))
            .filter(el => this.isElementVisible(el))
            .slice(0, 3);
          byClass.forEach(el => addSuggestion(el));
          if (suggestions.length >= 6) break;
        }
      }

      // --- Strategy 4: Text-based search ---
      // Extract quoted text from selectors like [text()='Submit'] or aria-label="foo"
      const textMatch = selector.match(/['""]([^'""\]]+)['""\]]/);
      if (textMatch && textMatch[1].length >= 2) {
        const targetText = textMatch[1].toLowerCase();
        const interactive = Array.from(document.querySelectorAll(
          'button, a, input, [role="button"], [role="link"], [role="menuitem"]'
        )).filter(el => {
          if (!this.isElementVisible(el)) return false;
          const elText = (el.textContent || el.value || '').trim().toLowerCase();
          return elText.includes(targetText) || targetText.includes(elText);
        }).slice(0, 3);
        interactive.forEach(el => addSuggestion(el));
      }
    } catch (e) {
      // Best-effort — don't let suggestion failures propagate
    }

    // Score: prefer elements with non-empty text content and shorter selectors
    return suggestions
      .slice(0, 8)
      .sort((a, b) => {
        const aScore = (a.text ? 2 : 0) + (a.selector.startsWith('#') ? 3 : 0) - a.selector.length * 0.01;
        const bScore = (b.text ? 2 : 0) + (b.selector.startsWith('#') ? 3 : 0) - b.selector.length * 0.01;
        return bScore - aScore;
      })
      .slice(0, 3);
  }

  /**
   * Simple string similarity (Dice coefficient on bigrams)
   * @param {string} a
   * @param {string} b
   * @returns {number} 0..1
   */
  stringSimilarity(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const getBigrams = s => {
      const bigrams = new Set();
      for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
      return bigrams;
    };
    const setA = getBigrams(a);
    const setB = getBigrams(b);
    let intersection = 0;
    for (const bg of setA) { if (setB.has(bg)) intersection++; }
    return (2 * intersection) / (setA.size + setB.size);
  }

  /**
   * Build a structured failure response with fuzzy suggestions.
   * Used by action methods when an element cannot be found.
   *
   * @param {string} selector - The failed selector
   * @param {string} [actionLabel] - e.g. "click", "type"
   * @returns {object} {success: false, error, match_count, suggestions, hint}
   */
  buildNotFoundResponse(selector, actionLabel) {
    const suggestions = this.findSuggestions(selector);
    const hint = suggestions.length > 0
      ? `${suggestions.length} similar element${suggestions.length > 1 ? 's' : ''} found. Try one of the suggested selectors.`
      : 'No similar elements found. Check the selector or use cobrowser_get_page_info to inspect the page.';
    return {
      success: false,
      error: `Selector '${selector}' not found`,
      match_count: 0,
      suggestions,
      hint
    };
  }

  /**
   * Build a structured response for ambiguous (multi-match) selectors.
   * Returns suggestions using the first few matches with more specific selectors.
   *
   * @param {string} selector - The ambiguous selector
   * @param {NodeList|Array} matches - All matched elements
   * @returns {object} {success: false, error, match_count, suggestions, hint}
   */
  buildAmbiguousResponse(selector, matches) {
    const suggestions = Array.from(matches).slice(0, 3).map((el, idx) => {
      const sel = this.generateSelector(el);
      const rawText = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
      const text = rawText.length > 60 ? rawText.substring(0, 57) + '...' : rawText;
      return { selector: sel, text, tag: el.tagName.toLowerCase(), index: idx };
    });
    return {
      success: false,
      error: `Selector '${selector}' matched ${matches.length} elements — ambiguous`,
      match_count: matches.length,
      suggestions,
      hint: 'Multiple matches. Use a more specific selector or add distinguishing text.'
    };
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
