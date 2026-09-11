const SESSION_KEY = "knotory.feed.session.v1";

export function getFeedSessionId(): string {
  if (typeof window === "undefined") return "default";
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "default";
  }
}
