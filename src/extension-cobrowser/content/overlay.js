/**
 * Co-Browser Extension - Overlay Manager
 *
 * This module manages the visual overlay UI elements:
 * - Mode indicator (AI/Human/Shared)
 * - Action overlay (shows what action is being performed)
 * - Handoff notification (prompts user to take action)
 * - Command modal (context menu command input)
 *
 * Note: Core overlay functionality is integrated into content.js
 * This file provides a namespace for overlay utilities and can be
 * extended for advanced overlay features.
 */

const OverlayManager = {
  /**
   * Highlight an element temporarily
   */
  highlightElement(element, duration = 500) {
    if (!element) return;

    const originalOutline = element.style.outline;
    const originalBackground = element.style.backgroundColor;

    element.style.outline = '2px solid #6366f1';
    element.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';

    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.backgroundColor = originalBackground;
    }, duration);
  },

  /**
   * Show a tooltip near an element
   */
  showTooltip(element, text, position = 'top') {
    const tooltip = document.createElement('div');
    tooltip.className = 'cobrowser-tooltip';
    tooltip.textContent = text;

    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    switch (position) {
      case 'top':
        tooltip.style.left = `${rect.left + scrollLeft + rect.width / 2}px`;
        tooltip.style.top = `${rect.top + scrollTop - 30}px`;
        tooltip.style.transform = 'translateX(-50%)';
        break;
      case 'bottom':
        tooltip.style.left = `${rect.left + scrollLeft + rect.width / 2}px`;
        tooltip.style.top = `${rect.bottom + scrollTop + 5}px`;
        tooltip.style.transform = 'translateX(-50%)';
        break;
      case 'left':
        tooltip.style.left = `${rect.left + scrollLeft - 10}px`;
        tooltip.style.top = `${rect.top + scrollTop + rect.height / 2}px`;
        tooltip.style.transform = 'translate(-100%, -50%)';
        break;
      case 'right':
        tooltip.style.left = `${rect.right + scrollLeft + 5}px`;
        tooltip.style.top = `${rect.top + scrollTop + rect.height / 2}px`;
        tooltip.style.transform = 'translateY(-50%)';
        break;
    }

    document.body.appendChild(tooltip);

    return () => {
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    };
  },

  /**
   * Create a visual click indicator
   */
  showClickIndicator(x, y) {
    const indicator = document.createElement('div');
    indicator.className = 'cobrowser-click-indicator';
    indicator.style.left = `${x}px`;
    indicator.style.top = `${y}px`;

    document.body.appendChild(indicator);

    // Animate and remove
    setTimeout(() => {
      indicator.style.transform = 'scale(2)';
      indicator.style.opacity = '0';
    }, 10);

    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 500);
  },

  /**
   * Show typing indicator on an input field
   */
  showTypingIndicator(element) {
    if (!element) return () => {};

    const indicator = document.createElement('div');
    indicator.className = 'cobrowser-typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';

    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    indicator.style.left = `${rect.right + scrollLeft + 5}px`;
    indicator.style.top = `${rect.top + scrollTop + rect.height / 2 - 10}px`;

    document.body.appendChild(indicator);

    return () => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    };
  },

  /**
   * Show scroll indicator
   */
  showScrollIndicator(direction = 'down') {
    const indicator = document.createElement('div');
    indicator.className = 'cobrowser-scroll-indicator';
    indicator.textContent = direction === 'down' ? '↓' : '↑';

    indicator.style.right = '20px';
    indicator.style.top = '50%';
    indicator.style.transform = 'translateY(-50%)';

    document.body.appendChild(indicator);

    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 1000);
  },

  /**
   * Flash the mode indicator
   */
  flashModeIndicator() {
    const indicator = document.getElementById('cobrowser-mode-indicator');
    if (!indicator) return;

    indicator.classList.add('cobrowser-flash');
    setTimeout(() => {
      indicator.classList.remove('cobrowser-flash');
    }, 500);
  }
};

// Export for use in other content scripts
if (typeof window !== 'undefined') {
  window.OverlayManager = OverlayManager;
}
