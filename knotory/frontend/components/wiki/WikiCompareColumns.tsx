"use client";

import WikiReadingMarkdown from "@/components/wiki/WikiReadingMarkdown";

export type WikiCompareColumnsProps = {
  extractedText: string;
  aiFormattedText: string;
};

/** 抽取正文（左）与 AI 稿（右）同屏对照，便于审计重排差异。 */
export default function WikiCompareColumns({ extractedText, aiFormattedText }: WikiCompareColumnsProps) {
  return (
    <div className="wiki-compare" aria-label="抽取正文与 AI 稿并排对照">
      <div className="wiki-compare__col">
        <p className="wiki-compare__label">抽取正文（raw/*.txt）</p>
        <div className="wiki-compare__scroll">
          <WikiReadingMarkdown markdown={extractedText} className="wiki-reading-surface wiki-compare-prose" />
        </div>
      </div>
      <div className="wiki-compare__col">
        <p className="wiki-compare__label">AI 稿（raw/*.ai.txt）</p>
        <div className="wiki-compare__scroll">
          <WikiReadingMarkdown markdown={aiFormattedText} className="wiki-reading-surface wiki-compare-prose" />
        </div>
      </div>
    </div>
  );
}
