/**
 * State Capturer for Co-Browser Extension
 *
 * Captures page state including metadata, cleaned DOM, interactive elements,
 * and security-related information.
 */

class StateCapturer {
  constructor() {
    // Banking and payment URL patterns
    this.sensitiveUrlPatterns = [
      // Banks
      /bank/i,
      /chase\.com/i,
      /wellsfargo\.com/i,
      /citibank\.com/i,
      /usbank\.com/i,
      /capitalone\.com/i,
      /ally\.com/i,
      /pnc\.com/i,
      /tdbank\.com/i,
      /fidelity\.com/i,
      /schwab\.com/i,
      /vanguard\.com/i,
      // Payments
      /paypal\.com/i,
      /stripe\.com/i,
      /square\.com/i,
      /venmo\.com/i,
      /pay\.amazon\.com/i,
      /pay\.google\.com/i,
      /apple\.com\/.*pay/i,
      /checkout/i
    ];

    // Event handlers to remove from DOM
    this.eventAttributes = [
      'onclick', 'onload', 'onerror', 'onsubmit', 'onchange',
      'onmouseover', 'onmouseout', 'onkeydown', 'onkeyup', 'onfocus', 'onblur'
    ];
  }

  /**
   * Get page metadata
   * @returns {object}
   */
  getMetadata() {
    return {
      title: document.title,
      url: window.location.href,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      scroll: {
        x: window.scrollX,
        y: window.scrollY
      },
      timestamp: Date.now()
    };
  }

  /**
   * Get cleaned DOM (scripts, styles, handlers removed)
   * @param {object} options - { maxLength }
   * @returns {string}
   */
  getCleanedDOM(options = {}) {
    const maxLength = options.maxLength || 100000;

    // Clone the document body
    const clone = document.body.cloneNode(true);

    // Remove script tags
    clone.querySelectorAll('script').forEach(el => el.remove());

    // Remove style tags
    clone.querySelectorAll('style').forEach(el => el.remove());

    // Remove noscript tags
    clone.querySelectorAll('noscript').forEach(el => el.remove());

    // Remove inline event handlers
    clone.querySelectorAll('*').forEach(el => {
      this.eventAttributes.forEach(attr => {
        el.removeAttribute(attr);
      });

      // Redact password field values
      if (el.tagName === 'INPUT' && el.type === 'password') {
        el.value = '';
        el.removeAttribute('value');
      }
    });

    let html = clone.innerHTML;

    // Truncate if too long
    if (html.length > maxLength) {
      html = html.substring(0, maxLength) + '\n<!-- DOM truncated -->';
    }

    return html;
  }

