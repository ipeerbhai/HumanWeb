/**
 * Co-Browser Extension - Options Script
 */

// Default settings
const DEFAULTS = {
  serviceUrl: 'ws://localhost:8677',
  autoConnect: true,
  autoHandoffLogin: true,
  autoHandoffPayment: true,
  autoHandoffCaptcha: true,
  handoffTimeout: 60,
  commandTimeout: 30
};

// UI Elements
const serviceUrl = document.getElementById('service-url');
const autoConnect = document.getElementById('auto-connect');
const autoHandoffLogin = document.getElementById('auto-handoff-login');
const autoHandoffPayment = document.getElementById('auto-handoff-payment');
const autoHandoffCaptcha = document.getElementById('auto-handoff-captcha');
const handoffTimeout = document.getElementById('handoff-timeout');
const commandTimeout = document.getElementById('command-timeout');
const saveBtn = document.getElementById('save-btn');
const savedMessage = document.getElementById('saved-message');

/**
 * Load settings from storage
 */
async function loadSettings() {
  const result = await browser.storage.sync.get('cobrowser_settings');
  const settings = result.cobrowser_settings || DEFAULTS;

  serviceUrl.value = settings.serviceUrl || DEFAULTS.serviceUrl;
  autoConnect.checked = settings.autoConnect ?? DEFAULTS.autoConnect;
  autoHandoffLogin.checked = settings.autoHandoffLogin ?? DEFAULTS.autoHandoffLogin;
  autoHandoffPayment.checked = settings.autoHandoffPayment ?? DEFAULTS.autoHandoffPayment;
  autoHandoffCaptcha.checked = settings.autoHandoffCaptcha ?? DEFAULTS.autoHandoffCaptcha;
  handoffTimeout.value = settings.handoffTimeout ?? DEFAULTS.handoffTimeout;
  commandTimeout.value = settings.commandTimeout ?? DEFAULTS.commandTimeout;
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  const settings = {
    serviceUrl: serviceUrl.value,
    autoConnect: autoConnect.checked,
    autoHandoffLogin: autoHandoffLogin.checked,
    autoHandoffPayment: autoHandoffPayment.checked,
    autoHandoffCaptcha: autoHandoffCaptcha.checked,
    handoffTimeout: parseInt(handoffTimeout.value, 10),
    commandTimeout: parseInt(commandTimeout.value, 10)
  };

  await browser.storage.sync.set({ cobrowser_settings: settings });

  // Show saved message
  savedMessage.style.display = 'inline';
  setTimeout(() => {
    savedMessage.style.display = 'none';
  }, 2000);

  // Notify background script
  browser.runtime.sendMessage({ type: 'settings.updated', settings });
}

// Event listeners
saveBtn.addEventListener('click', saveSettings);

// Load settings on page load
loadSettings();
