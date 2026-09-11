"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type FloaterPos = { x: number; y: number };

export type TextSelectionCopyHostProps = {
  /** 写入剪贴板时的来源说明（如 wiki 文件名） */
  docLabel: string;
  children: ReactNode;
};

/**
 * 在阅读容器内划选文本后，在选区附近显示「复制摘录」，写入剪贴板为带来源前缀的纯文本。
 * iframe 内 PDF 的选区无法被外层捕获，仅对当前 DOM 内正文生效。
 */
export default function TextSelectionCopyHost({ docLabel, children }: TextSelectionCopyHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [floater, setFloater] = useState<FloaterPos | null>(null);
  const [snippet, setSnippet] = useState("");

  const hide = useCallback(() => {
    setFloater(null);
    setSnippet("");
  }, []);

  useEffect(() => {
    hide();
  }, [docLabel, hide]);

  const onMouseUp = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hide();
      return;
    }
    const text = sel.toString().replace(/\u00a0/g, " ").trim();
    if (!text) {
      hide();
      return;
    }
    const anchor = sel.anchorNode;
    if (!anchor || !host.contains(anchor)) {
      hide();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setFloater({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
    setSnippet(text);
  }, [hide]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.addEventListener("mouseup", onMouseUp);
    return () => host.removeEventListener("mouseup", onMouseUp);
  }, [onMouseUp]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scroller = host.closest(".wiki-reading-panel__scroller");
    const onScroll = () => hide();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller?.removeEventListener("scroll", onScroll);
  }, [hide]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && hostRef.current?.contains(t)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest(".text-selection-floater")) return;
      hide();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [hide]);

  const copyExcerpt = useCallback(async () => {
    const label = docLabel.trim();
    const body = snippet.trim();
    if (!body) return;
    const block = label ? `【摘录自 ${label}】\n${body}\n` : `${body}\n`;
    try {
      await navigator.clipboard.writeText(block);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = block;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* ignore */
      }
    }
    hide();
    window.getSelection()?.removeAllRanges();
  }, [docLabel, snippet, hide]);

  return (
    <div ref={hostRef} className="text-selection-host">
      {children}
      {floater ? (
        <div
          className="text-selection-floater"
          style={{ left: floater.x, top: floater.y }}
          role="toolbar"
          aria-label="摘录操作"
        >
          <button type="button" className="btn btn-secondary text-selection-floater__btn" onClick={() => void copyExcerpt()}>
            复制摘录
          </button>
        </div>
      ) : null}
    </div>
  );
}
