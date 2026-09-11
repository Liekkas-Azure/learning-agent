"use client";

type Props = {
  current: number;
  total: number;
  hasMore?: boolean;
};

export default function FlashcardProgress({ current, total, hasMore }: Props) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="fc-progress fc-progress--minimal" aria-label={`进度 ${current} / ${total}`}>
      <span className="fc-progress__count">
        <strong>{current}</strong>
        <span className="fc-progress__sep">/</span>
        {total}
        {hasMore ? "+" : ""}
      </span>
      <div
        className="fc-progress__track"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={1}
        aria-valuemax={total}
      >
        <span className="fc-progress__fill" style={{ width: `${Math.max(6, pct)}%` }} />
      </div>
    </div>
  );
}
