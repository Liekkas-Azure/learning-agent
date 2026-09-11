chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "knotory-clip-selection",
    title: "摘录到 Knotory 文库",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "knotory-clip-selection" || !info.selectionText) return;
  chrome.storage.local.set({
    pendingClip: {
      text: info.selectionText,
      title: tab?.title || "",
      url: tab?.url || "",
    },
  });
  chrome.action.openPopup?.();
});
