"use client";

import { useEffect, useState } from "react";

const HINTS = [
  "正在生成更易懂的讲法…",
  "正在分析知识点结构…",
  "正在组织更清晰的叙述…",
  "马上就好，请稍候…",
];

type Props = {
  active: boolean;
  label?: string;
  className?: string;
};

/** 未知耗时的 LLM 等待：平滑逼近 92%，完成后消失。 */
export default function WaitingProgressBar({ active, label, className = "" }: Props) {
  const [pct, setPct] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setPct(0);
      setHintIndex(0);
      return;
    }

    setPct(6);
    const started = Date.now();

    const tick = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const next = 92 * (1 - Math.exp(-elapsed / 14000));
      setPct(Math.min(92, Math.max(6, next)));
      setHintIndex(Math.min(HINTS.length - 1, Math.floor(elapsed / 4500)));
    }, 150);

    return () => clearInterval(tick);
  }, [active]);

  if (!active) return null;

  const message = label ?? HINTS[hintIndex];

  return (
    <div className={`wait-progress${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <div className="wait-progress__head">
        <span className="wait-progress__label">{message}</span>
        <span className="wait-progress__pct" aria-hidden>
          {Math.round(pct)}%
        </span>
      </div>
      <div
        className="wait-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={message}
      >
        <div className="wait-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
