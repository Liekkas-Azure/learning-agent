"use client";

import { WikiReadingMarkdown } from "@/components/wiki/WikiReadingMarkdown";
import { normalizeFlashcardBack } from "@/lib/flashcardFormat";

type FlashcardAnswerMarkdownProps = {
  text: string;
  className?: string;
};

/** 闪卡答案区：渲染 Markdown，并避免点击链接时触发卡片翻面。 */
export default function FlashcardAnswerMarkdown({ text, className }: FlashcardAnswerMarkdownProps) {
  const markdown = normalizeFlashcardBack(text);
  if (!markdown) return null;

  return (
    <div
      className={["feed-slide__answer-body", "flashcard-answer-md", className].filter(Boolean).join(" ")}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button, input, textarea, pre, code")) {
          e.stopPropagation();
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const target = e.target as HTMLElement;
        if (target.closest("a, button, input, textarea, pre, code")) {
          e.stopPropagation();
        }
      }}
    >
      <WikiReadingMarkdown markdown={markdown} className="flashcard-answer-md__prose" />
    </div>
  );
}
