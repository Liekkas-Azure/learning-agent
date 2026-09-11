"use client";

import { useState } from "react";
import MermaidDiagram from "@/components/MermaidDiagram";
import { flashcardImageSrc, type KnowledgeFlashcard } from "@/lib/api";
import { topicEmoji, topicPalette, type FlashcardPalette } from "@/lib/flashcardVisual";

type Props = {
  card: KnowledgeFlashcard;
  compact?: boolean;
  /** 超窄顶栏：问题面仅保留主题色带 */
  banner?: boolean;
};

export default function FlashcardVisual({ card, compact, banner }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const palette = (card.visual_palette as FlashcardPalette) || topicPalette(card.topic);
  const emoji = card.visual_emoji || topicEmoji(card.topic);
  const mermaid = (card.visual_mermaid || "").trim();
  const imageSrc = flashcardImageSrc(card.visual_image_url);
  const showPhoto = Boolean(imageSrc) && !imageFailed;

  if (banner) {
    return (
      <div className={`feed-visual feed-visual--${palette} feed-visual--banner`} aria-hidden>
        <span className="feed-visual__banner-emoji">{emoji}</span>
        <span className="feed-visual__banner-topic">{card.topic}</span>
        {card.visual_caption ? (
          <span className="feed-visual__banner-caption">{card.visual_caption}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`feed-visual feed-visual--${palette}${compact ? " feed-visual--compact" : ""}`}>
      {showPhoto ? (
        <div className="feed-visual__photo-wrap">
          <img
            src={imageSrc}
            alt={card.visual_caption || card.topic}
            className="feed-visual__photo"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
          {card.visual_caption ? <p className="feed-visual__caption feed-visual__caption--on-photo">{card.visual_caption}</p> : null}
        </div>
      ) : (
        <div className="feed-visual__hero" aria-hidden>
          <span className="feed-visual__emoji">{emoji}</span>
          <span className="feed-visual__topic">{card.topic}</span>
          {imageFailed ? <span className="feed-visual__fallback-hint">配图不可用，已显示主题符号</span> : null}
        </div>
      )}
      {mermaid && !showPhoto ? (
        <div className="feed-visual__diagram">
          <MermaidDiagram chart={mermaid} className="feed-visual__mermaid" />
          {card.visual_caption ? <p className="feed-visual__caption">{card.visual_caption}</p> : null}
        </div>
      ) : null}
      {!showPhoto && !mermaid ? (
        <p className="feed-visual__caption feed-visual__caption--solo">{card.visual_caption || "主题概览"}</p>
      ) : null}
    </div>
  );
}