  /**
   * Build a unique selector for an element
   * @param {Element} element
   * @returns {string}
   */
  buildSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }

    let path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = `#${current.id}`;
        path.unshift(selector);
        break;
      } else if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length > 0 && classes[0]) {
          selector += `.${classes.join('.')}`;
        }
      }

      // Add index if needed
      const siblings = current.parentElement ?
        Array.from(current.parentElement.children).filter(c => c.tagName === current.tagName) :
        [];
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Check if an element is visible
   * @param {Element} element
   * @returns {boolean}
   */
  isVisible(element) {
    if (element.hidden) return false;

    // Check inline style first (for test environment)
    if (element.style) {
      if (element.style.display === 'none') return false;
      if (element.style.visibility === 'hidden') return false;
    }

    // Check computed style if available
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      try {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }
      } catch (e) {
        // Ignore errors in test environment
      }
    }

    // In test environment (JSDOM), getBoundingClientRect returns zeros
    // so we assume visible if not explicitly hidden
    return true;
  }

  /**
   * Get interactive elements on the page
   * @returns {object}
   */
  getInteractiveElements() {
    const result = {
      buttons: [],
      links: [],
      inputs: [],
      selects: [],
      checkboxes: [],
      radios: []
    };

    // Buttons
    document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach(el => {
      if (this.isVisible(el)) {
        result.buttons.push({
          id: el.id || null,
          selector: this.buildSelector(el),
          text: el.textContent?.trim() || el.value || '',
          type: el.type || 'button'
        });
      }
    });

    // Links
    document.querySelectorAll('a[href]').forEach(el => {
      if (this.isVisible(el)) {
        result.links.push({
          id: el.id || null,
          selector: this.buildSelector(el),
          text: el.textContent?.trim() || '',
          href: el.href
        });
      }
    });

    // Text inputs and textareas
    document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"], textarea').forEach(el => {
      if (this.isVisible(el)) {
        result.inputs.push({
          id: el.id || null,
          selector: this.buildSelector(el),
          type: el.type || 'text',
          name: el.name || null,
          placeholder: el.placeholder || null
        });
      }
    });

    // Selects
    document.querySelectorAll('select').forEach(el => {
      if (this.isVisible(el)) {
        const options = Array.from(el.options).map(opt => ({
          value: opt.value,
          text: opt.text
        }));
        result.selects.push({
          id: el.id || null,
          selector: this.buildSelector(el),
          name: el.name || null,
          options: options
        });
      }
    });

    // Checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach(el => {
      if (this.isVisible(el)) {
        result.checkboxes.push({
          id: el.id || null,
          selector: this.buildSelector(el),
          name: el.name || null,
          checked: el.checked
        });
      }
    });

    // Radios
    document.querySelectorAll('input[type="radio"]').forEach(el => {
      if (this.isVisible(el)) {
        result.radios.push({
          id: el.id || null,
          selector: this.buildSelector(el),
          name: el.name || null,
          value: el.value,
          checked: el.checked
        });
      }
    });

    return result;
  }

  /**
   * Get security-related information
   * @returns {object}
   */
  getSecurityInfo() {
    const info = {
      hasPasswordFields: false,
      hasCaptcha: false,
      captchaType: null,
      hasCloudflareChallenge: false,
      isLoginPage: false
    };

    // Check for password fields
    const passwordFields = document.querySelectorAll('input[type="password"]');
    info.hasPasswordFields = passwordFields.length > 0;

    // Check for reCAPTCHA
    if (document.querySelector('.g-recaptcha, [data-sitekey]') ||
        document.querySelector('iframe[src*="recaptcha"]')) {
      info.hasCaptcha = true;
      info.captchaType = 'recaptcha';
    }

    // Check for hCaptcha
    if (document.querySelector('.h-captcha')) {
      info.hasCaptcha = true;
      info.captchaType = 'hcaptcha';
    }

    // Check for Cloudflare challenge
    if (document.querySelector('#cf-wrapper, #challenge-form, .cf-browser-verification')) {
      info.hasCloudflareChallenge = true;
    }

    // Check if login page
    const hasLoginForm = !!(document.querySelector('form') &&
      (document.querySelector('input[type="password"]') ||
       document.querySelector('[name*="login"], [name*="username"], [id*="login"]')));
    const hasLoginKeywords = /login|sign.?in|log.?in/i.test(document.body.textContent);

    info.isLoginPage = info.hasPasswordFields && (hasLoginForm || hasLoginKeywords);

    return info;
  }

  /**
   * Check if URL is sensitive (banking, payments)
   * @param {string} url
   * @returns {boolean}
   */
  isSensitiveURL(url) {
    return this.sensitiveUrlPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Capture complete page state
   * @param {object} options - { includeDOM, includeElements, maxDOMLength }
   * @returns {object}
   */
  captureState(options = {}) {
    const state = {
      metadata: this.getMetadata(),
      security: this.getSecurityInfo()
    };

    if (options.includeDOM !== false) {
      state.dom = this.getCleanedDOM({
        maxLength: options.maxDOMLength || 100000
      });
    }

    if (options.includeElements !== false) {
      state.elements = this.getInteractiveElements();
    }

    return state;
  }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StateCapturer;
}
if (typeof global !== 'undefined') {
  global.StateCapturer = StateCapturer;
}
