const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["pendingClip", "apiBase", "apiKey"], (data) => {
  if (data.apiBase) $("api").value = data.apiBase;
  if (data.apiKey) $("key").value = data.apiKey;
  const clip = data.pendingClip;
  if (clip) {
    $("text").value = clip.text || "";
    $("title").value = clip.title || "";
    $("send").dataset.url = clip.url || "";
  }
});

$("send").addEventListener("click", async () => {
  const api = $("api").value.replace(/\/+$/, "");
  const apiKey = $("key").value.trim();
  const text = $("text").value.trim();
  const title = $("title").value.trim() || "网页摘录";
  const url = $("send").dataset.url || "";
  $("msg").textContent = "提交中…";
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${api}/api/v1/clips`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, source_title: title, source_url: url }),
    });
    if (!res.ok) throw new Error(await res.text());
    $("msg").textContent = "已保存到 Knotory 文库";
    chrome.storage.local.set({ apiBase: api, apiKey });
    chrome.storage.local.remove("pendingClip");
  } catch (e) {
    $("msg").textContent = "失败：" + (e.message || e);
  }
});
