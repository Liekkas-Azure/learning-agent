"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FeedItemDto,
  IngestDraftDto,
  LearningPathStageDto,
  SemanticResultDto,
  VaultEntryDto,
  VaultSubscriptionDto,
  VaultTagDto,
} from "./types";
import {
  applyDensity,
  applyTheme,
  DENSITY_KEY,
  type DensityMode,
  THEME_KEY,
  type ThemeMode,
} from "@/lib/ui-preferences";

const ORIGIN_PRESETS = ["网页", "微信", "PDF", "Notion", "飞书", "邮件", "视频", "播客", "其他"];

const LEARNING_APP_URL = (process.env.NEXT_PUBLIC_LEARNING_APP_URL ?? "").trim();
const TOPIC_STORAGE_KEY = "vault:topics:v1";

function kindLabel(k: VaultEntryDto["kind"]) {
  if (k === "link") return "链接";
  if (k === "clip") return "摘录";
  return "笔记";
}

type TabKey = "library" | "system" | "feeds";

export function VaultApp() {
  const router = useRouter();
  const sp = useSearchParams();
  const [entries, setEntries] = useState<VaultEntryDto[]>([]);
  const [tags, setTags] = useState<VaultTagDto[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("library");
  const [form, setForm] = useState({
    kind: "link" as VaultEntryDto["kind"],
    title: "",
    url: "",
    body: "",
    origin: "",
    tags: "",
  });
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureTags, setCaptureTags] = useState("");
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<IngestDraftDto | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState("");
  const [feedTopic, setFeedTopic] = useState("");
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedItems, setFeedItems] = useState<FeedItemDto[]>([]);
  const [subscriptions, setSubscriptions] = useState<VaultSubscriptionDto[]>([]);
  const [submittingSub, setSubmittingSub] = useState(false);
  const [subForm, setSubForm] = useState({
    type: "RSS" as "RSS" | "SEED_URL",
    url: "",
    refreshMinutes: "60",
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfTags, setPdfTags] = useState("");
  const [pdfUploading, setPdfUploading] = useState(false);
  const [semanticQ, setSemanticQ] = useState("");
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticResults, setSemanticResults] = useState<SemanticResultDto[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [learningPath, setLearningPath] = useState<LearningPathStageDto[]>([]);
  const [streamInput, setStreamInput] = useState("");
  const [streamTags, setStreamTags] = useState("");
  const [streamSaving, setStreamSaving] = useState(false);
  const [streamBatch, setStreamBatch] = useState(true);
  const [streamPreview, setStreamPreview] = useState<string[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [mobilePrefsOpen, setMobilePrefsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [density, setDensity] = useState<DensityMode>("cozy");
  const [tabSlideDir, setTabSlideDir] = useState<"left" | "right" | null>(null);
  const [fabPos, setFabPos] = useState({ x: 16, y: 96 });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const streamInputRef = useRef<HTMLTextAreaElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const panelTouchStartY = useRef<number | null>(null);
  const tabTransitionTimer = useRef<number | null>(null);
  const fabPressTimer = useRef<number | null>(null);
  const fabDragging = useRef(false);
  const fabTouchOffset = useRef({ x: 0, y: 0 });

  const loadTags = useCallback(async () => {
    const res = await fetch("/api/vault/tags");
    if (!res.ok) return;
    const data = (await res.json()) as { tags: VaultTagDto[] };
    setTags(data.tags);
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (activeTag) params.set("tag", activeTag);
      params.set("take", "60");
      const res = await fetch(`/api/vault/entries?${params.toString()}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { entries: VaultEntryDto[] };
      setEntries(data.entries);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [q, activeTag]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    const savedTheme = (window.localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? "dark";
    const savedDensity = (window.localStorage.getItem(DENSITY_KEY) as DensityMode | null) ?? "cozy";
    setTheme(savedTheme);
    setDensity(savedDensity);
    applyTheme(savedTheme);
    applyDensity(savedDensity);
    const savedFab = window.localStorage.getItem("vault:ui:fab-pos");
    if (savedFab) {
      try {
        const parsed = JSON.parse(savedFab) as { x: number; y: number };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) setFabPos(parsed);
      } catch {}
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TOPIC_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const list = parsed.map((v) => String(v).trim()).filter(Boolean).slice(0, 20);
      setTopics(list);
      if (list[0]) setFeedTopic((cur) => cur || list[0]);
    } catch {}
  }, []);

  useEffect(() => {
    window.localStorage.setItem(TOPIC_STORAGE_KEY, JSON.stringify(topics));
  }, [topics]);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput), 280);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const loadSubscriptions = useCallback(async () => {
    const res = await fetch("/api/vault/subscriptions");
    if (!res.ok) return;
    const data = (await res.json()) as { sources: VaultSubscriptionDto[] };
    setSubscriptions(data.sources);
  }, []);

  useEffect(() => {
    const shareUrl = sp.get("url");
    const shareTitle = sp.get("title") ?? sp.get("text");
    if (shareUrl || shareTitle) {
      setSheetOpen(true);
      setForm((f) => ({
        ...f,
        kind: "link",
        title: (shareTitle && shareTitle.slice(0, 200)) || f.title || "分享的链接",
        url: shareUrl ?? f.url,
        origin: f.origin || "系统分享",
      }));
      router.replace("/", { scroll: false });
    }
  }, [sp, router]);

  useEffect(() => {
    if (activeTab === "feeds") {
      void loadSubscriptions();
    }
  }, [activeTab, loadSubscriptions]);

  const tagChips = useMemo(() => tags.filter((t) => t.count > 0).slice(0, 32), [tags]);
  const learningPillars = useMemo(() => tags.filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 8), [tags]);
  const totalTagRefs = useMemo(() => tags.reduce((acc, t) => acc + t.count, 0), [tags]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const tagList = form.tags
        .split(/[,，、\n]/g)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/vault/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          title: form.title.trim(),
          url: form.url.trim() || null,
          body: form.body.trim() || null,
          origin: form.origin.trim() || null,
          tags: tagList,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "保存失败");
        return;
      }
      setSheetOpen(false);
      setForm({ kind: "link", title: "", url: "", body: "", origin: "", tags: "" });
      await Promise.all([loadEntries(), loadTags()]);
    } finally {
      setSaving(false);
    }
  }

  async function streamIngest() {
    const input = streamInput.trim();
    if (!input) return;
    setStreamSaving(true);
    try {
      const res = await fetch("/api/vault/stream-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          kind: "auto",
          tags: streamTags,
          batch: streamBatch,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        batch?: boolean;
        total?: number;
        success?: number;
        failed?: number;
      };
      if (!res.ok) {
        alert(data.error ?? "入库失败");
        return;
      }
      if (data.batch) {
        alert(`批量归档完成：成功 ${data.success ?? 0} / ${data.total ?? 0}，失败 ${data.failed ?? 0}`);
      }
      setStreamInput("");
      setStreamTags("");
      setStreamPreview([]);
      await Promise.all([loadEntries(), loadTags()]);
    } finally {
      setStreamSaving(false);
    }
  }

  function handleMainTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }

  function handleMainTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
    const order: TabKey[] = ["library", "system", "feeds"];
    const idx = order.indexOf(activeTab);
    if (dx < 0 && idx < order.length - 1) {
      setTabSlideDir("left");
      setActiveTab(order[idx + 1]);
      if (navigator.vibrate) navigator.vibrate(8);
    }
    if (dx > 0 && idx > 0) {
      setTabSlideDir("right");
      setActiveTab(order[idx - 1]);
      if (navigator.vibrate) navigator.vibrate(8);
    }
  }

  function handleSheetTouchStart(e: React.TouchEvent) {
    panelTouchStartY.current = e.touches[0].clientY;
  }

  function handleSheetTouchEnd(e: React.TouchEvent) {
    if (panelTouchStartY.current === null) return;
    const dy = e.changedTouches[0].clientY - panelTouchStartY.current;
    panelTouchStartY.current = null;
    if (dy > 70) setSheetOpen(false);
  }

  function setThemeMode(next: ThemeMode) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
  }

  function setDensityMode(next: DensityMode) {
    setDensity(next);
    applyDensity(next);
    window.localStorage.setItem(DENSITY_KEY, next);
  }

  useEffect(() => {
    if (!tabSlideDir) return;
    if (tabTransitionTimer.current) window.clearTimeout(tabTransitionTimer.current);
    tabTransitionTimer.current = window.setTimeout(() => setTabSlideDir(null), 260);
    return () => {
      if (tabTransitionTimer.current) window.clearTimeout(tabTransitionTimer.current);
    };
  }, [tabSlideDir]);

  function fabOnTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    fabTouchOffset.current = {
      x: t.clientX - fabPos.x,
      y: window.innerHeight - t.clientY - fabPos.y,
    };
    fabPressTimer.current = window.setTimeout(() => {
      fabDragging.current = true;
      if (navigator.vibrate) navigator.vibrate(14);
    }, 380);
  }

  function fabOnTouchMove(e: React.TouchEvent) {
    if (!fabDragging.current) return;
    const t = e.touches[0];
    const nextX = t.clientX - fabTouchOffset.current.x;
    const bottom = window.innerHeight - t.clientY - fabTouchOffset.current.y;
    const clampedX = Math.max(8, Math.min(window.innerWidth - 52, nextX));
    const clampedBottom = Math.max(72, Math.min(window.innerHeight - 80, bottom));
    setFabPos({ x: clampedX, y: clampedBottom });
  }

  function fabOnTouchEnd() {
    if (fabPressTimer.current) window.clearTimeout(fabPressTimer.current);
    if (fabDragging.current) {
      fabDragging.current = false;
      window.localStorage.setItem("vault:ui:fab-pos", JSON.stringify(fabPos));
      return;
    }
    setQuickOpen((v) => !v);
  }

  useEffect(() => {
    const lines = streamInput
      .split(/\n/g)
      .map((v) => v.trim())
      .filter(Boolean);
    if (!streamBatch) {
      setStreamPreview(lines.slice(0, 1));
      return;
    }
    const units: string[] = [];
    let buffer: string[] = [];
    function flush() {
      if (!buffer.length) return;
      units.push(buffer.join(" ").slice(0, 80));
      buffer = [];
    }
    for (const line of lines) {
      if (/^https?:\/\//i.test(line)) {
        flush();
        units.push(line);
        continue;
      }
      if (line === "---" || line === "——" || line === "###") {
        flush();
        continue;
      }
      buffer.push(line);
    }
    flush();
    setStreamPreview(units.slice(0, 8));
  }, [streamInput, streamBatch]);

  async function onSmartCapture(saveDirectly: boolean, targetUrl?: string) {
    const url = (targetUrl ?? captureUrl).trim();
    if (!url) return;
    setCaptureLoading(true);
    try {
      const res = await fetch("/api/vault/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          save: saveDirectly,
          tags: captureTags
            .split(/[,，、\n]/g)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        draft?: IngestDraftDto;
      };
      if (!res.ok) {
        alert(data.error ?? "抓取失败");
        return;
      }
      setCaptureDraft(data.draft ?? null);
      if (saveDirectly) {
        await Promise.all([loadEntries(), loadTags()]);
      }
    } finally {
      setCaptureLoading(false);
    }
  }

  function addTopic() {
    const next = topicInput.trim();
    if (!next) return;
    setTopics((cur) => {
      if (cur.includes(next)) return cur;
      return [next, ...cur].slice(0, 20);
    });
    if (!feedTopic) setFeedTopic(next);
    setTopicInput("");
  }

  async function loadFeeds(topic: string) {
    if (!topic) return;
    setFeedLoading(true);
    try {
      const params = new URLSearchParams({ topic, take: "24" });
      const res = await fetch(`/api/vault/feeds?${params.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const data = (await res.json()) as { items: FeedItemDto[] };
      setFeedItems(data.items);
    } catch {
      setFeedItems([]);
    } finally {
      setFeedLoading(false);
    }
  }

  async function createSubscription() {
    const url = subForm.url.trim();
    if (!url) return;
    setSubmittingSub(true);
    try {
      const res = await fetch("/api/vault/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: subForm.type,
          url,
          refreshMinutes: Number.parseInt(subForm.refreshMinutes, 10) || 60,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(data.error ?? "创建订阅失败");
        return;
      }
      setSubForm((f) => ({ ...f, url: "" }));
      await loadSubscriptions();
    } finally {
      setSubmittingSub(false);
    }
  }

  async function refreshSubscription(sourceId: string) {
    await fetch(`/api/vault/subscriptions/${sourceId}/refresh`, { method: "POST" });
    await Promise.all([loadSubscriptions(), loadEntries(), loadTags()]);
  }

  async function removeSubscription(sourceId: string) {
    const ok = window.confirm("确定删除该订阅源吗？");
    if (!ok) return;
    await fetch(`/api/vault/subscriptions/${sourceId}`, { method: "DELETE" });
    await loadSubscriptions();
  }

  async function uploadPdf() {
    if (!pdfFile) return;
    setPdfUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", pdfFile);
      if (pdfTitle.trim()) fd.set("title", pdfTitle.trim());
      if (pdfTags.trim()) fd.set("tags", pdfTags.trim());
      const res = await fetch("/api/vault/upload-pdf", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(data.error ?? "PDF 上传失败");
        return;
      }
      setPdfFile(null);
      setPdfTitle("");
      setPdfTags("");
      await Promise.all([loadEntries(), loadTags()]);
    } finally {
      setPdfUploading(false);
    }
  }

  async function runSemanticSearch() {
    const q = semanticQ.trim();
    if (q.length < 2) return;
    setSemanticLoading(true);
    try {
      const params = new URLSearchParams({ q, take: "8" });
      const res = await fetch(`/api/vault/semantic-search?${params.toString()}`);
      if (!res.ok) throw new Error("搜索失败");
      const data = (await res.json()) as { results: SemanticResultDto[] };
      setSemanticResults(data.results);
    } catch {
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  }

  async function loadLearningPath() {
    setPathLoading(true);
    try {
      const res = await fetch("/api/vault/learning-path");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { stages: LearningPathStageDto[] };
      setLearningPath(data.stages);
    } catch {
      setLearningPath([]);
    } finally {
      setPathLoading(false);
    }
  }

  return (
    <div className="pb-28 sm:pb-10" onTouchStart={handleMainTouchStart} onTouchEnd={handleMainTouchEnd}>
      <div className="ai-card-strong mb-6 flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="space-y-2">
          <p className="ai-section-label">Personal vault</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            <span className="ai-title-gradient">个人知识库</span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
            帮你搭建学习知识体系，自动汇集资料，沉淀重点内容并快速检索。
          </p>
          <div className="grid grid-cols-3 gap-2 pt-2 sm:max-w-lg">
            <div className="ai-muted-panel px-3 py-2">
              <p className="text-[11px] text-slate-500">条目</p>
              <p className="ai-kpi-value">{entries.length}</p>
            </div>
            <div className="ai-muted-panel px-3 py-2">
              <p className="text-[11px] text-slate-500">标签</p>
              <p className="ai-kpi-value">{tags.length}</p>
            </div>
            <div className="ai-muted-panel px-3 py-2">
              <p className="text-[11px] text-slate-500">标签引用</p>
              <p className="ai-kpi-value">{totalTagRefs}</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/graph"
            className="ai-btn-ghost inline-flex items-center justify-center gap-2 border border-white/[0.08] px-4 py-2.5 text-sm"
          >
            关系图
          </Link>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="ai-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            新建
          </button>
        </div>
      </div>

      <div className="ai-tab-group mb-6 sticky top-[4.7rem] z-10">
        {(
          [
            ["library", "知识库"],
            ["system", "知识体系"],
            ["feeds", "资讯订阅"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`ai-tab ${activeTab === key ? "ai-tab-active" : "ai-tab-inactive"}`}
          >
            <p className="text-sm font-medium">{label}</p>
          </button>
        ))}
      </div>

      <div
        className={`transition-all duration-200 ${
          tabSlideDir === "left" ? "animate-slide-in-left" : tabSlideDir === "right" ? "animate-slide-in-right" : ""
        }`}
      >
      {activeTab === "library" ? (
        <>
          <section className="ai-card-strong mb-5 space-y-3 p-4 sm:p-5">
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
              <p className="text-xs text-violet-200/90">
                无需先定义主题：持续上传链接、PDF、笔记即可自动整理、打标、归纳。
              </p>
            </div>
            <div className="space-y-2">
              <p className="ai-section-label">Stream Inbox</p>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={streamBatch}
                    onChange={(e) => setStreamBatch(e.target.checked)}
                    className="ai-checkbox"
                  />
                  批量输入模式（自动拆分多条链接/多段笔记）
                </label>
                <span className="text-xs text-slate-500">用 `---` 分隔笔记段落</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
                <textarea
                  ref={streamInputRef}
                  value={streamInput}
                  onChange={(e) => setStreamInput(e.target.value)}
                  rows={3}
                  placeholder={
                    streamBatch
                      ? "可一次粘贴多条内容：链接一行一个；笔记用 --- 分段"
                      : "粘贴一条链接或一段笔记（自动识别并归档）"
                  }
                  className="ai-input resize-none"
                />
                <input
                  value={streamTags}
                  onChange={(e) => setStreamTags(e.target.value)}
                  placeholder="可选标签（逗号）"
                  className="ai-input"
                />
                <button type="button" onClick={() => void streamIngest()} className="ai-btn-primary px-4 py-2.5 text-sm">
                  {streamSaving ? "归档中…" : "自动归档"}
                </button>
              </div>
              {streamPreview.length ? (
                <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                  <p className="text-xs text-slate-500">拆分预览（最多显示 8 条）</p>
                  <ul className="mt-2 space-y-1">
                    {streamPreview.map((item, idx) => (
                      <li key={`${idx}-${item.slice(0, 12)}`} className="truncate text-xs text-slate-300">
                        {idx + 1}. {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="ai-section-label">Smart Capture</p>
                <h2 className="mt-1 text-base font-semibold text-slate-100">链接采集与自动摘要</h2>
              </div>
              <p className="text-xs text-slate-500">支持微信 / PDF 链接 / 小红书 / B站 / 网页</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto_auto]">
              <input
                value={captureUrl}
                onChange={(e) => setCaptureUrl(e.target.value)}
                placeholder="粘贴文章或视频链接，例如 https://..."
                className="ai-input"
              />
              <input
                value={captureTags}
                onChange={(e) => setCaptureTags(e.target.value)}
                placeholder="附加标签（可选）"
                className="ai-input"
              />
              <button
                type="button"
                onClick={() => void onSmartCapture(false)}
                disabled={captureLoading}
                className="ai-btn-secondary px-4 py-2.5 text-sm"
              >
                预览提取
              </button>
              <button
                type="button"
                onClick={() => void onSmartCapture(true)}
                disabled={captureLoading}
                className="ai-btn-primary px-4 py-2.5 text-sm"
              >
                直接入库
              </button>
            </div>
            {captureDraft ? (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                <p className="text-sm font-medium text-cyan-100">{captureDraft.title}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-cyan-200/75">{captureDraft.summary}</p>
                {captureDraft.suggestedTags.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {captureDraft.suggestedTags.slice(0, 6).map((tg) => (
                      <span
                        key={tg}
                        className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100"
                      >
                        {tg}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="ai-card p-4 sm:p-5 space-y-3">
        <label className="block">
          <span className="sr-only">搜索</span>
          <input
            ref={searchInputRef}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="搜索标题、正文、链接…"
            className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-4 py-3 text-[15px] outline-none ring-cyan-500/30 placeholder:text-slate-600 focus:ring-2"
            enterKeyHint="search"
          />
        </label>

        <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              activeTag === null
                ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
                : "border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/[0.14] hover:text-slate-200"
            }`}
          >
            全部
          </button>
          {tagChips.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTag((cur) => (cur === t.name ? null : t.name))}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                activeTag === t.name
                  ? "border-violet-500/40 bg-violet-500/15 text-violet-100"
                  : "border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/[0.14] hover:text-slate-200"
              }`}
            >
              {t.name}
              <span className="ml-1 font-mono text-[10px] text-slate-500">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

          <ul className="mt-4 space-y-3">
        {loading ? (
          <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-10 text-center text-sm text-slate-500">
            加载中…
          </li>
        ) : entries.length === 0 ? (
          <li className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-12 text-center text-sm text-slate-500">
            暂无条目。点右下角「新建」或从系统分享菜单把网页保存进来。
          </li>
        ) : (
          entries.map((item) => (
            <li key={item.id}>
              <Link
                href={`/${item.id}`}
                className="ai-card ai-card-hover block cursor-pointer px-4 py-4 sm:px-5 hover:-translate-y-0.5 transition-transform"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-white/[0.08] bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                        {kindLabel(item.kind)}
                      </span>
                      {item.origin ? (
                        <span className="rounded-md border border-cyan-500/15 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100/90">
                          {item.origin}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="text-[15px] font-medium leading-snug text-slate-100">{item.title}</h2>
                    {item.url ? (
                      <p className="truncate font-mono text-[11px] text-slate-600">{item.url}</p>
                    ) : null}
                    {item.body ? (
                      <p className="line-clamp-2 text-sm leading-relaxed text-slate-500">{item.body}</p>
                    ) : null}
                    {item.tags.length ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.tags.map((tg) => (
                          <span
                            key={tg.id}
                            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400"
                          >
                            {tg.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 pt-1 text-slate-600">→</span>
                </div>
              </Link>
            </li>
          ))
        )}
          </ul>
        </>
      ) : null}
      </div>

      {activeTab === "system" ? (
        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="ai-card-strong space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="ai-section-label">Knowledge Map</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-100">你的学习知识体系</h2>
              </div>
              <Link href="/graph" className="ai-btn-ghost border border-white/[0.08] px-3 py-2 text-xs">
                查看关系图
              </Link>
            </div>
            {learningPillars.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-8 text-sm text-slate-500">
                还没有形成知识支柱。先从「知识库」收藏 3-5 篇核心资料并打标签。
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {learningPillars.map((tag, idx) => (
                  <div key={tag.id} className="ai-metric-tile">
                    <p className="font-mono text-[10px] text-slate-500">Pillar {idx + 1}</p>
                    <p className="mt-1 text-sm font-medium text-slate-100">{tag.name}</p>
                    <p className="mt-1 text-xs text-slate-500">已积累 {tag.count} 条相关知识</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="ai-card-strong space-y-4 p-4 sm:p-5">
            <div>
              <p className="ai-section-label">Next Learning Actions</p>
              <h3 className="mt-1 text-base font-semibold text-slate-100">下一步建议</h3>
            </div>
            <button
              type="button"
              onClick={() => void loadLearningPath()}
              className="ai-btn-secondary w-full py-2 text-xs"
            >
              {pathLoading ? "生成中…" : "生成课程式学习路径"}
            </button>
            {learningPath.length ? (
              <div className="space-y-2 rounded-xl border border-white/[0.08] bg-black/20 p-3">
                {learningPath.slice(0, 4).map((stage) => (
                  <div key={stage.id} className="rounded-lg border border-white/[0.06] px-3 py-2">
                    <p className="text-xs font-medium text-slate-200">{stage.name}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{stage.goal}</p>
                    <p className="mt-1 text-[11px] text-cyan-200/70">复习计划：{stage.reviewPlan}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <ul className="space-y-2">
              {learningPillars.slice(0, 4).map((tag) => (
                <li key={tag.id} className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm">
                  <p className="font-medium text-slate-200">补强「{tag.name}」</p>
                  <p className="mt-1 text-xs text-slate-500">
                    再补充 2 条高质量来源，并整理为 1 条结构化笔记（概念、案例、实践步骤）。
                  </p>
                </li>
              ))}
              {learningPillars.length === 0 ? (
                <li className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-xs text-slate-500">
                  从一个主题开始，例如：系统设计 / AI 工程 / 管理沟通。
                </li>
              ) : null}
            </ul>
          </div>
        </section>
      ) : null}

      {activeTab === "feeds" ? (
        <section className="space-y-4">
          <div className="ai-card-strong space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="ai-section-label">Auto Subscriptions</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-100">定时自动订阅刷新（Cron）</h2>
              </div>
              <p className="text-xs text-slate-500">后端 worker 按 refreshMinutes 自动抓取、去重并入库</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto_auto]">
              <select
                value={subForm.type}
                onChange={(e) => setSubForm((f) => ({ ...f, type: e.target.value as "RSS" | "SEED_URL" }))}
                className="ai-select"
              >
                <option value="RSS">RSS</option>
                <option value="SEED_URL">网页</option>
              </select>
              <input
                value={subForm.url}
                onChange={(e) => setSubForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://..."
                className="ai-input"
              />
              <input
                value={subForm.refreshMinutes}
                onChange={(e) => setSubForm((f) => ({ ...f, refreshMinutes: e.target.value }))}
                className="ai-input w-24"
                placeholder="60"
              />
              <button type="button" onClick={() => void createSubscription()} className="ai-btn-primary px-4 py-2 text-sm">
                {submittingSub ? "添加中…" : "添加订阅"}
              </button>
            </div>
            <ul className="space-y-2">
              {subscriptions.map((s) => (
                <li key={s.id} className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm">
                  <p className="font-medium text-slate-200">{s.config?.url ?? "-"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {s.type} · 每 {s.refreshCron ?? "60"} 分钟刷新 · 上次抓取{" "}
                    {s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleString() : "尚未抓取"}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void refreshSubscription(s.id)}
                      className="ai-btn-ghost border border-white/[0.08] px-2.5 py-1.5 text-xs"
                    >
                      立即刷新
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeSubscription(s.id)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-100"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="ai-card-strong space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="ai-section-label">PDF Parser</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-100">PDF 上传解析入库</h2>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                className="ai-input"
              />
              <input value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} placeholder="标题（可选）" className="ai-input" />
              <input value={pdfTags} onChange={(e) => setPdfTags(e.target.value)} placeholder="标签（逗号分隔）" className="ai-input" />
              <button type="button" onClick={() => void uploadPdf()} className="ai-btn-primary px-4 py-2 text-sm">
                {pdfUploading ? "解析中…" : "上传并入库"}
              </button>
            </div>
          </div>

          <div className="ai-card-strong space-y-3 p-4 sm:p-5">
            <div>
              <p className="ai-section-label">Semantic Search</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">语义检索（向量）</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={semanticQ}
                onChange={(e) => setSemanticQ(e.target.value)}
                placeholder="例如：如何做系统设计容量规划"
                className="ai-input"
              />
              <button type="button" onClick={() => void runSemanticSearch()} className="ai-btn-secondary px-4 py-2 text-sm">
                {semanticLoading ? "检索中…" : "语义检索"}
              </button>
            </div>
            <ul className="space-y-2">
              {semanticResults.map((r) => (
                <li key={`${r.document.id}-${r.snippet.slice(0, 16)}`} className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2">
                  <p className="text-xs text-cyan-200/80">相似度 {(r.score * 100).toFixed(1)}%</p>
                  <p className="mt-1 text-sm font-medium text-slate-200">{r.document.title ?? "未命名文档"}</p>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-2">{r.snippet}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="ai-card-strong space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="ai-section-label">Topic Subscriptions</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-100">自动追踪学习主题资讯</h2>
              </div>
              <p className="text-xs text-slate-500">建议订阅 3~8 个主题，聚焦你的学习主线</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="添加主题，例如：RAG, 系统设计, 港股量化"
                className="ai-input"
              />
              <button type="button" onClick={addTopic} className="ai-btn-secondary px-4 py-2.5 text-sm">
                添加主题
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => {
                    setFeedTopic(topic);
                    void loadFeeds(topic);
                  }}
                  className={`ai-chip ${feedTopic === topic ? "ai-chip-active" : ""}`}
                >
                  {topic}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setTopics((cur) => cur.filter((v) => v !== topic));
                      if (feedTopic === topic) setFeedTopic("");
                    }}
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-white/[0.1] hover:text-slate-200"
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadFeeds(feedTopic)}
                disabled={!feedTopic || feedLoading}
                className="ai-btn-primary px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {feedLoading ? "抓取中…" : `刷新「${feedTopic || "主题"}」资讯`}
              </button>
            </div>
          </div>

          <ul className="space-y-3">
            {feedItems.map((item) => (
              <li key={`${item.link}-${item.pubDate ?? ""}`} className="ai-card p-4">
                <p className="text-xs text-slate-500">
                  {item.source}
                  {item.pubDate ? ` · ${new Date(item.pubDate).toLocaleString()}` : ""}
                </p>
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-sm font-medium text-slate-100 hover:text-cyan-200"
                >
                  {item.title}
                </a>
                {item.summary ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.summary}</p> : null}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="ai-btn-ghost border border-white/[0.08] px-2.5 py-1.5 text-xs"
                    onClick={() => {
                      setCaptureUrl(item.link);
                      setActiveTab("library");
                      void onSmartCapture(true, item.link);
                    }}
                  >
                    收藏到知识库
                  </button>
                </div>
              </li>
            ))}
            {!feedLoading && feedItems.length === 0 ? (
              <li className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center text-sm text-slate-500">
                先添加一个主题并点击刷新，例如「AI Agent」「系统设计」「求职转型」。
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/[0.08] bg-[#030712]/92 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:hidden"
        aria-label="知识库底部操作"
      >
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          {LEARNING_APP_URL ? (
            <Link
              href={LEARNING_APP_URL}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300"
            >
              <span className="text-lg leading-none">◎</span>
              学习
            </Link>
          ) : (
            <span className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-slate-700">
              <span className="text-lg leading-none opacity-30">◎</span>
              学习
            </span>
          )}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/90 to-violet-600/90 text-xl font-light text-white shadow-glow-cyan"
            aria-label="新建知识条目"
          >
            +
          </button>
          <Link
            href="/graph"
            className="flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300"
          >
            <span className="text-lg leading-none">⎔</span>
            图谱
          </Link>
        </div>
      </nav>

      <div className="fixed z-30 sm:hidden" style={{ left: `${fabPos.x}px`, bottom: `${fabPos.y}px` }}>
        <button
          type="button"
          onTouchStart={fabOnTouchStart}
          onTouchMove={fabOnTouchMove}
          onTouchEnd={fabOnTouchEnd}
          onClick={() => {
            if (!fabDragging.current) setQuickOpen((v) => !v);
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-500/20 text-cyan-100 shadow-lg backdrop-blur-xl"
          aria-label="打开快速操作"
        >
          ⚡
        </button>
      </div>
      {quickOpen ? (
        <div className="fixed z-30 sm:hidden" style={{ left: `${Math.max(8, fabPos.x - 140)}px`, bottom: `${fabPos.y + 52}px` }}>
          <div className="ai-card-strong w-48 p-2">
            <button
              type="button"
              className="ai-btn-ghost w-full justify-start text-xs"
              onClick={() => {
                setSheetOpen(true);
                setQuickOpen(false);
              }}
            >
              + 快速新建
            </button>
            <button
              type="button"
              className="ai-btn-ghost w-full justify-start text-xs"
              onClick={() => {
                setActiveTab("library");
                setQuickOpen(false);
                window.setTimeout(() => streamInputRef.current?.focus(), 60);
              }}
            >
              归档到 Stream
            </button>
            <button
              type="button"
              className="ai-btn-ghost w-full justify-start text-xs"
              onClick={() => {
                setMobilePrefsOpen((v) => !v);
              }}
            >
              主题与密度
            </button>
            <button
              type="button"
              className="ai-btn-ghost w-full justify-start text-xs"
              onClick={() => {
                setActiveTab("library");
                setQuickOpen(false);
                window.setTimeout(() => searchInputRef.current?.focus(), 60);
              }}
            >
              搜索知识库
            </button>
          </div>
        </div>
      ) : null}
      {mobilePrefsOpen ? (
        <div className="fixed inset-x-4 bottom-40 z-30 sm:hidden">
          <div className="ai-card-strong p-3 space-y-3">
            <div>
              <p className="text-[11px] text-slate-500">主题</p>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setThemeMode("dark")} className={`ai-btn-ghost px-3 py-1.5 text-xs ${theme === "dark" ? "border border-white/20" : ""}`}>深色</button>
                <button type="button" onClick={() => setThemeMode("light")} className={`ai-btn-ghost px-3 py-1.5 text-xs ${theme === "light" ? "border border-white/20" : ""}`}>浅色</button>
              </div>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">密度</p>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setDensityMode("cozy")} className={`ai-btn-ghost px-3 py-1.5 text-xs ${density === "cozy" ? "border border-white/20" : ""}`}>舒适</button>
                <button type="button" onClick={() => setDensityMode("compact")} className={`ai-btn-ghost px-3 py-1.5 text-xs ${density === "compact" ? "border border-white/20" : ""}`}>紧凑</button>
              </div>
            </div>
            <button type="button" onClick={() => setMobilePrefsOpen(false)} className="ai-btn-secondary w-full py-2 text-xs">完成</button>
          </div>
        </div>
      ) : null}

      {sheetOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="关闭"
            onClick={() => setSheetOpen(false)}
          />
          <div
            className="relative z-10 w-full max-w-lg rounded-t-3xl border border-white/[0.1] bg-[#070b18] p-5 shadow-2xl sm:rounded-3xl"
            onTouchStart={handleSheetTouchStart}
            onTouchEnd={handleSheetTouchEnd}
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20 sm:hidden" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">新建条目</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
              >
                关闭
              </button>
            </div>
            <form onSubmit={onCreate} className="space-y-4">
              <div className="flex gap-2 rounded-xl border border-white/[0.08] bg-black/25 p-1">
                {(
                  [
                    ["link", "链接"],
                    ["clip", "摘录"],
                    ["note", "笔记"],
                  ] as const
                ).map(([k, lab]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, kind: k }))}
                    className={`flex-1 rounded-lg py-2 text-xs font-medium transition ${
                      form.kind === k
                        ? "bg-white/[0.1] text-cyan-100"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {lab}
                  </button>
                ))}
              </div>
              <div>
                <label className="ai-section-label mb-1.5 block">标题</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm outline-none ring-cyan-500/25 focus:ring-2"
                  placeholder="用一句话概括这条知识"
                />
              </div>
              {form.kind === "link" ? (
                <div>
                  <label className="ai-section-label mb-1.5 block">URL</label>
                  <input
                    required
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 font-mono text-xs outline-none ring-cyan-500/25 focus:ring-2"
                    placeholder="https://"
                    inputMode="url"
                  />
                </div>
              ) : null}
              <div>
                <label className="ai-section-label mb-1.5 block">
                  {form.kind === "note" ? "正文" : "摘录 / 备注"}
                </label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  rows={4}
                  className="ai-input w-full resize-none rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm outline-none ring-cyan-500/25 focus:ring-2"
                  placeholder={
                    form.kind === "clip"
                      ? "粘贴段落、金句或读后感"
                      : "支持多行：会议纪要、想法、待办…"
                  }
                />
              </div>
              <div>
                <label className="ai-section-label mb-1.5 block">来源平台（可选）</label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {ORIGIN_PRESETS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, origin: o }))}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                        form.origin === o
                          ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-100"
                          : "border-white/[0.08] text-slate-500 hover:border-white/[0.14] hover:text-slate-300"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                <input
                  value={form.origin}
                  onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))}
                  className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2 text-sm outline-none ring-cyan-500/25 focus:ring-2"
                  placeholder="或自定义来源"
                />
              </div>
              <div>
                <label className="ai-section-label mb-1.5 block">标签</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  className="ai-input w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2 text-sm outline-none ring-cyan-500/25 focus:ring-2"
                  placeholder="用逗号分隔，例如：产品, 增长, 阅读清单"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="ai-btn-primary flex w-full items-center justify-center py-3 text-sm disabled:opacity-60"
              >
                {saving ? "保存中…" : "保存到知识库"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
