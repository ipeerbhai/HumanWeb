/**
 * Co-Browser Extension - DOM Observer
 *
 * This module observes DOM changes and detects dynamically added
 * security elements (CAPTCHAs, login forms, etc.)
 *
 * Note: Core DOM observer functionality is integrated into content.js
 * This file exists for manifest compatibility and can be extended
 * for advanced DOM observation needs.
 */

// DOM observer is initialized in content.js via setupDOMObserver()
// This file provides a namespace for future DOM observation utilities

const DOMObserverUtils = {
  /**
   * Check if an element is a CAPTCHA container
   */
  isCaptchaElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // reCAPTCHA
    if (element.classList?.contains('g-recaptcha') ||
        element.querySelector?.('.g-recaptcha')) {
      return { type: 'recaptcha', element };
    }

    // hCaptcha
    if (element.classList?.contains('h-captcha') ||
        element.querySelector?.('.h-captcha')) {
      return { type: 'hcaptcha', element };
    }

    // Cloudflare challenge
    if (element.id === 'cf-wrapper' ||
        element.querySelector?.('#cf-wrapper')) {
      return { type: 'cloudflare', element };
    }

    // Turnstile
    if (element.classList?.contains('cf-turnstile') ||
        element.querySelector?.('.cf-turnstile')) {
      return { type: 'turnstile', element };
    }

    return false;
  },

  /**
   * Check if an element is a login form
   */
  isLoginForm(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Check for password fields
    const passwordFields = element.querySelectorAll?.('input[type="password"]');
    if (passwordFields && passwordFields.length > 0) {
      return true;
    }

    // Check for login-related keywords in form action or id
    const formElement = element.tagName === 'FORM' ? element : element.querySelector?.('form');
    if (formElement) {
      const action = formElement.getAttribute('action') || '';
      const id = formElement.id || '';
      const className = formElement.className || '';
      const loginKeywords = ['login', 'signin', 'sign-in', 'auth', 'authenticate'];

      for (const keyword of loginKeywords) {
        if (action.toLowerCase().includes(keyword) ||
            id.toLowerCase().includes(keyword) ||
            className.toLowerCase().includes(keyword)) {
          return true;
        }
      }
    }

    return false;
  },

  /**
   * Check if an element is a payment form
   */
  isPaymentForm(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Check for credit card fields
    const ccPatterns = [
      'input[name*="card"]',
      'input[name*="credit"]',
      'input[autocomplete*="cc-"]',
      'input[data-stripe]',
      'input[data-braintree]'
    ];

    for (const pattern of ccPatterns) {
      if (element.matches?.(pattern) || element.querySelector?.(pattern)) {
        return true;
      }
    }

    // Check for payment-related iframes
    const iframes = element.querySelectorAll?.('iframe');
    if (iframes) {
      for (const iframe of iframes) {
        const src = iframe.src || '';
        if (src.includes('stripe.com') ||
            src.includes('braintree') ||
            src.includes('paypal') ||
            src.includes('checkout')) {
          return true;
        }
      }
    }

    return false;
  }
};

// Export for use in other content scripts
if (typeof window !== 'undefined') {
  window.DOMObserverUtils = DOMObserverUtils;
}
