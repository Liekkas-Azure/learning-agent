"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  fetchFlashcardFeed,
  fetchDemoFlashcardFeed,
  fetchDailyStats,
  fetchFlashcardImageStatus,
  fetchFlashcardNote,
  regenerateFlashcard,
  applyFlashcardUnderstanding,
  saveFlashcardNote,
  sendFlashcardFeedback,
  submitSrsReview,
  type FlashcardFeedbackAction,
  type FlashcardUnderstanding,
  type KnowledgeFlashcard,
  type FlashcardProfile,
  type DailyProgress,
} from "@/lib/api";
import type { UnderstandingMode } from "@/lib/flashcardUnderstand";
import { getFeedSessionId } from "@/lib/feedSession";
import { hasFlashcardNote, loadFlashcardNote, persistFlashcardNote } from "@/lib/flashcardNotes";
import FlashcardNoteSheet from "@/components/feed/FlashcardNoteSheet";
import FlashcardRegenerateSheet from "@/components/feed/FlashcardRegenerateSheet";
import FlashcardUnderstandPanel from "@/components/feed/FlashcardUnderstandPanel";
import FlashcardVisual from "@/components/feed/FlashcardVisual";
import {
  fetchFlashcardSyncStatus,
  syncFlashcardsFromCorpus,
} from "@/lib/api";
import FlashcardActions from "@/components/feed/FlashcardActions";
import FlashcardDeck from "@/components/feed/FlashcardDeck";
import FlashcardFeedRationale from "@/components/feed/FlashcardFeedRationale";
import FlashcardProgress from "@/components/feed/FlashcardProgress";
import FeedDailyBar from "@/components/feed/FeedDailyBar";
import CloudDemoStrip from "@/components/CloudDemoStrip";
import FlashcardSyncProgress from "@/components/sync/FlashcardSyncProgress";
import { markSaveHintShown, shouldShowSaveHint } from "@/lib/onboarding";
import {
  isDemoMode,
  enableDemoMode,
  disableDemoMode,
  isDemoFirstSaveDone,
  markDemoFirstSaveDone,
  getDailyGoal,
} from "@/lib/productPrefs";
import { shareFlashcard } from "@/lib/shareFlashcard";
import { useVerticalFeed } from "@/lib/useVerticalFeed";

