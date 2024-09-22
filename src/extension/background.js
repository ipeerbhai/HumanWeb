browser.contextMenus.create({
  id: "grab-element",
  title: "Grab Element",
  contexts: ["all"],
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "grab-element") {
    browser.tabs.sendMessage(tab.id, { action: "grabElement" });
  }
});
