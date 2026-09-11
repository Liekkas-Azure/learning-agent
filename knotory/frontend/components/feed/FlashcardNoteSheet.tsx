"use client";

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  cardId: number;
  cardTitle: string;
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
};

export default function FlashcardNoteSheet({ open, cardId, cardTitle, value, onChange, onClose }: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => fieldRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, cardId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="feed-note-sheet" role="dialog" aria-modal="true" aria-labelledby="feed-note-title">
      <button type="button" className="feed-note-sheet__backdrop" aria-label="关闭笔记" onClick={onClose} />
      <div className="feed-note-sheet__panel">
        <header className="feed-note-sheet__head">
          <div>
              <h2 id="feed-note-title" className="feed-note-sheet__title">
              刷读笔记
            </h2>
            <p className="feed-note-sheet__sub">{cardTitle}</p>
          </div>
          <button type="button" className="feed-note-sheet__close" onClick={onClose}>
            完成
          </button>
        </header>
        <textarea
          ref={fieldRef}
          id={`feed-note-${cardId}`}
          className="feed-note-sheet__field"
          placeholder="写下困惑或希望的讲法；点「重写」时会参考…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
        />
        <p className="feed-note-sheet__foot">自动保存；可作为「重写」时的方向提示。</p>
      </div>
    </div>
  );
}
