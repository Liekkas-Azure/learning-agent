/** 将闪卡正文拆成段落，便于排版展示。 */
export function splitFlashcardParagraphs(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return [raw];
}

/** 去掉首尾中英文引号与书名号式包裹。 */
export function stripEdgeQuotes(text: string): string {
  return (text || "")
    .trim()
    .replace(/^[\s"'「『""''`]+/, "")
    .replace(/[\s"'」』""''`]+$/, "")
    .trim();
}

/** 去掉常见问答前缀，避免正面重复「问：」 */
export function normalizeFlashcardFront(text: string): string {
  return stripEdgeQuotes(
    (text || "")
      .trim()
      .replace(/^(问[：:]\s*|Q[：:]\s*)/i, "")
      .trim(),
  );
}

/** 去掉答案侧常见前缀，保留 Markdown 正文。 */
export function normalizeFlashcardBack(text: string): string {
  return (text || "")
    .trim()
    .replace(/^(答[：:]\s*|A[：:]\s*)/i, "")
    .trim();
}
