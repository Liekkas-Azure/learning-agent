"use client";

import type { FlashcardSyncStatus } from "@/lib/api";
import {
  formatSyncProgressDetail,
  syncProgressPercent,
  syncStageLabel,
} from "@/lib/flashcardSyncUi";

type Props = {
  sync: FlashcardSyncStatus;
  variant?: "inline" | "card";
  showPercent?: boolean;
};

export default function FlashcardSyncProgress({ sync, variant = "card", showPercent = true }: Props) {
  const pct = syncProgressPercent(sync);
  const detail = formatSyncProgressDetail(sync);

  return (
    <div
      className={`flashcard-sync-progress flashcard-sync-progress--${variant}`}
      role="status"
      aria-live="polite"
      aria-busy={sync.running ? "true" : "false"}
    >
      <div className="flashcard-sync-progress__head">
        <span className="flashcard-sync-progress__stage">{syncStageLabel(sync.stage)}</span>
        {showPercent && sync.progress_total ? (
          <span className="flashcard-sync-progress__pct">{pct}%</span>
        ) : null}
        {sync.progress_total ? (
          <span className="flashcard-sync-progress__count">
            {sync.progress_current ?? 0}/{sync.progress_total}
          </span>
        ) : null}
      </div>
      <div
        className="flashcard-sync-progress__track"
        aria-hidden
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="flashcard-sync-progress__fill"
          style={{ width: `${Math.max(pct, sync.running ? 6 : 0)}%` }}
        />
      </div>
      <p className="flashcard-sync-progress__detail">{detail}</p>
      {sync.running ? (
        <p className="flashcard-sync-progress__hint">拆卡完成后会自动更新推荐流，通常需 1～5 分钟</p>
      ) : null}
    </div>
  );
}
