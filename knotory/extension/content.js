document.addEventListener("mouseup", () => {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : "";
  if (text.length >= 8) {
    chrome.storage.local.set({
      pendingClip: { text, title: document.title, url: location.href },
    });
  }
});
