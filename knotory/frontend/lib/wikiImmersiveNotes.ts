const STORAGE_KEY = "knotory.wiki.immersive-notes.v1";

type NotesStoreV1 = {
  v: 1;
  /** wikiFileName -> sectionId -> note text */
  byDoc: Record<string, Record<string, string>>;
};

function emptyStore(): NotesStoreV1 {
  return { v: 1, byDoc: {} };
}

function readStore(): NotesStoreV1 {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw) as Partial<NotesStoreV1>;
    if (p?.v !== 1 || typeof p.byDoc !== "object" || p.byDoc == null) return emptyStore();
    return { v: 1, byDoc: p.byDoc as Record<string, Record<string, string>> };
  } catch {
    return emptyStore();
  }
}

export function loadImmersiveNotesForDoc(wikiFileName: string): Record<string, string> {
  const doc = wikiFileName.trim();
  if (!doc) return {};
  const s = readStore();
  return { ...(s.byDoc[doc] ?? {}) };
}

/** 写入整本文档的章节笔记（已去掉空串的节可省略） */
export function persistImmersiveNotesForDoc(wikiFileName: string, notes: Record<string, string>): void {
  const doc = wikiFileName.trim();
  if (!doc || typeof window === "undefined") return;
  const s = readStore();
  const cleaned: Record<string, string> = {};
  for (const [sectionId, text] of Object.entries(notes)) {
    if (text.trim()) cleaned[sectionId] = text;
  }
  if (Object.keys(cleaned).length === 0) delete s.byDoc[doc];
  else s.byDoc[doc] = cleaned;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota 等忽略 */
  }
}
