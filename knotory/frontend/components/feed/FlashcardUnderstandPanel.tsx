"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import MermaidDiagram from "@/components/MermaidDiagram";
import FlashcardAnswerMarkdown from "@/components/feed/FlashcardAnswerMarkdown";
import { fetchFlashcardUnderstanding, type FlashcardUnderstanding } from "@/lib/api";
import { UNDERSTANDING_MODES, type UnderstandingMode } from "@/lib/flashcardUnderstand";
import { normalizeFlashcardFront } from "@/lib/flashcardFormat";
import WaitingProgressBar from "@/components/ui/WaitingProgressBar";

type Props = {
  cardId: number;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onApplyAsCard?: (mode: UnderstandingMode, preview: FlashcardUnderstanding) => void;
  onUnderstandingLoaded?: (preview: FlashcardUnderstanding) => void;
  applyBusy?: boolean;
  highlight?: boolean;
};

export default function FlashcardUnderstandPanel({
  cardId,
  expanded,
  onExpandedChange,
  onApplyAsCard,
  onUnderstandingLoaded,
  applyBusy = false,
  highlight = false,
}: Props) {
  const [activeMode, setActiveMode] = useState<UnderstandingMode | null>(null);
  const [data, setData] = useState<FlashcardUnderstanding | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMode = useCallback(
    async (mode: UnderstandingMode) => {
      setActiveMode(mode);
      setBusy(true);
      setError(null);
      onExpandedChange(true);
      try {
        const result = await fetchFlashcardUnderstanding(cardId, { mode, use_note: true });
        setData(result);
        onUnderstandingLoaded?.(result);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : "生成失败");
      } finally {
        setBusy(false);
      }
    },
    [cardId, onExpandedChange, onUnderstandingLoaded],
  );

  const isExplain = data?.mode === "explain";

  return (
    <section
      className={`fc-understand${expanded ? " fc-understand--open" : ""}${highlight ? " fc-understand--highlight" : ""}`}
      aria-label="换一种更容易懂的讲法"
    >
      <button
        type="button"
        className="fc-understand__toggle"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
      >
        <span className="fc-understand__toggle-title">还是不懂？换种讲法</span>
        <span className="fc-understand__toggle-hint">{expanded ? "收起" : "展开理解辅助"}</span>
      </button>

      {expanded ? (
        <div className="fc-understand__body">
          <p className="fc-understand__lead">
            选一种更容易进入的理解方式，不会丢失原版闪卡。
            <Link href={`/feynman?card=${cardId}`} className="fc-understand__feynman-link">
              或试试费曼讲解
            </Link>
          </p>
          <div className="fc-understand__modes" role="group" aria-label="理解模式">
            {UNDERSTANDING_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`fc-understand__mode${activeMode === m.id ? " fc-understand__mode--active" : ""}`}
                disabled={busy || applyBusy}
                onClick={() => void loadMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>

          {busy ? <WaitingProgressBar active={busy} className="fc-understand__progress" /> : null}
          {error ? (
            <p className="fc-understand__error" role="alert">
              {error}
            </p>
          ) : null}

          {data && !busy ? (
            <div className="fc-understand__result">
              <header className="fc-understand__result-head">
                <span className="fc-understand__result-label">{data.mode_label}</span>
                {data.cached ? <span className="fc-understand__cached">已缓存</span> : null}
              </header>

              {isExplain ? (
                <div className="fc-understand__explain">
                  {data.summary ? <p className="fc-understand__summary">{data.summary}</p> : null}
                  {data.analogy ? (
                    <div className="fc-understand__callout">
                      <span className="fc-understand__callout-kicker">类比</span>
                      <p>{data.analogy}</p>
                    </div>
                  ) : null}
                  {data.key_points && data.key_points.length > 0 ? (
                    <ul className="fc-understand__list">
                      {data.key_points.map((pt) => (
                        <li key={pt}>{pt}</li>
                      ))}
                    </ul>
                  ) : null}
                  {data.why_hard ? (
                    <p className="fc-understand__meta-line">
                      <strong>为何难懂：</strong>
                      {data.why_hard}
                    </p>
                  ) : null}
                  {data.remember_tip ? (
                    <p className="fc-understand__meta-line">
                      <strong>记忆技巧：</strong>
                      {data.remember_tip}
                    </p>
                  ) : null}
                  {onApplyAsCard && activeMode ? (
                    <button
                      type="button"
                      className="btn btn-primary fc-understand__apply"
                      disabled={applyBusy}
                      onClick={() => onApplyAsCard(activeMode, data)}
                    >
                      {applyBusy ? "替换中…" : "用这版替换闪卡"}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="fc-understand__alternate">
                  {data.one_liner ? <p className="fc-understand__one-liner">{data.one_liner}</p> : null}
                  {data.analogy ? (
                    <div className="fc-understand__callout">
                      <span className="fc-understand__callout-kicker">类比</span>
                      <p>{data.analogy}</p>
                    </div>
                  ) : null}
                  {data.question ? (
                    <p className="fc-understand__alt-q">{normalizeFlashcardFront(data.question)}</p>
                  ) : null}
                  {data.answer ? <FlashcardAnswerMarkdown text={data.answer} className="fc-understand__alt-a" /> : null}
                  {data.bullets && data.bullets.length > 0 ? (
                    <ol className="fc-understand__steps">
                      {data.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ol>
                  ) : null}
                  {data.visual_mermaid ? (
                    <div className="fc-understand__diagram">
                      <MermaidDiagram chart={data.visual_mermaid} />
                    </div>
                  ) : null}
                  {onApplyAsCard && activeMode ? (
                    <button
                      type="button"
                      className="btn btn-primary fc-understand__apply"
                      disabled={applyBusy}
                      onClick={() => onApplyAsCard(activeMode, data)}
                    >
                      {applyBusy ? "替换中…" : "用这版替换闪卡"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
