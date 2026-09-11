"use client";

import Link from "next/link";
import type { KnowledgeFlashcard } from "@/lib/api";
import { topicPalette, type FlashcardPalette } from "@/lib/flashcardVisual";
import FlashcardAnswerMarkdown from "@/components/feed/FlashcardAnswerMarkdown";
import FlashcardKnowledgeChips from "@/components/feed/FlashcardKnowledgeChips";
import FlashcardTrustBadge from "@/components/feed/FlashcardTrustBadge";
import FlashcardVisual from "@/components/feed/FlashcardVisual";
import { normalizeFlashcardFront } from "@/lib/flashcardFormat";

type Props = {
  card: KnowledgeFlashcard;
  flipped: boolean;
  onFlip: () => void;
  onOpenSource?: () => void;
};

export default function FlashcardDeck({ card, flipped, onFlip, onOpenSource }: Props) {
  const palette = (card.visual_palette as FlashcardPalette) || topicPalette(card.topic);
  const frontText = normalizeFlashcardFront(card.front_text);
  const fromOwnCorpus = Boolean(
    card.wiki_file_name && !card.wiki_file_name.startsWith("__") && card.wiki_file_name !== "__demo__",
  );

  const stopFlip = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  };

  return (
    <article className={`fc-deck fc-deck--${palette}${flipped ? " fc-deck--reading" : ""}`}>
      <div className="fc-deck__accent" aria-hidden />

      <header className="fc-deck__meta">
        <FlashcardKnowledgeChips card={card} compact />
        <FlashcardTrustBadge card={card} fromOwnCorpus={fromOwnCorpus} />
      </header>

      <div className="fc-deck__stage">
        {!flipped ? (
          <>
            <div className="fc-deck__visual-band">
              <FlashcardVisual card={card} compact banner />
            </div>
            <section className="fc-face fc-face--front">
              <div className="fc-face__badge-row fc-face__badge-row--minimal">
                <span className="fc-face__side-label">问题</span>
                <button
                  type="button"
                  className="fc-face__reveal"
                  onClick={(e) => {
                    stopFlip(e);
                    onFlip();
                  }}
                  aria-label="显示答案"
                >
                  显示答案
                </button>
              </div>
              <div
                className="fc-face__body fc-face__body--front"
                onClick={onFlip}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onFlip();
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="问题内容，点击查看答案"
              >
                <p className="fc-face__question">{frontText}</p>
              </div>
              <p className="fc-face__hint">轻触翻面 · 空格键 · 左右滑动切换</p>
            </section>
          </>
        ) : (
          <section className="fc-face fc-face--back fc-face--reading" aria-label="答案">
            <div className="fc-face__badge-row fc-face__badge-row--minimal">
              <span className="fc-face__side-label fc-face__side-label--answer">答案</span>
              <button
                type="button"
                className="fc-face__reveal"
                onClick={(e) => {
                  stopFlip(e);
                  onFlip();
                }}
                aria-label="返回问题"
              >
                返回问题
              </button>
            </div>
            <div className="fc-face__body fc-face__body--answer" aria-label="答案内容">
              <FlashcardAnswerMarkdown text={card.back_text} />
            </div>
            {card.source_title || card.source_wiki_url ? (
              <footer className="fc-face__source">
                <span className="fc-face__source-kicker">
                  {fromOwnCorpus ? "你的文库 · 出处" : "出处"}
                </span>
                {card.source_title ? <p className="fc-face__source-title">{card.source_title}</p> : null}
                {card.source_wiki_url ? (
                  <Link
                    href={card.source_wiki_url}
                    className="fc-face__source-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSource?.();
                    }}
                  >
                    查看出处 →
                  </Link>
                ) : null}
              </footer>
            ) : null}
          </section>
        )}
      </div>
    </article>
  );
}