export default function FlashcardFeed() {
  const sessionId = getFeedSessionId();
  const verticalFeed = useVerticalFeed();
  const [cards, setCards] = useState<KnowledgeFlashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCorpus, setHasCorpus] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [imageHint, setImageHint] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenDirection, setRegenDirection] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenToast, setRegenToast] = useState<string | null>(null);
  const [understandOpen, setUnderstandOpen] = useState(false);
  const [understandHighlight, setUnderstandHighlight] = useState(false);
  const [clarityToast, setClarityToast] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteHasContent, setNoteHasContent] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncDetail, setSyncDetail] = useState<Awaited<ReturnType<typeof fetchFlashcardSyncStatus>> | null>(
    null,
  );
  const [dueCount, setDueCount] = useState(0);
  const [profile, setProfile] = useState<FlashcardProfile | null>(null);
  const [daily, setDaily] = useState<DailyProgress | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [understandToast, setUnderstandToast] = useState<string | null>(null);
  const [qaRatio, setQaRatio] = useState(1);
  const [sessionStats, setSessionStats] = useState({ viewed: 0, saved: 0, skipped: 0 });
  const [roundSummary, setRoundSummary] = useState<string | null>(null);
  const seenIdsRef = useRef<number[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const visibleSinceRef = useRef<number>(Date.now());
  const indexRef = useRef(0);
  const cardsRef = useRef<KnowledgeFlashcard[]>([]);
  const notePersistTimerRef = useRef<number | null>(null);
  const noteCardIdRef = useRef<number | null>(null);
  const noteTextRef = useRef("");
  const scrollSyncRef = useRef(false);
  const pollSyncStatusRef = useRef<(() => Promise<void>) | null>(null);

  const applyFeedBatch = useCallback((batch: Awaited<ReturnType<typeof fetchFlashcardFeed>>) => {
    setHasCorpus(Boolean(batch.has_corpus));
    setLlmConfigured(batch.llm_configured ?? null);
    setDueCount(batch.due_count ?? 0);
    setProfile(batch.profile ?? null);
    setDaily(batch.daily ?? null);
    setIsDemo(Boolean(batch.is_demo));
    setQaRatio(batch.qa_ratio ?? 1);
    setSyncError(batch.sync?.error?.trim() || null);
    setHasMore(Boolean(batch.has_more));
    const syncing = Boolean(batch.sync?.running);
    setSyncRunning(syncing);
    if (syncing) {
      window.setTimeout(() => void pollSyncStatusRef.current?.(), 1500);
    }
    return batch;
  }, []);

  const refreshDaily = useCallback(async () => {
    try {
      const stats = await fetchDailyStats(sessionId, getDailyGoal());
      setDaily(stats);
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const loadFeed = useCallback(
    async (opts?: { append?: boolean; autoSync?: boolean }) => {
      const append = opts?.append ?? false;
      const controller = new AbortController();
      const timer = globalThis.setTimeout(() => controller.abort(), 25_000);
      try {
        const batch = await fetchFlashcardFeed(sessionId, 10, {
          autoSync: opts?.autoSync ?? !append,
          excludeIds: append ? seenIdsRef.current : [],
          signal: controller.signal,
        });
        applyFeedBatch(batch);
        void refreshDaily();
        if (append) {
          setCards((prev) => {
            const ids = new Set(prev.map((c) => c.id));
            const merged = [...prev, ...batch.items.filter((c) => !ids.has(c.id))];
            seenIdsRef.current = merged.map((c) => c.id);
            return merged;
          });
        } else {
          setCards(batch.items);
          seenIdsRef.current = batch.items.map((c) => c.id);
        }
        return { count: batch.items.length, hasCorpus: Boolean(batch.has_corpus) };
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
    [sessionId, applyFeedBatch, refreshDaily],
  );

  const loadDemo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const batch = await fetchDemoFlashcardFeed(10);
      applyFeedBatch({ ...batch, is_demo: true });
      setCards(batch.items);
      seenIdsRef.current = batch.items.map((c) => c.id);
      setIndex(0);
      setIsDemo(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "示例加载失败");
    } finally {
      setLoading(false);
    }
  }, [applyFeedBatch]);

  const pollSyncStatus = useCallback(async () => {
    try {
      const st = await fetchFlashcardSyncStatus();
      setSyncRunning(Boolean(st.running));
      setSyncDetail(st.running ? st : null);
      if (st.running) {
        window.setTimeout(() => void pollSyncStatusRef.current?.(), 2000);
      } else {
        setSyncDetail(null);
        if (!st.error && st.result) {
          setSyncError(null);
          disableDemoMode();
          setIsDemo(false);
          const prevCount = cardsRef.current.length;
          await loadFeed({ autoSync: false });
          if (cardsRef.current.length > prevCount) {
            setSaveToast("拆卡完成，新材料已加入推荐流！");
            window.setTimeout(() => setSaveToast(null), 5000);
          } else if (prevCount === 0 && cardsRef.current.length > 0) {
            setSaveToast("你的材料已拆成闪卡，开始刷读吧！");
            window.setTimeout(() => setSaveToast(null), 4200);
          }
        } else if (st.error) {
          setSyncError(String(st.error));
        }
      }
    } catch {
      setSyncRunning(false);
      setSyncDetail(null);
    }
  }, [loadFeed]);

  pollSyncStatusRef.current = pollSyncStatus;

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadFeed({ append: true, autoSync: false });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loadFeed]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode()) {
        await loadDemo();
        return;
      }
      const result = await loadFeed({ autoSync: true });
      if (result.count === 0 && !result.hasCorpus) {
        enableDemoMode();
        await loadDemo();
      }
    } catch (e) {
      const aborted =
        e !== null && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError";
      if (aborted) {
        setError("加载超时，请刷新页面重试。");
      } else {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    } finally {
      setLoading(false);
    }

    void fetchFlashcardImageStatus()
      .then((imgStatus) => {
        if (!imgStatus.ready && imgStatus.hint) {
          setImageHint(imgStatus.hint);
        } else {
          setImageHint(null);
        }
      })
      .catch(() => undefined);
  }, [loadFeed, loadDemo]);

  useEffect(() => {
    const onDemoStart = () => void loadDemo();
    window.addEventListener("knotory-demo-start", onDemoStart);
    return () => window.removeEventListener("knotory-demo-start", onDemoStart);
  }, [loadDemo]);

  useEffect(() => {
    const onCorpusUpdated = () => {
      disableDemoMode();
      setIsDemo(false);
      void loadFeed({ autoSync: true }).catch(() => undefined);
      void pollSyncStatusRef.current?.();
    };
    const onSyncComplete = () => {
      void loadFeed({ autoSync: false }).catch(() => undefined);
    };
    window.addEventListener("knotory-corpus-updated", onCorpusUpdated);
    window.addEventListener("knotory-sync-complete", onSyncComplete);
    return () => {
      window.removeEventListener("knotory-corpus-updated", onCorpusUpdated);
      window.removeEventListener("knotory-sync-complete", onSyncComplete);
    };
  }, [loadFeed]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const scrollToIndex = useCallback(
    (i: number, behavior: ScrollBehavior = "smooth") => {
      const el = scrollerRef.current;
      if (!el) return;
      scrollSyncRef.current = true;
      if (verticalFeed) {
        const h = el.clientHeight;
        if (h <= 0) return;
        el.scrollTo({ top: i * h, behavior });
      } else {
        const w = el.clientWidth;
        if (w <= 0) return;
        el.scrollTo({ left: i * w, behavior });
      }
      window.setTimeout(() => {
        scrollSyncRef.current = false;
      }, behavior === "smooth" ? 400 : 0);
    },
    [verticalFeed],
  );

  useEffect(() => {
    indexRef.current = index;
    cardsRef.current = cards;
    visibleSinceRef.current = Date.now();
    setFlipped(false);
    setSavedFlash(false);
    setRegenOpen(false);
    setRegenError(null);
    scrollToIndex(index, "auto");
  }, [index, cards, scrollToIndex, verticalFeed]);

  const flushNote = useCallback((cardId: number, text: string) => {
    if (!cardId) return;
    persistFlashcardNote(cardId, text);
    void saveFlashcardNote(cardId, text).catch(() => undefined);
    setNoteHasContent(text.trim().length > 0);
  }, []);

  const scheduleNotePersist = useCallback(
    (cardId: number, text: string) => {
      if (notePersistTimerRef.current != null) window.clearTimeout(notePersistTimerRef.current);
      notePersistTimerRef.current = window.setTimeout(() => {
        notePersistTimerRef.current = null;
        flushNote(cardId, text);
      }, 400);
    },
    [flushNote],
  );

  useEffect(() => {
    noteTextRef.current = noteText;
  }, [noteText]);

  const bindNoteToCard = useCallback(
    async (cardId: number) => {
      if (noteCardIdRef.current && noteCardIdRef.current !== cardId) {
        flushNote(noteCardIdRef.current, noteTextRef.current);
      }
      noteCardIdRef.current = cardId;
      const local = loadFlashcardNote(cardId);
      const server = await fetchFlashcardNote(cardId).catch(() => "");
      const loaded = server.trim() || local;
      noteTextRef.current = loaded;
      setNoteText(loaded);
      setNoteHasContent(loaded.trim().length > 0);
      if (server.trim() && !local.trim()) {
        persistFlashcardNote(cardId, server);
      }
    },
    [flushNote],
  );

  useEffect(() => {
    const card = cards[index];
    if (!card) return;
    void bindNoteToCard(card.id);
  }, [index, cards, bindNoteToCard]);

  useEffect(() => {
    if (cards.length > 0 && index >= cards.length - 2 && hasMore) {
      void loadMore();
    }
  }, [index, cards.length, hasMore, loadMore]);

  useEffect(() => {
    return () => {
      if (notePersistTimerRef.current != null) window.clearTimeout(notePersistTimerRef.current);
      if (noteCardIdRef.current) flushNote(noteCardIdRef.current, noteTextRef.current);
    };
  }, [flushNote]);

  const submitFeedback = useCallback(
    async (action: FlashcardFeedbackAction) => {
      const card = cardsRef.current[indexRef.current];
      if (!card) return;
      const dwell_ms = Date.now() - visibleSinceRef.current;
      if (action === "save") {
        setSessionStats((s) => ({ ...s, saved: s.saved + 1 }));
      } else if (action === "skip" || action === "dislike") {
        setSessionStats((s) => ({ ...s, skipped: s.skipped + 1 }));
      }
      try {
        await sendFlashcardFeedback(card.id, { action, dwell_ms, session_id: sessionId });
        if (action === "flip" || action === "like" || action === "save" || action === "skip") {
          void refreshDaily();
        }
      } catch {
        /* 不阻断浏览 */
      }
    },
    [sessionId, refreshDaily],
  );

  const handleShare = useCallback(async () => {
    const card = cardsRef.current[indexRef.current];
    if (!card || shareBusy) return;
    setShareBusy(true);
    try {
      const result = await shareFlashcard(card);
      const msg =
        result === "shared"
          ? "已分享知识点卡片"
          : result === "downloaded"
            ? "已下载分享图并复制文案，可发小红书 / 朋友圈"
            : "已复制分享文案";
      setSaveToast(msg);
      window.setTimeout(() => setSaveToast(null), 3600);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setSaveToast("分享失败，请重试");
      window.setTimeout(() => setSaveToast(null), 3200);
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy]);

  const advanceTo = useCallback(
    (next: number) => {
      const len = cardsRef.current.length;
      if (len === 0) return;
      const wrapped = ((next % len) + len) % len;
      const prev = indexRef.current;
      if (wrapped !== prev && (wrapped > prev || (prev === len - 1 && wrapped === 0))) {
        setSessionStats((s) => {
          const viewed = s.viewed + 1;
          if (viewed > 0 && viewed % 10 === 0) {
            setRoundSummary(`本轮已刷 ${viewed} 张 · 保存 ${s.saved} · 跳过 ${s.skipped}`);
            window.setTimeout(() => setRoundSummary(null), 4200);
          }
          return { ...s, viewed };
        });
      }
      setIndex(wrapped);
      setFlipped(false);
      setUnderstandOpen(false);
      setUnderstandHighlight(false);
      requestAnimationFrame(() => scrollToIndex(wrapped, "smooth"));
    },
    [scrollToIndex],
  );

  const applySrs = useCallback((rating: 0 | 1 | 2 | 3) => {
    const card = cardsRef.current[indexRef.current];
    if (!card?.id) return;
    void submitSrsReview(card.id, rating).catch(() => undefined);
  }, []);

  const actAndAdvance = useCallback(
    (feedbackAction: FlashcardFeedbackAction, srsRating?: 0 | 1 | 2 | 3) => {
      void submitFeedback(feedbackAction);
      if (srsRating !== undefined) applySrs(srsRating);
      advanceTo(indexRef.current + 1);
    },
    [submitFeedback, advanceTo, applySrs],
  );

  const actStay = useCallback(
    (feedbackAction: FlashcardFeedbackAction) => {
      void submitFeedback(feedbackAction);
    },
    [submitFeedback],
  );

  const goNext = useCallback(() => {
    advanceTo(indexRef.current + 1);
  }, [advanceTo]);

  const goPrev = useCallback(() => {
    advanceTo(indexRef.current - 1);
  }, [advanceTo]);

  const handleSave = useCallback(() => {
    actStay("save");
    applySrs(2);
    setSavedFlash(true);
    if (shouldShowSaveHint()) markSaveHintShown();
    if (isDemo && !isDemoFirstSaveDone()) {
      markDemoFirstSaveDone();
      setSaveToast("第一张搞定的知识点！上传 PDF 可生成专属闪卡 →");
    } else {
      setSaveToast("已保存；相关内容再来时会优先弹出 · 可在文库导出笔记");
    }
    window.setTimeout(() => setSaveToast(null), 3600);
    window.setTimeout(() => setSavedFlash(false), 1600);
  }, [actStay, applySrs, isDemo]);

  const handleRegenerate = useCallback(async (directionOverride?: string) => {
    const card = cardsRef.current[indexRef.current];
    if (!card || regenBusy) return;
    const direction = (directionOverride ?? regenDirection).trim();
    setRegenBusy(true);
    setRegenError(null);
    try {
      if (noteCardIdRef.current === card.id && noteTextRef.current.trim()) {
        flushNote(card.id, noteTextRef.current);
      }
      const updated = await regenerateFlashcard(card.id, {
        direction,
        use_note: true,
      });
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...updated } : c)));
      setRegenOpen(false);
      setRegenDirection("");
      setUnderstandOpen(false);
      setUnderstandHighlight(false);
      setFlipped(false);
      setRegenToast("已按你的方向生成新版闪卡；系统会记住这种讲法偏好");
      window.setTimeout(() => setRegenToast(null), 2400);
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "闪卡重写失败");
    } finally {
      setRegenBusy(false);
    }
  }, [regenBusy, regenDirection, flushNote]);

  const handleApplyUnderstanding = useCallback(
    async (mode: UnderstandingMode, preview: FlashcardUnderstanding) => {
      const card = cardsRef.current[indexRef.current];
      if (!card || regenBusy) return;
      setRegenBusy(true);
      setRegenError(null);
      try {
        const updated = await applyFlashcardUnderstanding(card.id, { mode, preview });
        setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...updated } : c)));
        setUnderstandOpen(false);
        setUnderstandHighlight(false);
        setFlipped(false);
        setRegenToast("已用更易懂的讲法替换；后续推荐会参考你的偏好");
        window.setTimeout(() => setRegenToast(null), 2400);
      } catch (e) {
        setRegenError(e instanceof Error ? e.message : "替换闪卡失败");
        setRegenOpen(true);
      } finally {
        setRegenBusy(false);
      }
    },
    [regenBusy],
  );

  const handleHardToUnderstand = useCallback(() => {
    void submitFeedback("bad_card");
    applySrs(0);
    setFlipped(true);
    setUnderstandOpen(true);
    setUnderstandHighlight(true);
    setClarityToast("选一种更容易懂的讲法；原版会保留，直到你确认替换");
    window.setTimeout(() => setClarityToast(null), 4200);
    window.setTimeout(() => setUnderstandHighlight(false), 2400);
  }, [submitFeedback, applySrs]);

  const onScrollSnap = useCallback(() => {
    if (scrollSyncRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const i = verticalFeed
      ? Math.round(el.scrollTop / Math.max(el.clientHeight, 1))
      : Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
    if (i !== indexRef.current && i >= 0 && i < cardsRef.current.length) {
      setIndex(i);
    }
  }, [verticalFeed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noteOpen || regenOpen) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === " " || e.key === "Spacebar") {
        const card = cardsRef.current[indexRef.current];
        if (!card) return;
        e.preventDefault();
        setFlipped((f) => {
          const next = !f;
          if (next) void submitFeedback("flip");
          return next;
        });
      } else if (e.key === "s" || e.key === "S") {
        if (!flipped) return;
        e.preventDefault();
        handleSave();
      } else if (e.key === "1") {
        e.preventDefault();
        actAndAdvance("skip", 1);
      } else if (e.key === "2" && flipped) {
        e.preventDefault();
        actAndAdvance("like", 2);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setRegenError(null);
        setRegenOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteOpen, regenOpen, goNext, goPrev, submitFeedback, flipped, handleSave, actAndAdvance]);

  const current = cards[index];
  const showEmpty = !loading && cards.length === 0 && !error;
  const emptyHint = !hasCorpus
    ? "请先在文库上传材料，系统会拆成知识点闪卡供你刷读。"
    : syncRunning
      ? "正在把文库拆成易懂闪卡，请稍候…"
      : syncError
        ? "拆卡出现问题，可尝试重新拆知识点。"
        : llmConfigured === false
          ? "文库已有材料，但未配置大模型 API。闪卡将以模板形式生成；配置 API 后可获得更易懂的问答卡，并支持按方向重写。"
          : "正在把文库拆成易懂闪卡，请稍候刷新。";

  return (
    <div className="feed-shell feed-shell--immersive">
      <CloudDemoStrip compact />
      {saveToast ? (
        <p className="feed-sync-banner" role="status">
          {saveToast}{" "}
          <Link href="/library#library-saved" className="feed-sync-banner__link">
            搞懂清单
          </Link>
        </p>
      ) : null}
      {regenToast ? (
        <p className="feed-sync-banner" role="status">
          {regenToast}
        </p>
      ) : null}
      {clarityToast ? (
        <p className="feed-sync-banner feed-sync-banner--clarity" role="status">
          {clarityToast}
        </p>
      ) : null}
      {syncRunning && syncDetail ? (
        <div className="feed-sync-progress-wrap">
          <FlashcardSyncProgress sync={syncDetail} variant="inline" />
        </div>
      ) : null}
      {!syncRunning && dueCount > 0 && cards.length === 0 ? (
        <p className="feed-sync-banner feed-sync-banner--due" role="status">
          今日待巩固 {dueCount} 张 · <Link href="/review">去复习</Link>
        </p>
      ) : null}
      {understandToast ? (
        <p className="feed-sync-banner feed-sync-banner--clarity" role="status">
          {understandToast}
        </p>
      ) : null}
      {roundSummary ? (
        <p className="feed-sync-banner feed-sync-banner--round" role="status">
          {roundSummary}
        </p>
      ) : null}
      {imageHint ? (
        <p className="feed-image-hint" role="status">
          AI 配图未启用：{imageHint}
        </p>
      ) : null}
      {loading ? (
        <div className="feed-center">
          <p className="feed-center__text">正在加载知识点…</p>
        </div>
      ) : null}

      {error ? (
        <div className="feed-center">
          <p className="feed-center__text feed-center__text--err">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => void bootstrap()}>
            重试
          </button>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="feed-center">
          <p className="feed-center__title">还没有可刷的知识点</p>
          <p className="feed-center__text">{emptyHint}</p>
          {syncError ? (
            <p className="feed-center__text feed-center__text--err" style={{ fontSize: "0.9rem" }}>
              {syncError.length > 160 ? `${syncError.slice(0, 160)}…` : syncError}
            </p>
          ) : null}
          {!hasCorpus ? (
            <div className="feed-center__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  enableDemoMode();
                  void loadDemo();
                }}
              >
                先刷示例卡
              </button>
              <Link href="/library" className="btn btn-secondary">
                去文库上传
              </Link>
            </div>
          ) : (
            <div className="feed-center__actions">
              {llmConfigured === false ? (
                <Link href="/welcome#pricing" className="btn btn-secondary">
                  查看配置说明
                </Link>
              ) : null}
              <button type="button" className="btn btn-secondary" onClick={() => void bootstrap()}>
                刷新推荐
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void syncFlashcardsFromCorpus({ useLlm: true, background: true, mode: "enrich" }).then(() =>
                    pollSyncStatus(),
                  );
                }}
              >
                重新拆知识点
              </button>
            </div>
          )}
        </div>
      ) : null}

      {!loading && cards.length > 0 ? (
        <div className={`feed-carousel${flipped ? " feed-carousel--reading" : ""}`}>
          <FeedDailyBar daily={daily} profile={profile} dueCount={dueCount} isDemo={isDemo} onGoalChange={() => void refreshDaily()} />
          <FlashcardProgress current={index + 1} total={cards.length} hasMore={hasMore} />
          <p className="feed-carousel__hint feed-carousel__hint--responsive">
            <span className="feed-carousel__hint-desktop">左右滑动 · 空格翻面 · 1 跳过 · 2 掌握 · S 保存 · R 重写 · 不懂可换讲法</span>
            <span className="feed-carousel__hint-mobile">上下滑动换卡 · 点卡翻面 · 不懂可换讲法</span>
            {loadingMore ? " · 加载更多…" : hasMore ? " · 滑到底自动加载" : ""}
          </p>

          <div
            ref={scrollerRef}
            className={`feed-scroller feed-scroller--full${verticalFeed ? " feed-scroller--vertical-mobile" : " feed-scroller--horizontal"}`}
            onScroll={onScrollSnap}
          >
            {cards.map((card, i) => (
              <section
                key={card.id}
                className={`feed-slide feed-slide--full${verticalFeed ? " feed-slide--vertical-mobile" : " feed-slide--horizontal"}`}
                aria-hidden={i !== index}
                aria-label={`第 ${i + 1} 张闪卡`}
              >
                {i === index && card.feed_explain ? (
                  <FlashcardFeedRationale text={card.feed_explain} reason={card.feed_reason} />
                ) : null}
                <FlashcardDeck
                  card={card}
                  flipped={i === index && flipped}
                  onOpenSource={() => {
                    if (i === index) void submitFeedback("open_source");
                  }}
                  onFlip={() => {
                    if (i === index) {
                      setFlipped((f) => {
                        const next = !f;
                        if (next) void submitFeedback("flip");
                        return next;
                      });
                    }
                  }}
                />
                {i === index && flipped ? (
                  <FlashcardUnderstandPanel
                    cardId={card.id}
                    expanded={understandOpen}
                    onExpandedChange={setUnderstandOpen}
                    onApplyAsCard={(mode, preview) => void handleApplyUnderstanding(mode, preview)}
                    onUnderstandingLoaded={() => {
                      setUnderstandToast("新版讲法已生成 · 觉得 OK 可点「用这版替换闪卡」");
                      window.setTimeout(() => setUnderstandToast(null), 5000);
                    }}
                    applyBusy={regenBusy}
                    highlight={understandHighlight}
                  />
                ) : null}
                {i === index ? (
                  <FlashcardActions
                    saved={savedFlash}
                    noteActive={noteHasContent}
                    regenBusy={regenBusy}
                    onSkip={() => actAndAdvance("skip", 1)}
                    onKnow={() => actAndAdvance("like", 2)}
                    onNote={() => {
                      bindNoteToCard(card.id);
                      setNoteOpen(true);
                    }}
                    onRegenerate={() => {
                      setRegenError(null);
                      setRegenDirection(noteTextRef.current.trim().slice(0, 200));
                      setRegenOpen(true);
                    }}
                    onSave={() => handleSave()}
                    onBad={handleHardToUnderstand}
                    onShare={() => void handleShare()}
                    shareBusy={shareBusy}
                  />
                ) : null}
              </section>
            ))}
          </div>

          {current ? (
            <FlashcardRegenerateSheet
              open={regenOpen}
              cardTitle={current.front_text.slice(0, 48) || current.topic}
              value={regenDirection}
              busy={regenBusy}
              error={regenError}
              noteHint={noteHasContent}
              onChange={setRegenDirection}
              onClose={() => {
                if (!regenBusy) setRegenOpen(false);
              }}
              onSubmit={() => void handleRegenerate()}
            />
          ) : null}

          {current ? (
            <FlashcardNoteSheet
              open={noteOpen}
              cardId={current.id}
              cardTitle={current.front_text.slice(0, 48) || current.topic}
              value={noteText}
              onChange={(text) => {
                setNoteText(text);
                setNoteHasContent(text.trim().length > 0);
                scheduleNotePersist(current.id, text);
              }}
              onClose={() => {
                flushNote(current.id, noteText);
                setNoteOpen(false);
              }}
            />
          ) : null}

          {current ? (
            <p className="feed-foot feed-foot--minimal">
              来自 <span className="feed-foot__source">{current.source_title}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
