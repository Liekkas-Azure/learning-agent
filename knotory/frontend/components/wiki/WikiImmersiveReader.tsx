"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchReadingCompanionBundle, refreshReadingCompanionBundle, type ReadingCompanionBundle, type ReadingCorpusSnippet } from "@/lib/api";
import { splitMarkdownIntoSections, type MarkdownSection } from "@/lib/markdownSections";
import { loadImmersiveNotesForDoc, persistImmersiveNotesForDoc } from "@/lib/wikiImmersiveNotes";
import WikiReadingMarkdown from "@/components/wiki/WikiReadingMarkdown";

function findDominantSectionId(
  main: HTMLElement,
  sections: MarkdownSection[],
  sectionEls: Map<string, HTMLElement>,
): string | null {
  const mr = main.getBoundingClientRect();
  const focalY = mr.top + Math.min(mr.height * 0.26, 200);
  let best: { id: string; dist: number } | null = null;
  for (const s of sections) {
    const el = sectionEls.get(s.id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= mr.top + 2 || r.top >= mr.bottom - 2) continue;
    const mid = (r.top + r.bottom) / 2;
    const dist = Math.abs(mid - focalY);
    if (!best || dist < best.dist) best = { id: s.id, dist };
  }
  return best?.id ?? null;
}

type CompanionState = {
  status: "idle" | "loading" | "done" | "error";
  text?: string;
  provider?: string;
  err?: string;
};

export type WikiImmersiveReaderProps = {
  open: boolean;
  onClose: () => void;
  markdown: string;
  wikiFileName: string;
  docTitle: string;
  corpusSnippets: ReadingCorpusSnippet[];
  /** 已拉取的 raw/*.txt 全文抽取，随请求传给后端（可省一次磁盘读） */
  extractedRawText?: string | null;
};

