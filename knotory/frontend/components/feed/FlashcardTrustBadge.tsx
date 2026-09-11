"use client";

import type { KnowledgeFlashcard } from "@/lib/api";

const KIND_LABELS: Record<string, string> = {
  qa: "问答卡",
  summary: "摘要卡",
  section: "章节卡",
  contradiction: "对照卡",
  companion: "伴读卡",
};

function parseMeta(raw?: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function FlashcardTrustBadge({
  card,
  fromOwnCorpus = false,
}: {
  card: KnowledgeFlashcard;
  fromOwnCorpus?: boolean;
}) {
  const flags = (card.quality_flags || "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const meta = parseMeta(card.generation_meta);
  const kind = String(meta.card_kind || card.card_kind || "");
  const score = card.quality_score ?? 1;
  const kindLabel = KIND_LABELS[kind] || (kind ? "知识点卡" : "");
  const regenMode = String(meta.understanding_mode || meta.direction || "").trim();

  if (!flags.length && !kindLabel && score >= 0.99 && !fromOwnCorpus && !regenMode) return null;

  const showScore = score < 0.92 || flags.includes("template");

  return (
    <div className="feed-trust" aria-label="卡片来源与质量">
      {fromOwnCorpus ? (
        <span className="feed-trust__pill feed-trust__pill--own" title="由你上传的材料生成">
          你的材料
        </span>
      ) : null}
      {showScore ? (
        <span className="feed-trust__score" title="生成质量估计">
          质量 {(score * 100).toFixed(0)}%
        </span>
      ) : null}
      {kindLabel ? <span className="feed-trust__pill">{kindLabel}</span> : null}
      {regenMode ? (
        <span className="feed-trust__pill feed-trust__pill--pref" title="已按你的讲法偏好调整">
          已调讲法
        </span>
      ) : null}
      {flags.map((f) => (
        <span key={f} className="feed-trust__pill feed-trust__pill--warn">
          {f === "template" ? "模板生成" : f === "bad_card" ? "已标难懂" : f}
        </span>
      ))}
    </div>
  );
}
