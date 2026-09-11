const MAX_TAG_LEN = 32;

export function normalizeTagName(raw: string): string | null {
  const s = raw
    .normalize("NFKC")
    .replace(/[|;；]+/g, ",")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return null;
  const cleaned = s
    .replace(/^[\s\-–—_:：|,.!?/\\'"“”‘’()（）\[\]【】]+/g, "")
    .replace(/[\s\-–—_:：|,.!?/\\'"“”‘’()（）\[\]【】]+$/g, "")
    .trim();
  if (!cleaned) return null;
  const cut = cleaned.length > MAX_TAG_LEN ? `${cleaned.slice(0, MAX_TAG_LEN)}…` : cleaned;
  return cut;
}

export function parseTagList(input: unknown): string[] {
  if (Array.isArray(input)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of input) {
      if (typeof v !== "string") continue;
      const n = normalizeTagName(v);
      if (!n) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
      if (out.length >= 24) break;
    }
    return out;
  }
  if (typeof input === "string") {
    return parseTagList(
      input
        .split(/[,，、;\n|]/g)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return [];
}
