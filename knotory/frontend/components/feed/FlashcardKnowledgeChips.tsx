"use client";

import type { KnowledgeFlashcard } from "@/lib/api";
import { knowledgePointTitle, topicChips } from "@/lib/flashcardFeedUi";

type Props = {
  card: KnowledgeFlashcard;
  compact?: boolean;
};

/** 卡片顶部：仅展示篇目/知识点名，不显示卡种与质量标签 */
export default function FlashcardKnowledgeChips({ card, compact }: Props) {
  const title = knowledgePointTitle(card);
  const extra = topicChips(card, compact ? 1 : 3).filter((t) => t !== card.topic);

  if (compact) {
    return (
      <div className="fc-deck__eyebrow" aria-label="知识点来源">
        <span className="fc-deck__eyebrow-title" title={title}>
          {title}
        </span>
        {extra[0] ? <span className="fc-deck__eyebrow-topic">{extra[0]}</span> : null}
      </div>
    );
  }

  return (
    <div className="feed-knowledge" aria-label="知识点信息">
      <h3 className="feed-knowledge__title feed-knowledge__title--solo" title={title}>
        {title}
      </h3>
      {extra.length ? (
        <div className="feed-knowledge__topics" aria-label="相关主题">
          {extra.map((t) => (
            <span key={t} className="feed-knowledge__chip">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
