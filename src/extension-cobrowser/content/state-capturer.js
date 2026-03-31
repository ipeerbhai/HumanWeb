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
   * Capture cheap page identity (~50 tokens)
   * @returns {object}
   */
  captureIdentity() {
    const url = window.location.href;
    const meta = document.querySelector('meta[name="description"]');
    const canonical = document.querySelector('link[rel="canonical"]');

    return {
      url,
      title: document.title,
      meta_description: meta ? meta.content.substring(0, 200) : null,
      canonical_url: canonical ? canonical.href : null,
      lang: document.documentElement.lang || null,
      page_type: this._detectPageType(),
      security: this.getSecurityInfo(),
      is_sensitive: this.isSensitiveURL(url)
    };
  }

  /**
   * Heuristically detect page type
   * @returns {string}
   */
  _detectPageType() {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const body = document.body;

    // Login/auth
    const security = this.getSecurityInfo();
    if (security.isLoginPage) return 'login';
    if (security.hasCloudflareChallenge) return 'challenge';

    // Search results — URL patterns + repeated result structures
    if (/[?&]q=|[?&]query=|[?&]search=|\/search/i.test(url)) {
      return 'search_results';
    }

    // Form-heavy page
    const forms = body.querySelectorAll('form');
    const inputs = body.querySelectorAll('input:not([type="hidden"]), textarea, select');
    if (forms.length > 0 && inputs.length >= 3) return 'form';

    // Product page — schema.org markup or common patterns
    if (document.querySelector('[itemtype*="schema.org/Product"], [itemtype*="schema.org/Offer"]')) {
      return 'product';
    }

    // Listing — many repeated similar structures
    const repeatedGroups = this._findRepeatedRegions(3);
    if (repeatedGroups.length > 0 && repeatedGroups[0].count >= 5) return 'listing';

    // Article — has <article> tag or main content with mostly text
    if (document.querySelector('article, [itemtype*="schema.org/Article"], [itemtype*="schema.org/NewsArticle"]')) {
      return 'article';
    }

    return 'unknown';
  }

  /**
   * Capture page structure for cheap orientation (~200-800 tokens)
   * @returns {object}
   */
  captureStructure() {
    return {
      landmarks: this._getLandmarks(),
      headings: this._getHeadings(),
      actions: this._getTopActions(),
      counts: this._getElementCounts(),
      scroll_pages: Math.ceil(document.documentElement.scrollHeight / Math.max(window.innerHeight, 1)),
      repeated_regions: this._findRepeatedRegions(5)
    };
  }

  /**
   * Get semantic landmarks with size info
   * @returns {Array}
   */
  _getLandmarks() {
    const selectors = [
      'main', 'nav', 'aside', 'header', 'footer',
      'section[aria-label]', 'section[aria-labelledby]',
      '[role="main"]', '[role="navigation"]', '[role="complementary"]',
      '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
      '[role="form"]'
    ];

    const seen = new Set();
    const landmarks = [];

    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el) || !this.isVisible(el)) return;
        seen.add(el);

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        const label = el.getAttribute('aria-label')
          || this._getLabelledByText(el)
          || role
          || tag;

        landmarks.push({
          tag,
          role: role || null,
          label: label.substring(0, 80),
          chars: el.textContent.length,
          children: el.children.length,
          selector: this.buildSelector(el)
        });
      });
    }

    return landmarks.slice(0, 15);
  }

  /**
   * Get aria-labelledby text
   * @param {Element} el
   * @returns {string|null}
   */
  _getLabelledByText(el) {
    const id = el.getAttribute('aria-labelledby');
    if (!id) return null;
    const ref = document.getElementById(id);
    return ref ? ref.textContent.trim().substring(0, 80) : null;
  }

  /**
   * Get visible headings
   * @returns {Array}
   */
  _getHeadings() {
    const headings = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
      if (!this.isVisible(el)) return;
      const text = el.textContent.trim();
      if (!text) return;

      headings.push({
        level: parseInt(el.tagName[1]),
        text: text.substring(0, 80),
        selector: this.buildSelector(el)
      });
    });
    return headings.slice(0, 20);
  }

  /**
   * Get top actionable elements (buttons, search boxes, prominent links)
   * @returns {Array}
   */
  _getTopActions() {
    const actions = [];

    // Search inputs — highest priority
    document.querySelectorAll('input[type="search"], input[role="searchbox"], input[name*="search"], input[name*="query"], input[name*="q"], input[placeholder*="search" i]').forEach(el => {
      if (!this.isVisible(el)) return;
      actions.push({
        type: 'search',
        text: el.placeholder || el.getAttribute('aria-label') || 'Search',
        selector: this.buildSelector(el),
        tag: el.tagName.toLowerCase()
      });
    });

    // Submit buttons and primary buttons
    document.querySelectorAll('button[type="submit"], input[type="submit"], button.primary, button.btn-primary, [role="button"]').forEach(el => {
      if (!this.isVisible(el)) return;
      const text = (el.textContent?.trim() || el.value || '').substring(0, 60);
      if (!text) return;
      actions.push({
        type: 'submit',
        text,
        selector: this.buildSelector(el),
        tag: el.tagName.toLowerCase()
      });
    });

    // Regular buttons (non-submit)
    document.querySelectorAll('button:not([type="submit"])').forEach(el => {
      if (!this.isVisible(el)) return;
      const text = (el.textContent?.trim() || '').substring(0, 60);
      if (!text || text.length < 2) return;
      actions.push({
        type: 'button',
        text,
        selector: this.buildSelector(el),
        tag: 'button'
      });
    });

    // Navigation links (in nav elements)
    document.querySelectorAll('nav a[href]').forEach(el => {
      if (!this.isVisible(el)) return;
      const text = (el.textContent?.trim() || '').substring(0, 60);
      if (!text) return;
      actions.push({
        type: 'nav_link',
        text,
        selector: this.buildSelector(el),
        tag: 'a'
      });
    });

    // Deduplicate by selector
    const seen = new Set();
    const unique = [];
    for (const action of actions) {
      if (seen.has(action.selector)) continue;
      seen.add(action.selector);
      unique.push(action);
    }

    return unique.slice(0, 15);
  }

  /**
   * Get element type counts
   * @returns {object}
   */
  _getElementCounts() {
    return {
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll('button, input[type="button"], input[type="submit"]').length,
      inputs: document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea').length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img').length,
      tables: document.querySelectorAll('table').length,
      selects: document.querySelectorAll('select').length
    };
  }

  /**
   * Find groups of repeated sibling elements (cards, list items, result rows)
   * @param {number} maxGroups - max groups to return
   * @returns {Array}
   */
  _findRepeatedRegions(maxGroups = 5) {
    const candidates = new Map(); // "parent_selector|tag.class" → {selector, count, sample}

    // Look for common repeating containers
    const containerSelectors = ['ul', 'ol', 'tbody', 'div', 'section', 'main'];
    for (const containerSel of containerSelectors) {
      document.querySelectorAll(containerSel).forEach(container => {
        if (!this.isVisible(container)) return;

        // Group children by tag+class signature
        const groups = new Map();
        for (const child of container.children) {
          const tag = child.tagName.toLowerCase();
          const cls = typeof child.className === 'string'
            ? child.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '';
          const sig = cls ? `${tag}.${cls}` : tag;

          if (!groups.has(sig)) {
            groups.set(sig, { elements: [], sig });
          }
          groups.get(sig).elements.push(child);
        }

        // Keep groups with 3+ siblings
        for (const [sig, group] of groups) {
          if (group.elements.length < 3) continue;

          const first = group.elements[0];
          const containerSelector = this.buildSelector(container);
          const key = `${containerSelector}|${sig}`;

          if (!candidates.has(key)) {
            const sampleText = first.textContent.trim().substring(0, 80);
            candidates.set(key, {
              selector: `${containerSelector} > ${sig}`,
              item_selector: sig,
              count: group.elements.length,
              sample_text: sampleText
            });
          }
        }
      });
    }

    // Sort by count descending, return top N
    return Array.from(candidates.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, maxGroups);
  }

  /**
   * Capture scoped section content (~300-1500 tokens)
   * @param {object} options - { selector, maxChars, fields, limit }
   * @returns {object}
   */
  captureSection(options = {}) {
    const { selector, maxChars = 3000, fields = null, limit = 25 } = options;

    if (!selector) {
      return { success: false, error: 'selector is required' };
    }

    const root = document.querySelector(selector);
    if (!root) {
      return { success: false, error: `Selector '${selector}' not found` };
    }

    const result = {
      success: true,
      selector,
      tag: root.tagName.toLowerCase(),
      chars: root.textContent.length
    };

    // Declarative extraction mode
    if (fields && typeof fields === 'object') {
      result.items = this._extractFields(root, fields, limit);
      result.item_count = result.items.length;
      return result;
    }

    // Standard section mode: text + interactive elements + links
    result.text = root.textContent.trim().substring(0, maxChars);
    if (root.textContent.length > maxChars) {
      result.text_truncated = true;
    }

    // Interactive elements within this section
    result.inputs = [];
    root.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(el => {
      if (!this.isVisible(el)) return;
      const info = {
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        selector: this.buildSelector(el),
        text: (el.placeholder || el.getAttribute('aria-label') || el.name || '').substring(0, 60)
      };
      if (el.tagName === 'SELECT') {
        info.options = Array.from(el.options).slice(0, 10).map(o => o.text.substring(0, 40));
      }
      if (el.value && el.type !== 'password') {
        info.value = el.value.substring(0, 60);
      }
      result.inputs.push(info);
    });

    result.buttons = [];
    root.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]').forEach(el => {
      if (!this.isVisible(el)) return;
      result.buttons.push({
        text: (el.textContent?.trim() || el.value || '').substring(0, 60),
        type: el.type || 'button',
        selector: this.buildSelector(el)
      });
    });

    result.links = [];
    root.querySelectorAll('a[href]').forEach(el => {
      if (!this.isVisible(el)) return;
      result.links.push({
        text: (el.textContent?.trim() || '').substring(0, 60),
        href: el.href,
        selector: this.buildSelector(el)
      });
    });

    // Cap arrays
    result.inputs = result.inputs.slice(0, 20);
    result.buttons = result.buttons.slice(0, 20);
    result.links = result.links.slice(0, 30);

    return result;
  }

  /**
   * Declarative field extraction from repeating child elements
   * Field map: { "label": "selector" } or { "label": "selector@attribute" }
   * @param {Element} root
   * @param {object} fieldMap
   * @param {number} limit
   * @returns {Array}
   */
  _extractFields(root, fieldMap, limit = 25) {
    // Find the first field's selector to identify repeating items
    const fieldEntries = Object.entries(fieldMap);
    if (fieldEntries.length === 0) return [];

    // Look for repeating container children that contain at least one field match
    const items = [];

    // Try to find items by looking at direct children or common list patterns
    // Use the first field to identify the repeating item boundary
    const [firstLabel, firstSpec] = fieldEntries[0];
    const firstSelector = firstSpec.split('@')[0];

    // Find all matches of the first field in the root
    const firstMatches = root.querySelectorAll(firstSelector);
    if (firstMatches.length === 0) return [];

    // For each first-field match, find the closest repeating ancestor
    // that contains all fields
    const itemRoots = new Set();
    for (const match of firstMatches) {
      // Walk up to find the item boundary — the smallest ancestor that
      // is a direct or near child of root and contains this match
      let candidate = match;
      while (candidate.parentElement && candidate.parentElement !== root) {
        candidate = candidate.parentElement;
      }
      if (candidate !== root) {
        itemRoots.add(candidate);
      }
    }

    // Extract fields from each item root
    for (const itemRoot of itemRoots) {
      if (items.length >= limit) break;

      const item = {};
      for (const [label, spec] of fieldEntries) {
        const atIdx = spec.lastIndexOf('@');
        let sel, attr;
        if (atIdx > 0) {
          sel = spec.substring(0, atIdx);
          attr = spec.substring(atIdx + 1);
        } else {
          sel = spec;
          attr = null;
        }

        const el = itemRoot.querySelector(sel);
        if (el) {
          if (attr) {
            item[label] = (el.getAttribute(attr) || '').substring(0, 200);
          } else {
            item[label] = (el.textContent?.trim() || '').substring(0, 200);
          }
        } else {
          item[label] = null;
        }
      }

      // Only include items that have at least one non-null field
      if (Object.values(item).some(v => v !== null)) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Capture complete page state (legacy - kept for backwards compatibility)
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
