"use client";

import { feedReasonMeta, type FeedReason } from "@/lib/flashcardFeedUi";

/** 推荐说明：保存映射 + 复习/薄弱/兴趣等可解释标签 */
const VISIBLE_REASONS = new Set<FeedReason>([
  "saved",
  "review_due",
  "weak_topic",
  "qa_quality",
  "interest",
  "fresh",
  "explore",
  "cold_start",
]);

type Props = {
  text: string;
  reason?: string;
};

export default function FlashcardFeedRationale({ text, reason }: Props) {
  const tone = (reason || "default") as FeedReason;
  if (!text.trim() || !VISIBLE_REASONS.has(tone)) return null;
  const meta = feedReasonMeta(tone);

  return (
    <p
      className={`feed-rationale feed-rationale--${tone}`}
      role="status"
    >
      <span className="feed-rationale__badge" aria-hidden>
        {meta.icon}
      </span>
      <span className="feed-rationale__label">{meta.label}</span>
      <span className="feed-rationale__text">{text}</span>
    </p>
  );
}
