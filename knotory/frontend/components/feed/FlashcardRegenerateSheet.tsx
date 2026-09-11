"use client";

import { useEffect, useRef } from "react";
import { REGENERATE_PRESETS } from "@/lib/flashcardUnderstand";

type Props = {
  open: boolean;
  cardTitle: string;
  value: string;
  busy: boolean;
  error: string | null;
  noteHint?: boolean;
  onChange: (text: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function FlashcardRegenerateSheet({
  open,
  cardTitle,
  value,
  busy,
  error,
  noteHint,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => fieldRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  return (
    <div className="feed-note-sheet" role="dialog" aria-modal="true" aria-labelledby="feed-regen-title">
      <button
        type="button"
        className="feed-note-sheet__backdrop"
        aria-label="关闭"
        disabled={busy}
        onClick={onClose}
      />
      <div className="feed-note-sheet__panel">
        <header className="feed-note-sheet__head">
          <div>
            <h2 id="feed-regen-title" className="feed-note-sheet__title">
              按方向重写
            </h2>
            <p className="feed-note-sheet__sub">{cardTitle}</p>
          </div>
          <button type="button" className="feed-note-sheet__close" disabled={busy} onClick={onClose}>
            取消
          </button>
        </header>
        <div className="feed-regen-sheet__presets" role="group" aria-label="快速方向">
          {REGENERATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="feed-regen-sheet__preset"
              disabled={busy}
              onClick={() => onChange(preset.direction)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <textarea
          ref={fieldRef}
          className="feed-note-sheet__field"
          placeholder="例如：用生活类比、更短一点、面向零基础、多举例子…"
          value={value}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
        />
        {noteHint ? (
          <p className="feed-regen-sheet__hint">将参考你已写的笔记，帮助模型理解你想怎么讲。</p>
        ) : null}
        {error ? (
          <p className="feed-regen-sheet__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn btn-primary feed-regen-sheet__submit" disabled={busy} onClick={onSubmit}>
          {busy ? "重写中…" : "生成新版闪卡"}
        </button>
        <p className="feed-note-sheet__foot">依据原文出处重写，不是摘抄；可多次调整直到看懂。</p>
      </div>
    </div>
  );
}
