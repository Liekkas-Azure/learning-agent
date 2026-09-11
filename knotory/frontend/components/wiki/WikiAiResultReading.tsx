"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import WikiImmersiveReader from "@/components/wiki/WikiImmersiveReader";
import WikiReadingMarkdown from "@/components/wiki/WikiReadingMarkdown";
import type { ReadingCorpusSnippet } from "@/lib/api";

export type WikiRelatedItem = {
  otherId: number;
  fileName: string;
  slug: string;
  shared: string[];
  themes: string[];
};

export type WikiAiResultReadingProps = {
  markdown: string;
  related: WikiRelatedItem[];
  onOpenWiki: (wikiMdName: string) => void;
  /** 在双栏对照的右栏打开该篇；提供时相关列表会显示「右栏」 */
  onOpenWikiInSecondary?: (wikiMdName: string) => void;
  wikiFileName: string;
  docTitle: string;
  corpusSnippets: ReadingCorpusSnippet[];
  extractedRawText?: string | null;
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export default function WikiAiResultReading({
  markdown,
  related,
  onOpenWiki,
  onOpenWikiInSecondary,
  wikiFileName,
  docTitle,
  corpusSnippets,
  extractedRawText,
}: WikiAiResultReadingProps) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const tagOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of related) {
      for (const t of r.shared) {
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([t]) => t);
  }, [related]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return related.filter((r) => {
      if (tagFilters.size > 0) {
        const hitTag = r.shared.some((t) => tagFilters.has(t));
        if (!hitTag) return false;
      }
      if (!q) return true;
      if (normalize(r.fileName).includes(q)) return true;
      if (r.shared.some((t) => normalize(t).includes(q))) return true;
      if (r.themes.some((t) => normalize(t).includes(q))) return true;
      return false;
    });
  }, [related, query, tagFilters]);

  const toggleTag = useCallback((tag: string) => {
    setTagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setTagFilters(new Set());
    setExpandedId(null);
  }, []);

  useEffect(() => {
    if (!panelOpen) {
      setExpandedId(null);
    }
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const [immersiveOpen, setImmersiveOpen] = useState(false);

  const panel = panelOpen ? (
    <div className="wiki-ai-neighbors-root" role="presentation">
      <button
        type="button"
        className="wiki-ai-neighbors-backdrop"
        aria-label="关闭相关文档面板"
        onClick={() => setPanelOpen(false)}
      />
      <div
        className="wiki-ai-neighbors-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="wiki-ai-neighbors-panel__head">
          <div>
            <h2 id={titleId} className="wiki-ai-neighbors-panel__title">
              相关文档
            </h2>
            <p className="wiki-ai-neighbors-panel__lede">
              与当前文档有相同标签或相近主题。可搜索、按标签筛选，再打开其他篇对照阅读。
            </p>
          </div>
          <button type="button" className="wiki-ai-neighbors-panel__close" onClick={() => setPanelOpen(false)} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="wiki-ai-neighbors-panel__controls">
          <label className="wiki-ai-neighbors-search">
            <span className="wiki-ai-neighbors-search__label">搜索</span>
            <input
              ref={searchRef}
              type="search"
              className="wiki-ai-neighbors-search__input"
              placeholder="文件名、标签或主题…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </label>
          {tagOptions.length > 0 ? (
            <div className="wiki-ai-neighbors-filters" aria-label="按共同标签筛选">
              <span className="wiki-ai-neighbors-filters__label">标签</span>
              <div className="wiki-ai-neighbors-filters__chips">
                {tagOptions.map((tag) => {
                  const on = tagFilters.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`wiki-ai-neighbors-filter-chip${on ? " wiki-ai-neighbors-filter-chip--on" : ""}`}
                      aria-pressed={on}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {(query.trim() || tagFilters.size > 0) && (
            <button type="button" className="btn btn-ghost wiki-ai-neighbors-clear" onClick={clearFilters}>
              清除筛选
            </button>
          )}
        </div>

        <div className="wiki-ai-neighbors-panel__body">
          {related.length === 0 ? (
            <p className="wiki-ai-neighbors-empty">
              暂无相关文档。多导入几篇，或给多篇打上相同标签、主题后，这里会出现列表。
            </p>
          ) : filtered.length === 0 ? (
            <p className="wiki-ai-neighbors-empty">没有符合当前条件的文档，请放宽搜索或去掉部分标签。</p>
          ) : (
            <ul className="wiki-ai-neighbors-list">
              {filtered.map((r) => {
                const open = expandedId === r.otherId;
                return (
                  <li key={r.otherId} className="wiki-ai-neighbors-item">
                    <div className="wiki-ai-neighbors-item__row">
                      <button
                        type="button"
                        className="wiki-ai-neighbors-item__primary"
                        onClick={() => {
                          setPanelOpen(false);
                          onOpenWiki(`${r.slug}.md`);
                        }}
                      >
                        <span className="wiki-ai-neighbors-item__name">{r.fileName}</span>
                        <span className="wiki-ai-neighbors-item__cta">打开</span>
                      </button>
                      {onOpenWikiInSecondary ? (
                        <button
                          type="button"
                          className="wiki-ai-neighbors-item__split"
                          title="在右栏对照打开"
                          onClick={() => {
                            setPanelOpen(false);
                            onOpenWikiInSecondary(`${r.slug}.md`);
                          }}
                        >
                          右栏
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="wiki-ai-neighbors-item__expand"
                        aria-expanded={open}
                        aria-controls={`neighbor-detail-${r.otherId}`}
                        onClick={() => setExpandedId(open ? null : r.otherId)}
                      >
                        {open ? "收起" : "关联说明"}
                      </button>
                    </div>
                    {!open && (r.shared.length > 0 || r.themes.length > 0) ? (
                      <p className="wiki-ai-neighbors-item__peek" title={[...r.shared, ...r.themes].join(" · ")}>
                        {r.shared.length > 0 ? (
                          <span>
                            共同标签 <em>{r.shared.slice(0, 3).join("、")}</em>
                            {r.shared.length > 3 ? ` 等共 ${r.shared.length} 个` : ""}
                          </span>
                        ) : null}
                        {r.shared.length > 0 && r.themes.length > 0 ? <span aria-hidden> · </span> : null}
                        {r.themes.length > 0 ? (
                          <span>
                            主题 <em>{r.themes.slice(0, 2).join("、")}</em>
                            {r.themes.length > 2 ? "…" : ""}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {open ? (
                      <div id={`neighbor-detail-${r.otherId}`} className="wiki-ai-neighbors-item__detail">
                        {r.shared.length > 0 ? (
                          <div className="wiki-ai-neighbors-item__block">
                            <span className="wiki-ai-neighbors-item__block-label">共同标签</span>
                            <div className="wiki-ai-neighbors-item__chips">
                              {r.shared.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  className="wiki-ai-neighbors-mini-chip"
                                  onClick={() => {
                                    setTagFilters(new Set([t]));
                                    setQuery("");
                                  }}
                                >
                                  只看「{t}」
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {r.themes.length > 0 ? (
                          <div className="wiki-ai-neighbors-item__block">
                            <span className="wiki-ai-neighbors-item__block-label">主题</span>
                            <div className="wiki-ai-neighbors-item__chips wiki-ai-neighbors-item__chips--semantic">
                              {r.themes.map((t) => (
                                <span key={t} className="wiki-ai-chip wiki-ai-chip--semantic">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <p className="wiki-ai-neighbors-item__foot">打开后可在上方切换「原稿 / AI 稿」，对照当前这篇。</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="wiki-ai-reading">
      <div className="wiki-ai-reading__actions">
      <div className="wiki-ai-reading__actions-row">
        <button
          type="button"
          className="btn btn-secondary wiki-ai-neighbors-trigger"
          onClick={() => setPanelOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
        >
          <span className="wiki-ai-neighbors-trigger__label">相关文档</span>
          {related.length > 0 ? (
            <span className="wiki-ai-neighbors-trigger__count" aria-hidden>
              {related.length}
            </span>
          ) : (
            <span className="wiki-ai-neighbors-trigger__count wiki-ai-neighbors-trigger__count--dim" aria-hidden>
              0
            </span>
          )}
        </button>
        <button type="button" className="btn btn-secondary wiki-ai-immersive-btn" onClick={() => setImmersiveOpen(true)}>
          全屏阅读
        </button>
      </div>
        <p className="wiki-ai-reading__actions-hint">
          相关文档里可点「打开」换到左栏，或点「右栏」并排对照。全屏阅读为三栏：目录、正文、右侧预生成导读。
        </p>
      </div>
      <div className="wiki-ai-reading__main">
        <WikiReadingMarkdown markdown={markdown} className="wiki-reading-surface wiki-ai-prose" />
      </div>
      <WikiImmersiveReader
        open={immersiveOpen}
        onClose={() => setImmersiveOpen(false)}
        markdown={markdown}
        wikiFileName={wikiFileName}
        docTitle={docTitle}
        corpusSnippets={corpusSnippets}
        extractedRawText={extractedRawText}
      />
      {typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}
