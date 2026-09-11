"use client";

type Props = {
  saved: boolean;
  noteActive: boolean;
  regenBusy?: boolean;
  onSkip: () => void;
  onKnow: () => void;
  onNote: () => void;
  onSave: () => void;
  onRegenerate: () => void;
  onBad: () => void;
  onShare?: () => void;
  shareBusy?: boolean;
};

export default function FlashcardActions({
  saved,
  noteActive,
  regenBusy = false,
  onSkip,
  onKnow,
  onNote,
  onSave,
  onRegenerate,
  onBad,
  onShare,
  shareBusy = false,
}: Props) {
  return (
    <div className="fc-actions" role="toolbar" aria-label="闪卡操作">
      <div className="fc-actions__primary">
        <button type="button" className="fc-actions__main fc-actions__main--skip" onClick={onSkip} aria-label="跳过">
          <span className="fc-actions__icon" aria-hidden>
            ←
          </span>
          <span className="fc-actions__label">跳过</span>
        </button>
        <button type="button" className="fc-actions__main fc-actions__main--know" onClick={onKnow} aria-label="掌握">
          <span className="fc-actions__icon" aria-hidden>
            ✓
          </span>
          <span className="fc-actions__label">掌握</span>
        </button>
      </div>
      <div className="fc-actions__secondary">
        <button
          type="button"
          className={`fc-actions__chip${noteActive ? " fc-actions__chip--active" : ""}`}
          onClick={onNote}
          aria-label="笔记"
        >
          笔记
        </button>
        <button
          type="button"
          className="fc-actions__chip fc-actions__chip--regen"
          onClick={onRegenerate}
          disabled={regenBusy}
          aria-label="按方向重写"
        >
          {regenBusy ? "重写中…" : "重写"}
        </button>
        <button
          type="button"
          className={`fc-actions__chip${saved ? " fc-actions__chip--saved" : ""}`}
          onClick={onSave}
          aria-label="保存"
          title="搞懂后保存；相关内容再来时会优先弹出这张卡"
        >
          {saved ? "已保存" : "保存"}
        </button>
        <button type="button" className="fc-actions__chip fc-actions__chip--muted" onClick={onBad} aria-label="看不懂，换种讲法" title="展开理解辅助，快速生成生活类比、分步骤等讲法">
          不懂
        </button>
        {onShare ? (
          <button
            type="button"
            className="fc-actions__chip"
            onClick={onShare}
            disabled={shareBusy}
            aria-label="复制分享"
            title="生成分享图 + 文案，便于发小红书 / 朋友圈"
          >
            {shareBusy ? "…" : "分享"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
