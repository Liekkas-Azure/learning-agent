const STORAGE_KEY = "knotory.flashcard.notes.v1";

type NotesStoreV1 = {
  v: 1;
  /** flashcard id -> note text */
  byCard: Record<string, string>;
};

function emptyStore(): NotesStoreV1 {
  return { v: 1, byCard: {} };
}

function readStore(): NotesStoreV1 {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw) as Partial<NotesStoreV1>;
    if (p?.v !== 1 || typeof p.byCard !== "object" || p.byCard == null) return emptyStore();
    return { v: 1, byCard: p.byCard as Record<string, string> };
  } catch {
    return emptyStore();
  }
}

export function loadFlashcardNote(cardId: number): string {
  if (!cardId) return "";
  const s = readStore();
  return s.byCard[String(cardId)] ?? "";
}

export function persistFlashcardNote(cardId: number, text: string): void {
  if (!cardId || typeof window === "undefined") return;
  const s = readStore();
  const key = String(cardId);
  const trimmed = text.trim();
  if (!trimmed) delete s.byCard[key];
  else s.byCard[key] = text;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota */
  }
}

export function hasFlashcardNote(cardId: number): boolean {
  return loadFlashcardNote(cardId).trim().length > 0;
}
