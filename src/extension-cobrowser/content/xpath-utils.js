/**
 * Shared XPath helpers for Co-Browser content scripts.
 *
 * Loaded before state-capturer.js and action-executor.js so both scripts can
 * use the same generalization heuristics without module bundling.
 */

(function initCoBrowserXPathUtils(global) {
  const PREFERRED_ATTRS = [
    'data-testid',
    'data-test',
    'data-qa',
    'data-cy',
    'data-component-type',
    'data-component',
    'data-automation-id',
    'aria-label',
    'name',
    'role'
  ];

  const IGNORED_DATA_ATTR_PATTERNS = [
    /^data-react/i,
    /^data-v-/i,
    /^data-ember/i,
    /^data-rh/i,
    /^data-hid$/i,
    /^data-uid$/i,
    /^data-id$/i
  ];

  const ROLE_BLOCKLIST = new Set(['generic', 'presentation', 'none']);

  const XPathUtils = {
    escapeAttrValue(value) {
      const val = String(value ?? '');
      if (!val.includes('"')) return `"${val}"`;
      const parts = val.split('"').map(part => `"${part}"`).join(', \'"\', ');
      return `concat(${parts})`;
    },

    isGeneratedId(id) {
      if (!id) return true;
      if (/^[0-9a-f]{8}-/i.test(id)) return true;
      if (/^[a-z]{1,3}-[a-z0-9]{4,10}$/i.test(id)) return true;
      if (/^_[A-Za-z]+_/.test(id)) return true;
      if (/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{6,20}$/.test(id)) return true;
      return false;
    },

    isStableAttribute(name, value) {
      if (!name || value == null) return false;
      const attrName = String(name).toLowerCase();
      const attrValue = String(value).trim();
      if (!attrValue || attrValue.length < 3 || attrValue.length > 80) return false;
      if (!/[A-Za-z]/.test(attrValue)) return false;
      if (/^\d+$/.test(attrValue)) return false;
      if (this.isGeneratedId(attrValue)) return false;
      if (attrName === 'role' && ROLE_BLOCKLIST.has(attrValue)) return false;
      if (attrName.startsWith('data-')) {
        return !IGNORED_DATA_ATTR_PATTERNS.some(pattern => pattern.test(attrName));
      }
      return true;
    },

    getStableAttributes(element) {
      if (!element || !element.attributes) return [];

      const seen = new Set();
      const attrs = [];

      const pushAttr = (name) => {
        if (seen.has(name)) return;
        const value = element.getAttribute && element.getAttribute(name);
        if (!this.isStableAttribute(name, value)) return;
        seen.add(name);
        attrs.push([name, value]);
      };

      for (const name of PREFERRED_ATTRS) {
        pushAttr(name);
      }

      for (const attr of Array.from(element.attributes)) {
        if (!attr.name.startsWith('data-')) continue;
        pushAttr(attr.name);
      }

      return attrs;
    },

    findSemanticClass(classList) {
      const classes = Array.from(classList || []);
      for (const cls of classes) {
        if (!cls || cls.length < 3) continue;
        if (/^\d+$/.test(cls)) continue;
        if (/^(css-|r-|sg-col|puisg-|sc-|styled-|emotion-|chakra-|tw-|_[A-Z])/.test(cls)) continue;
        if (/^[a-z]{1,3}[A-Z][a-zA-Z0-9]{3,}$/.test(cls) && !/[-_]/.test(cls)) continue;
        return cls;
      }
      return null;
    },

    verifyXPath(xpath, expectedElement) {
      try {
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        return result.snapshotLength === 1 && result.snapshotItem(0) === expectedElement;
      } catch (error) {
        return false;
      }
    },

    getMatchMetadata(xpath, expectedElement) {
      try {
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        let index = -1;
        for (let i = 0; i < result.snapshotLength; i++) {
          if (result.snapshotItem(i) === expectedElement) {
            index = i + 1;
            break;
          }
        }
        return { count: result.snapshotLength, index };
      } catch (error) {
        return { count: 0, index: -1 };
      }
    },

    getClassMatchExpr(className) {
      return `contains(concat(" ", normalize-space(@class), " "), ${this.escapeAttrValue(` ${className} `)})`;
    },

    getPositionalStep(element) {
      const tag = (element.tagName || '*').toLowerCase();
      const parent = element.parentElement;
      if (!parent) return tag;

      const siblings = Array.from(parent.children).filter(
        child => child.tagName === element.tagName
      );
      if (siblings.length <= 1) return tag;

      return `${tag}[${siblings.indexOf(element) + 1}]`;
    },

    getSmartXPath(element, options = {}) {
      if (!element) return '//*';

      const descendantSteps = [];
      let current = element;
      let bestPositionalXPath = null;
      const maxDepth = options.maxDepth || 8;

      for (let depth = 0; depth < maxDepth; depth++) {
        if (!current || current === document.documentElement) break;

        const tag = (current.tagName || '').toLowerCase();
        const isSvg = current.namespaceURI === 'http://www.w3.org/2000/svg';

        if (!isSvg) {
          const id = current.getAttribute && current.getAttribute('id');
          if (id && !this.isGeneratedId(id)) {
            const anchor = `//*[@id=${this.escapeAttrValue(id)}]`;
            const xpath = descendantSteps.length > 0
              ? `${anchor}/${descendantSteps.join('/')}`
              : anchor;
            if (this.verifyXPath(xpath, element)) return xpath;
          }
        }

        if (!isSvg) {
          for (const [attrName, attrValue] of this.getStableAttributes(current)) {
            const baseXPath = `//${tag}[@${attrName}=${this.escapeAttrValue(attrValue)}]`;
            const xpath = descendantSteps.length > 0
              ? `${baseXPath}/${descendantSteps.join('/')}`
              : baseXPath;
            if (this.verifyXPath(xpath, element)) return xpath;

            const { count, index } = this.getMatchMetadata(xpath, element);
            if (count > 1 && count < 10 && index > 0) {
              const posXPath = descendantSteps.length > 0
                ? `//${tag}[@${attrName}=${this.escapeAttrValue(attrValue)}][${index}]/${descendantSteps.join('/')}`
                : `//${tag}[@${attrName}=${this.escapeAttrValue(attrValue)}][${index}]`;
              if (this.verifyXPath(posXPath, element)) return posXPath;
            }
          }
        }

        if (!isSvg && current.classList && current.classList.length > 0) {
          const semanticClass = this.findSemanticClass(current.classList);
          if (semanticClass) {
            const classExpr = this.getClassMatchExpr(semanticClass);
            const baseXPath = `//${tag}[${classExpr}]`;
            const xpath = descendantSteps.length > 0
              ? `${baseXPath}/${descendantSteps.join('/')}`
              : baseXPath;
            const { count, index } = this.getMatchMetadata(xpath, element);

            if (count === 1 && index === 1) {
              return xpath;
            }
            if (count > 1 && count < 10 && index > 0) {
              const posXPath = descendantSteps.length > 0
                ? `//${tag}[${classExpr}][${index}]/${descendantSteps.join('/')}`
                : `//${tag}[${classExpr}][${index}]`;
              if (this.verifyXPath(posXPath, element)) return posXPath;
            }
          }
        }

        const parent = current.parentElement;
        descendantSteps.unshift(this.getPositionalStep(current));

        const positionalXPath = `//${descendantSteps.join('/')}`;
        if (this.verifyXPath(positionalXPath, element)) {
          bestPositionalXPath = positionalXPath;
        }

        current = parent;
      }

      if (bestPositionalXPath) {
        return bestPositionalXPath;
      }
      if (descendantSteps.length > 0) {
        return `//${descendantSteps.join('/')}`;
      }
      return `//${(element.tagName || '*').toLowerCase()}`;
    }
  };

  global.CoBrowserXPathUtils = XPathUtils;
})(typeof globalThis !== 'undefined' ? globalThis : window);
