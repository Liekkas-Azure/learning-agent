import type { KnowledgeFlashcard } from "@/lib/api";

export type FeedReason =
  | "review_due"
  | "weak_topic"
  | "interest"
  | "saved"
  | "explore"
  | "fresh"
  | "qa_quality"
  | "cold_start"
  | "demo"
  | "default";

const KIND_META: Record<string, { label: string; tone: string }> = {
  qa: { label: "问答卡", tone: "qa" },
  summary: { label: "摘要卡", tone: "summary" },
  section: { label: "章节卡", tone: "section" },
  contradiction: { label: "对照卡", tone: "contradiction" },
  companion: { label: "伴读卡", tone: "section" },
};

const REASON_META: Record<
  FeedReason,
  { icon: string; label: string }
> = {
  review_due: { icon: "◎", label: "待复习" },
  weak_topic: { icon: "△", label: "薄弱巩固" },
  interest: { icon: "◆", label: "兴趣匹配" },
  saved: { icon: "★", label: "你已保存" },
  explore: { icon: "◇", label: "探索新题" },
  fresh: { icon: "✦", label: "新入库" },
  qa_quality: { icon: "✓", label: "高质量" },
  cold_start: { icon: "○", label: "发现推荐" },
  demo: { icon: "✨", label: "示例体验" },
  default: { icon: "·", label: "为你挑选" },
};

export function cardKindMeta(kind: string) {
  return KIND_META[kind] ?? { label: "知识点", tone: "section" };
}

export function feedReasonMeta(reason?: string) {
  const key = (reason || "default") as FeedReason;
  return REASON_META[key] ?? REASON_META.default;
}

/** 从 section_id 生成可读章节名（wiki-sec-foo-bar → foo bar） */
export function sectionIdToLabel(sectionId: string): string {
  const raw = (sectionId || "").trim();
  if (!raw) return "";
  let s = raw;
  if (s.startsWith("wiki-sec-")) s = s.slice("wiki-sec-".length);
  s = s.replace(/[-_]+/g, " ").trim();
  if (!s || s === "文首") return "开篇";
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

export function knowledgePointTitle(card: KnowledgeFlashcard): string {
  const sec = sectionIdToLabel(card.section_id);
  if (sec) return sec;
  const src = (card.source_title || "").trim();
  if (src && src.length <= 40) return src;
  return card.topic || "知识点";
}

export function topicChips(card: KnowledgeFlashcard, max = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (t: string) => {
    const x = t.trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  push(card.topic);
  for (const t of card.topics ?? []) push(t);
  return out.slice(0, max);
}