export default function WikiImmersiveReader({
  open,
  onClose,
  markdown,
  wikiFileName,
  docTitle,
  corpusSnippets: _corpusSnippets,
  extractedRawText: _extractedRawText,
}: WikiImmersiveReaderProps) {
  const centerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const sectionElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const ratiosRef = useRef<Record<string, number>>({});
  const [companion, setCompanion] = useState<Record<string, CompanionState>>({});
  const [tocActiveId, setTocActiveId] = useState<string | null>(null);
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({});
  const sectionNotesRef = useRef<Record<string, string>>({});
  const notesPersistTimerRef = useRef<number | null>(null);
  const immersiveWikiFileRef = useRef(wikiFileName);

  const sections = useMemo(() => splitMarkdownIntoSections(markdown), [markdown]);

  const schedulePersistSectionNotes = useCallback(() => {
    if (notesPersistTimerRef.current != null) clearTimeout(notesPersistTimerRef.current);
    notesPersistTimerRef.current = window.setTimeout(() => {
      notesPersistTimerRef.current = null;
      persistImmersiveNotesForDoc(immersiveWikiFileRef.current, sectionNotesRef.current);
    }, 480);
  }, []);

  const updateSectionNote = useCallback(
    (sectionId: string, text: string) => {
      setSectionNotes((prev) => {
        const next = { ...prev, [sectionId]: text };
        sectionNotesRef.current = next;
        return next;
      });
      schedulePersistSectionNotes();
    },
    [schedulePersistSectionNotes],
  );

  useEffect(() => {
    if (notesPersistTimerRef.current != null) {
      clearTimeout(notesPersistTimerRef.current);
      notesPersistTimerRef.current = null;
    }

    if (!open) {
      persistImmersiveNotesForDoc(immersiveWikiFileRef.current, sectionNotesRef.current);
      immersiveWikiFileRef.current = wikiFileName;
      const closedLoaded = loadImmersiveNotesForDoc(wikiFileName);
      setSectionNotes(closedLoaded);
      sectionNotesRef.current = closedLoaded;
      return;
    }

    const prevDoc = immersiveWikiFileRef.current;
    if (prevDoc.trim() && prevDoc !== wikiFileName) {
      persistImmersiveNotesForDoc(prevDoc, sectionNotesRef.current);
    }
    immersiveWikiFileRef.current = wikiFileName;
    const loaded = loadImmersiveNotesForDoc(wikiFileName);
    setSectionNotes(loaded);
    sectionNotesRef.current = loaded;
  }, [open, wikiFileName]);

  const lastDominantForRightRef = useRef<string | null>(null);
  const mainScrollSyncRafRef = useRef<number | null>(null);
  const companionSlowTimerRef = useRef<number | null>(null);
  const [companionSlowHint, setCompanionSlowHint] = useState(false);
  const [refreshingCompanions, setRefreshingCompanions] = useState(false);

  useEffect(() => {
    if (!open) {
      if (companionSlowTimerRef.current != null) {
        clearTimeout(companionSlowTimerRef.current);
        companionSlowTimerRef.current = null;
      }
      setCompanionSlowHint(false);
      return;
    }
    setCompanionSlowHint(false);
    if (companionSlowTimerRef.current != null) {
      clearTimeout(companionSlowTimerRef.current);
    }
    companionSlowTimerRef.current = window.setTimeout(() => {
      companionSlowTimerRef.current = null;
      setCompanionSlowHint(true);
    }, 42000);
    return () => {
      if (companionSlowTimerRef.current != null) {
        clearTimeout(companionSlowTimerRef.current);
        companionSlowTimerRef.current = null;
      }
    };
  }, [open, wikiFileName, markdown]);

  const scrollRightToCompanionCard = useCallback((sectionId: string) => {
    const right = rightRef.current;
    if (!right) return;
    const sel = `[data-companion-section="${CSS.escape(sectionId)}"]`;
    const card = right.querySelector(sel) as HTMLElement | null;
    if (!card) return;
    const pad = 8;
    const cardTopInScroll =
      card.getBoundingClientRect().top - right.getBoundingClientRect().top + right.scrollTop;
    const maxScroll = Math.max(0, right.scrollHeight - right.clientHeight);
    const target = Math.max(0, Math.min(cardTopInScroll - pad, maxScroll));
    right.scrollTop = target;
  }, []);

  const scheduleSyncRightFromMainScroll = useCallback(() => {
    if (mainScrollSyncRafRef.current != null) return;
    mainScrollSyncRafRef.current = requestAnimationFrame(() => {
      mainScrollSyncRafRef.current = null;
      const main = centerRef.current;
      if (!main || sections.length === 0) return;
      const id = findDominantSectionId(main, sections, sectionElsRef.current);
      if (!id || id === lastDominantForRightRef.current) return;
      lastDominantForRightRef.current = id;
      scrollRightToCompanionCard(id);
    });
  }, [sections, scrollRightToCompanionCard]);

  useLayoutEffect(() => {
    if (!open) return;
    lastDominantForRightRef.current = null;
    const raf = requestAnimationFrame(() => {
      const main = centerRef.current;
      if (!main || sections.length === 0) return;
      const id = findDominantSectionId(main, sections, sectionElsRef.current);
      if (id) {
        lastDominantForRightRef.current = id;
        scrollRightToCompanionCard(id);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, sections, markdown, scrollRightToCompanionCard]);

  useEffect(() => {
    if (!open) {
      if (mainScrollSyncRafRef.current != null) {
        cancelAnimationFrame(mainScrollSyncRafRef.current);
        mainScrollSyncRafRef.current = null;
      }
      setCompanion({});
      setTocActiveId(null);
      ratiosRef.current = {};
      sectionElsRef.current.clear();
      lastDominantForRightRef.current = null;
      return;
    }
    setCompanion({});
    setTocActiveId(null);
    ratiosRef.current = {};
    sectionElsRef.current.clear();
    lastDominantForRightRef.current = null;
  }, [open, markdown]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const root = centerRef.current;
    if (!root || sections.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const id = (en.target as HTMLElement).dataset.sectionId;
          if (!id) continue;
          ratiosRef.current[id] = en.intersectionRatio;
        }

        let bestId: string | null = null;
        let bestR = -1;
        for (const s of sections) {
          const r = ratiosRef.current[s.id] ?? 0;
          if (r > bestR) {
            bestR = r;
            bestId = s.id;
          }
        }
        if (bestId != null && bestR >= 0.12) setTocActiveId(bestId);
      },
      { root, rootMargin: "0px", threshold: [0, 0.06, 0.12, 0.2, 0.35, 0.55, 0.85, 1] },
    );

    sectionElsRef.current.forEach((el) => {
      if (el) io.observe(el);
    });

    return () => io.disconnect();
  }, [open, sections, markdown]);

  const applyCompanionBundle = useCallback((bundle: ReadingCompanionBundle) => {
    setCompanion(() => {
      const next: Record<string, CompanionState> = {};
      for (const it of bundle.items) {
        if (it.status === "ok") {
          next[it.section_id] = {
            status: "done",
            text: it.companion_markdown ?? "",
            provider: it.provider ?? "",
          };
        } else if (it.status === "error") {
          next[it.section_id] = {
            status: "error",
            err: it.error_message ?? "伴读失败",
          };
        } else {
          next[it.section_id] = { status: "loading", text: "" };
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open || !wikiFileName.trim() || sections.length === 0) return;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const bundle = await fetchReadingCompanionBundle(wikiFileName);
        if (stopped) return;
        applyCompanionBundle(bundle);
        if (!bundle.any_pending) {
          setCompanionSlowHint(false);
          if (companionSlowTimerRef.current != null) {
            clearTimeout(companionSlowTimerRef.current);
            companionSlowTimerRef.current = null;
          }
        }
        if (!bundle.any_pending && intervalId != null) {
          clearInterval(intervalId);
          intervalId = undefined;
        }
      } catch (e) {
        if (stopped) return;
        const msg = e instanceof Error ? e.message : "导读加载失败，请稍后重试。";
        setCompanion((prev) => {
          const next = { ...prev };
          for (const s of sections) {
            if (next[s.id]?.status === "done") continue;
            next[s.id] = { status: "error", err: msg };
          }
          return next;
        });
        if (intervalId != null) {
          clearInterval(intervalId);
          intervalId = undefined;
        }
      }
    };

    void tick();
    intervalId = setInterval(() => void tick(), 2000);
    return () => {
      stopped = true;
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [open, wikiFileName, markdown, sections, applyCompanionBundle]);

  const scrollToSection = (id: string) => {
    lastDominantForRightRef.current = null;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      lastDominantForRightRef.current = id;
      scrollRightToCompanionCard(id);
    }, 520);
  };

  const showCompanionSlowHint =
    companionSlowHint && Object.values(companion).some((c) => c?.status === "loading");

  const onRefreshCompanions = useCallback(async () => {
    if (refreshingCompanions) return;
    setRefreshingCompanions(true);
    try {
      const bundle = await refreshReadingCompanionBundle(wikiFileName, true);
      applyCompanionBundle(bundle);
    } catch {
      /* 保留现有缓存 */
    } finally {
      setRefreshingCompanions(false);
    }
  }, [refreshingCompanions, wikiFileName, applyCompanionBundle]);

  const shell = open ? (
    <div className="wiki-immersive-root" role="dialog" aria-modal="true" aria-label="全屏阅读">
      <button type="button" className="wiki-immersive-backdrop" aria-label="关闭全屏阅读" onClick={onClose} />
      <div className="wiki-immersive-shell">
        <header className="wiki-immersive-head">
          <div className="wiki-immersive-head__text">
            <p className="wiki-immersive-head__kicker">阅读</p>
            <h2 className="wiki-immersive-head__title">{docTitle || wikiFileName}</h2>
            <p className="wiki-immersive-head__hint">
              左边是目录，点一下可跳到对应位置。右边是导读，会跟着你读到哪里显示哪一节；每节下面可以写几句笔记（只保存在本机浏览器）。导读在导入后会逐步生成。按 Esc 关闭。
            </p>
          </div>
          <div className="wiki-immersive-head__actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={refreshingCompanions}
              onClick={() => void onRefreshCompanions()}
            >
              {refreshingCompanions ? "刷新导读中…" : "重新生成导读"}
            </button>
            <button type="button" className="btn btn-secondary wiki-immersive-close" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="wiki-immersive-grid">
          <aside className="wiki-immersive-toc" aria-label="目录">
            <p className="wiki-immersive-toc__label">目录</p>
            <nav className="wiki-immersive-toc__nav">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`wiki-immersive-toc__item wiki-immersive-toc__item--l${Math.min(s.level, 6)}${
                    tocActiveId === s.id ? " wiki-immersive-toc__item--active" : ""
                  }`}
                  onClick={() => scrollToSection(s.id)}
                >
                  {s.title}
                </button>
              ))}
            </nav>
          </aside>

          <main
            ref={centerRef}
            className="wiki-immersive-main"
            aria-label="正文"
            onScroll={scheduleSyncRightFromMainScroll}
          >
            {sections.map((sec) => (
              <div
                key={sec.id}
                id={sec.id}
                data-section-id={sec.id}
                ref={(el) => {
                  if (el) sectionElsRef.current.set(sec.id, el);
                  else sectionElsRef.current.delete(sec.id);
                }}
                className="wiki-immersive-section"
              >
                <WikiReadingMarkdown markdown={sec.markdown} className="wiki-reading-surface wiki-ai-prose wiki-immersive-prose" />
              </div>
            ))}
          </main>

          <aside className="wiki-immersive-rail" aria-label="导读与笔记">
            <p className="wiki-immersive-rail__label">导读与笔记</p>
            {showCompanionSlowHint ? (
              <p className="wiki-immersive-rail__slow-hint">
                节数多的时候，导读可能要并行生成，等一两分钟也正常。如果一直空白，请检查网络和模型配置；也可以先关掉窗口，过一会再开。
              </p>
            ) : null}
            <div ref={rightRef} className="wiki-immersive-rail__scroll">
              <div className="wiki-immersive-rail__stack">
                {sections.map((sec) => {
                  const st = companion[sec.id];
                  return (
                    <article
                      key={sec.id}
                      className="wiki-immersive-companion-card"
                      data-companion-section={sec.id}
                    >
                      <h3 className="wiki-immersive-companion-card__title">{sec.title}</h3>
                      {!st || st.status === "idle" ? (
                        <p className="wiki-immersive-companion-card__wait">正在等待本节导读…</p>
                      ) : null}
                      {st?.status === "loading" ? (
                        <p className="wiki-immersive-companion-card__wait">
                          正在生成本节导读，内容多的时候可能要等一会儿…
                        </p>
                      ) : null}
                      {st?.status === "error" ? (
                        <p className="wiki-immersive-companion-card__err">{st.err}</p>
                      ) : null}
                      {st?.status === "done" && st.text ? (
                        <WikiReadingMarkdown markdown={st.text} className="wiki-reading-surface wiki-immersive-companion-md" />
                      ) : null}
                      <div className="wiki-immersive-companion-note">
                        <label className="wiki-immersive-companion-note__label" htmlFor={`wiki-immersive-note-${sec.id}`}>
                          笔记
                        </label>
                        <textarea
                          id={`wiki-immersive-note-${sec.id}`}
                          className="wiki-immersive-companion-note__field"
                          rows={3}
                          value={sectionNotes[sec.id] ?? ""}
                          onChange={(e) => updateSectionNote(sec.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              (e.target as HTMLTextAreaElement).blur();
                            }
                          }}
                          placeholder="随便记点什么…（只保存在本机）"
                          spellCheck={false}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  ) : null;

  return typeof document !== "undefined" ? createPortal(shell, document.body) : null;
}
