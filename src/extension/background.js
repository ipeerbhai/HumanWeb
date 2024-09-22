// background.js

let BASE_URL = 'http://localhost:8670';

// Create context menu item
chrome.contextMenus.create({
  id: "grab-element",
  title: "Grab Element",
  contexts: ["all"],
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "grab-element") {
    chrome.tabs.sendMessage(tab.id, { action: "grabElement" });
  }
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchAPI') {
    fetch(BASE_URL + request.endpoint, request.options)
      .then(response => response.json())
      .then(data => sendResponse({success: true, data: data}))
      .catch(error => sendResponse({success: false, error: error.toString()}));
    return true;  // Will respond asynchronously
  }
});