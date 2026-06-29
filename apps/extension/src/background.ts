chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Older Chromium builds can throw here; action click still works from the extension menu.
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  await chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
});
