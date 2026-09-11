"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import WikiReadPane from "@/components/wiki/WikiReadPane";
import FolderImportPanel from "@/components/library/FolderImportPanel";
import ExportToolsPanel from "@/components/library/ExportToolsPanel";
import LibraryOnboardingBanner from "@/components/library/LibraryOnboardingBanner";
import LibraryTabNav, { type LibraryTab } from "@/components/library/LibraryTabNav";
import CloudDemoStrip from "@/components/CloudDemoStrip";
import { isCloudDemoInstance } from "@/lib/cloudDemo";
import { dismissDemoAfterCorpusUpload } from "@/lib/productPrefs";
import LibraryPipelinePanel from "@/components/library/LibraryPipelinePanel";
import SavedCardsPanel from "@/components/library/SavedCardsPanel";
import SimpleUploadZone from "@/components/library/SimpleUploadZone";
import { formatRecordStatus } from "@/lib/recordStatus";
import {
  deleteRecord,
  fetchAssociations,
  searchCorpus,
  searchCorpusHybrid,
  curatorSuggest,
  type CorpusSearchHit,
  formatWikiExtractedBody,
  getWikiContent,
  listRecords,
  listWiki,
  uploadFile,
  type AiFormatMeta,
  type WikiReadingTab,
  type AssociationEdge,
  type AssociationNode,
  type AssociationsPayload,
  type IngestRecord,
  type ReadingCorpusSnippet,
  type UploadProgress,
  type WikiDoc,
} from "@/lib/api";

function wikiStemFromMdName(name: string | null): string {
  if (!name) return "";
  const base = name.split("/").pop() ?? name;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base.replace(/\.[^/.]+$/, "");
}

function normalizeCorpusQuery(s: string): string {
  return s.trim().toLowerCase();
}

function recordMatchesCorpusQuery(r: IngestRecord, q: string): boolean {
  if (!q) return true;
  const hay = [r.file_name, r.summary ?? "", ...(r.tags ?? [])].join("\n").toLowerCase();
  return hay.includes(q);
}

function wikiDocMatchesCorpusQuery(d: WikiDoc, q: string): boolean {
  if (!q) return true;
  const hay = `${d.name}\n${d.path ?? ""}`.toLowerCase();
  return hay.includes(q);
}

export default function LibraryPage() {
  const openedFromQueryRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [records, setRecords] = useState<IngestRecord[]>([]);
  const [wikiDocs, setWikiDocs] = useState<WikiDoc[]>([]);
  const [activeWiki, setActiveWiki] = useState<string | null>(null);
  const [wikiExtracted, setWikiExtracted] = useState<string | null>(null);
  const [wikiFormattedExtracted, setWikiFormattedExtracted] = useState<string | null>(null);
  const [readingTab, setReadingTab] = useState<WikiReadingTab>("original");
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [originalBytesAvailable, setOriginalBytesAvailable] = useState(false);
  const [formatExtractBusy, setFormatExtractBusy] = useState(false);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [associations, setAssociations] = useState<AssociationsPayload | null>(null);
  const [readingPaneVh, setReadingPaneVh] = useState<40 | 56 | 72 | 85>(56);
  const [corpusQuery, setCorpusQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "hybrid">("hybrid");
  const [serverSearchHits, setServerSearchHits] = useState<CorpusSearchHit[]>([]);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);
  const [curatorBusy, setCuratorBusy] = useState(false);
  const [curatorResult, setCuratorResult] = useState<{
    suggested_tags: string[];
    quality_notes: string;
    split_suggestions: string[];
    flashcard_ideas: string[];
  } | null>(null);
  const [splitWiki, setSplitWiki] = useState<string | null>(null);
  const [splitWikiExtracted, setSplitWikiExtracted] = useState<string | null>(null);
  const [splitWikiFormattedExtracted, setSplitWikiFormattedExtracted] = useState<string | null>(null);
  const [splitOriginalFilename, setSplitOriginalFilename] = useState<string | null>(null);
  const [splitOriginalBytesAvailable, setSplitOriginalBytesAvailable] = useState(false);
  const [splitReadingTab, setSplitReadingTab] = useState<WikiReadingTab>("original");
  const [splitWikiLoading, setSplitWikiLoading] = useState(false);
  const [splitFormatExtractBusy, setSplitFormatExtractBusy] = useState(false);
  const [aiFormatMeta, setAiFormatMeta] = useState<AiFormatMeta | null>(null);
  const [splitAiFormatMeta, setSplitAiFormatMeta] = useState<AiFormatMeta | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("upload");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash === "#library-read" || hash === "#library-annotate") setLibraryTab("read");
    else if (hash === "#library-saved") setLibraryTab("upload");
    else if (hash.startsWith("#library-")) setLibraryTab("advanced");
  }, []);

  type RelRow = { otherId: number; fileName: string; slug: string; shared: string[]; themes: string[] };

  const relatedById = useMemo(() => {
    if (!associations?.nodes?.length || !associations.edges?.length) return new Map<number, RelRow[]>();
    const idTo = new Map(associations.nodes.map((n) => [n.id, n]));
    const m = new Map<number, RelRow[]>();
    const push = (from: number, to: number, shared: string[], themes: string[]) => {
      const peer = idTo.get(to);
      if (!peer) return;
      const row = m.get(from) ?? [];
      row.push({ otherId: to, fileName: peer.file_name, slug: peer.slug, shared, themes });
      m.set(from, row);
    };
    for (const e of associations.edges) {
      const sh = e.shared_tags ?? [];
      const th = e.semantic_themes ?? [];
      push(e.source_id, e.target_id, sh, th);
      push(e.target_id, e.source_id, sh, th);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          b.shared.length + b.themes.length - (a.shared.length + a.themes.length) || a.fileName.localeCompare(b.fileName),
      );
    }
    return m;
  }, [associations]);

  const nodesById = useMemo(() => {
    if (!associations?.nodes) return new Map<number, AssociationNode>();
    return new Map(associations.nodes.map((n) => [n.id, n]));
  }, [associations]);

  const recordNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of records) {
      if (r.id != null) m.set(r.id, r.file_name);
    }
    return m;
  }, [records]);

  const activeWikiSlugStem = useMemo(() => wikiStemFromMdName(activeWiki), [activeWiki]);

  const relatedForActiveWiki = useMemo(() => {
    if (!associations?.nodes?.length || !activeWikiSlugStem) return [];
    const node = associations.nodes.find((n) => n.slug === activeWikiSlugStem);
    if (node == null) return [];
    return relatedById.get(node.id) ?? [];
  }, [associations, activeWikiSlugStem, relatedById]);

  const readingCorpusSnippets = useMemo((): ReadingCorpusSnippet[] => {
    if (!activeWiki) return [];
    const stem = wikiStemFromMdName(activeWiki);
    const byId = new Map(records.filter((r) => r.id != null).map((r) => [r.id as number, r]));
    const out: ReadingCorpusSnippet[] = [];
    const seen = new Set<string>();
    const push = (file_name: string, summary: string) => {
      const s = summary.trim();
      if (!s || seen.has(file_name)) return;
      seen.add(file_name);
      out.push({ file_name, summary: s });
    };
    const currentRec = records.find((r) => wikiStemFromMdName(r.file_name) === stem);
    if (currentRec?.summary) push(currentRec.file_name, currentRec.summary);
    for (const rel of relatedForActiveWiki) {
      const r = byId.get(rel.otherId);
      if (r?.summary) push(r.file_name, r.summary);
    }
    return out.slice(0, 12);
  }, [activeWiki, records, relatedForActiveWiki]);

  const activeDocTitle = useMemo(() => {
    if (!activeWiki) return "";
    const stem = wikiStemFromMdName(activeWiki);
    const r = records.find((x) => wikiStemFromMdName(x.file_name) === stem);
    return r?.file_name ?? activeWiki;
  }, [activeWiki, records]);

  const corpusQ = normalizeCorpusQuery(corpusQuery);

  useEffect(() => {
    if (corpusQ.length < 2) {
      setServerSearchHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      setServerSearchLoading(true);
      const searchFn = searchMode === "hybrid" ? searchCorpusHybrid : searchCorpus;
      void searchFn(corpusQuery.trim(), 25)
        .then((r) => setServerSearchHits(r.items))
        .catch(() => setServerSearchHits([]))
        .finally(() => setServerSearchLoading(false));
    }, 320);
    return () => window.clearTimeout(t);
  }, [corpusQuery, corpusQ, searchMode]);

  const filteredWikiDocs = useMemo(
    () => wikiDocs.filter((d) => wikiDocMatchesCorpusQuery(d, corpusQ)),
    [wikiDocs, corpusQ],
  );

  const filteredRecords = useMemo(
    () => records.filter((r) => recordMatchesCorpusQuery(r, corpusQ)),
    [records, corpusQ],
  );

  const splitWikiSlugStem = useMemo(() => wikiStemFromMdName(splitWiki), [splitWiki]);

  const relatedForSplitWiki = useMemo(() => {
    if (!associations?.nodes?.length || !splitWikiSlugStem) return [];
    const node = associations.nodes.find((n) => n.slug === splitWikiSlugStem);
    if (node == null) return [];
    return relatedById.get(node.id) ?? [];
  }, [associations, splitWikiSlugStem, relatedById]);

  const splitActiveDocTitle = useMemo(() => {
    if (!splitWiki) return "";
    const stem = wikiStemFromMdName(splitWiki);
    const r = records.find((x) => wikiStemFromMdName(x.file_name) === stem);
    return r?.file_name ?? splitWiki;
  }, [splitWiki, records]);

  const splitReadingCorpusSnippets = useMemo((): ReadingCorpusSnippet[] => {
    if (!splitWiki) return [];
    const stem = wikiStemFromMdName(splitWiki);
    const byId = new Map(records.filter((r) => r.id != null).map((r) => [r.id as number, r]));
    const out: ReadingCorpusSnippet[] = [];
    const seen = new Set<string>();
    const push = (file_name: string, summary: string) => {
      const s = summary.trim();
      if (!s || seen.has(file_name)) return;
      seen.add(file_name);
      out.push({ file_name, summary: s });
    };
    const currentRec = records.find((r) => wikiStemFromMdName(r.file_name) === stem);
    if (currentRec?.summary) push(currentRec.file_name, currentRec.summary);
    for (const rel of relatedForSplitWiki) {
      const r = byId.get(rel.otherId);
      if (r?.summary) push(r.file_name, r.summary);
    }
    return out.slice(0, 12);
  }, [splitWiki, records, relatedForSplitWiki]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function refreshWikiList() {
    try {
      setError(null);
      const docs = await listWiki();
      setWikiDocs(docs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文档列表加载失败，请稍后重试。");
    }
  }

  async function refreshRecords() {
    try {
      setError(null);
      const rows = await listRecords(40);
      setRecords(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "最近导入记录加载失败，请稍后重试。");
    }
  }

  async function refreshAssociations() {
    try {
      const a = await fetchAssociations(40);
      setAssociations(a);
    } catch {
      setAssociations({ nodes: [], edges: [] });
    }
  }

  useEffect(() => {
    void refreshWikiList();
    void refreshRecords();
    void refreshAssociations();
  }, []);

  useEffect(() => {
    if (wikiDocs.length === 0 || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wikiFromQuery = params.get("wiki");
    const sectionFromQuery = params.get("section");
    const openKey = `${wikiFromQuery ?? ""}:${sectionFromQuery ?? ""}`;
    if (!wikiFromQuery || openedFromQueryRef.current === openKey) return;
    const exists = wikiDocs.some((d) => d.name === wikiFromQuery);
    if (!exists) return;
    openedFromQueryRef.current = openKey;
    void onSelectWiki(wikiFromQuery).then(() => {
      if (sectionFromQuery) {
        setReadingTab("ai");
      }
      window.setTimeout(() => {
        document.getElementById("library-read")?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (sectionFromQuery) {
          document.getElementById(sectionFromQuery)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 500);
    });
  }, [wikiDocs]);

  async function onUpload(file: File) {
    try {
      setUploading(true);
      setError(null);
      setUploadProgress({ percent: 2, phase: "开始处理…" });
      const record = await uploadFile(file, (p) => setUploadProgress(p));
      setRecords((prev) => {
        const rid = record.id;
        const tail = rid != null ? prev.filter((x) => x.id !== rid) : prev;
        return [record, ...tail].slice(0, 20);
      });
      const name = record.file_name;
      setToast(
        record.status === "processing"
          ? `「${name}」已接收，正在后台生成摘要与闪卡。可在下方查看进度。`
          : `「${name}」已入库，正在拆知识点。可去推荐流刷读。`,
      );
      dismissDemoAfterCorpusUpload();
      window.setTimeout(() => {
        document.getElementById("library-pipeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 400);
      await refreshWikiList();
      await refreshRecords();
      await refreshAssociations();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导入失败，请重试。";
      setError(msg);
      const head = "导入失败：";
      const tail = msg.length > 180 ? `${msg.slice(0, 180)}…` : msg;
      setToast(`${head}${tail}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function onDeleteRecord(r: IngestRecord) {
    if (r.id == null) return;
    const ok = window.confirm(
      `确定从本机删除「${r.file_name}」？\n摘要、标签、wiki、raw 和缓存会一起删掉，无法恢复。`,
    );
    if (!ok) return;
    try {
      setError(null);
      const out = await deleteRecord(r.id);
      setRecords((prev) => prev.filter((x) => x.id !== r.id));
      const wikiName = `${out.removed_base}.md`;
      if (activeWiki === wikiName) {
        setActiveWiki(null);
        setWikiExtracted(null);
        setWikiFormattedExtracted(null);
        setReadingTab("original");
        setOriginalFilename(null);
        setOriginalBytesAvailable(false);
        setAiFormatMeta(null);
      }
      if (splitWiki === wikiName) {
        setSplitWiki(null);
        setSplitWikiExtracted(null);
        setSplitWikiFormattedExtracted(null);
        setSplitOriginalFilename(null);
        setSplitOriginalBytesAvailable(false);
        setSplitReadingTab("original");
        setSplitAiFormatMeta(null);
      }
      setToast(`「${r.file_name}」已删除。`);
      await refreshWikiList();
      await refreshAssociations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败，请稍后重试。");
    }
  }

  async function onSelectWiki(name: string) {
    try {
      setError(null);
      if (splitWiki === name) {
        setSplitWiki(null);
        setSplitWikiExtracted(null);
        setSplitWikiFormattedExtracted(null);
        setSplitOriginalFilename(null);
        setSplitOriginalBytesAvailable(false);
        setSplitReadingTab("original");
        setSplitAiFormatMeta(null);
      }
      setActiveWiki(name);
      setWikiExtracted(null);
      setWikiFormattedExtracted(null);
      setReadingTab("original");
      setOriginalFilename(null);
      setOriginalBytesAvailable(false);
      setWikiLoading(true);
      const payload = await getWikiContent(name);
      setWikiExtracted(payload.extracted_text);
      setWikiFormattedExtracted(payload.formatted_text);
      setOriginalFilename(payload.original_filename);
      setOriginalBytesAvailable(payload.original_bytes_available);
      setAiFormatMeta(payload.ai_format_meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法打开该文档");
      setActiveWiki(null);
      setWikiExtracted(null);
      setWikiFormattedExtracted(null);
      setReadingTab("original");
      setOriginalFilename(null);
      setOriginalBytesAvailable(false);
      setAiFormatMeta(null);
    } finally {
      setWikiLoading(false);
    }
  }

  async function onFormatExtractedBody() {
    if (!activeWiki || !wikiExtracted) return;
    try {
      setError(null);
      setFormatExtractBusy(true);
      const out = await formatWikiExtractedBody(activeWiki);
      setWikiFormattedExtracted(out.formatted);
      setReadingTab("compare");
      setAiFormatMeta(out.ai_format_meta ?? null);
      setToast(`已重新排版（${out.provider}，${out.segments} 段）。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 排版失败，请稍后重试。");
    } finally {
      setFormatExtractBusy(false);
    }
  }

  async function loadSplitWiki(name: string | null) {
    if (name === null) {
      setSplitWiki(null);
      setSplitWikiExtracted(null);
      setSplitWikiFormattedExtracted(null);
      setSplitOriginalFilename(null);
      setSplitOriginalBytesAvailable(false);
      setSplitWikiLoading(false);
      setSplitReadingTab("original");
      setSplitAiFormatMeta(null);
      return;
    }
    if (activeWiki === name) {
      setToast("右栏用于对照另一篇，请选择与左栏不同的篇目。");
      return;
    }
    try {
      setSplitWikiLoading(true);
      setError(null);
      setSplitWiki(name);
      setSplitWikiExtracted(null);
      setSplitWikiFormattedExtracted(null);
      setSplitOriginalFilename(null);
      setSplitOriginalBytesAvailable(false);
      setSplitReadingTab("original");
      const payload = await getWikiContent(name);
      setSplitWikiExtracted(payload.extracted_text);
      setSplitWikiFormattedExtracted(payload.formatted_text);
      setSplitOriginalFilename(payload.original_filename);
      setSplitOriginalBytesAvailable(payload.original_bytes_available);
      setSplitAiFormatMeta(payload.ai_format_meta ?? null);
    } catch (e) {
      setSplitWiki(null);
      setSplitWikiExtracted(null);
      setSplitWikiFormattedExtracted(null);
      setSplitOriginalFilename(null);
      setSplitOriginalBytesAvailable(false);
      setSplitAiFormatMeta(null);
      setError(e instanceof Error ? e.message : "右栏文档加载失败");
    } finally {
      setSplitWikiLoading(false);
    }
  }

  async function onFormatSplitExtractedBody() {
    if (!splitWiki || !splitWikiExtracted) return;
    try {
      setError(null);
      setSplitFormatExtractBusy(true);
      const out = await formatWikiExtractedBody(splitWiki);
      setSplitWikiFormattedExtracted(out.formatted);
      setSplitReadingTab("compare");
      setSplitAiFormatMeta(out.ai_format_meta ?? null);
      setToast(`右栏已重新排版（${out.provider}，${out.segments} 段）。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "右栏 AI 排版失败，请稍后重试。");
    } finally {
      setSplitFormatExtractBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero hero--atlas">
        <div className="hero__spark-row">
          <span className="hero__spark" aria-hidden />
          <p className="hero__eyebrow">文库 · 闪卡起点</p>
        </div>
        <h1 className="hero__title">上传文库，拆成能刷的知识点</h1>
        <p className="hero__lead">
          入库后自动拆成易懂闪卡进入推荐流——为好理解、好记忆而写，不是原文摘抄。也可在此深读原稿与 AI 稿，对照出处。
        </p>
      </header>

      <LibraryOnboardingBanner />

      {!isCloudDemoInstance() ? <CloudDemoStrip /> : null}

      <LibraryTabNav
        tab={libraryTab}
        onTabChange={setLibraryTab}
        wikiCount={wikiDocs.length}
        recordCount={records.length}
      />

      {libraryTab === "upload" ? (
        <>
      <section className="card card--desk card--upload" id="library-upload">
        <div className="card__head card__head--compact">
          <div>
            <p className="card__kicker">导入</p>
            <h2 className="card__title">上传文库</h2>
          </div>
        </div>
        <SimpleUploadZone
          uploading={uploading}
          progress={uploadProgress}
          onFile={(file) => {
            void onUpload(file);
          }}
        />
        {error ? (
          <p className="upload-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <LibraryPipelinePanel
        onRefresh={async () => {
          await refreshRecords();
          await refreshWikiList();
        }}
      />

      <SavedCardsPanel />

      <ExportToolsPanel />

      <section className="card card--desk library-feed-cta">
        <div className="library-feed-cta__inner">
          <div>
            <p className="card__kicker">下一步</p>
            <h2 className="card__title">去推荐流刷知识点</h2>
            <p className="card__sub">拆卡完成后，在推荐流里逐个刷懂；不懂可换讲法，搞懂后保存。</p>
          </div>
          <Link href="/" className="btn btn-primary">
            打开推荐流
          </Link>
        </div>
      </section>
        </>
      ) : null}

      {libraryTab === "read" ? (
      <section className="card card--desk card--read" id="library-read">
        <div className="card__head card__head--compact">
          <div>
            <p className="card__kicker">阅读</p>
            <h2 className="card__title">原稿与 AI 稿</h2>
            <p className="card__sub" id="library-annotate">
              左侧选篇目，切换原稿 / AI 稿 / 对照。也可点「双栏对照」并排阅读。
            </p>
          </div>
        </div>
        <div className="wiki-read-controls">
          <label className="corpus-search wiki-read-controls__search">
            <span className="wiki-read-controls__label">搜索</span>
            <input
              type="search"
              className="corpus-search__input"
              value={corpusQuery}
              onChange={(e) => setCorpusQuery(e.target.value)}
              placeholder="过滤列表，或输入 ≥2 字检索…"
              aria-label="在我的文库中搜索"
              autoComplete="off"
            />
            <span className="corpus-search__mode">
              <button
                type="button"
                className={`corpus-search__mode-btn${searchMode === "keyword" ? " corpus-search__mode-btn--active" : ""}`}
                onClick={() => setSearchMode("keyword")}
              >
                关键词
              </button>
              <button
                type="button"
                className={`corpus-search__mode-btn${searchMode === "hybrid" ? " corpus-search__mode-btn--active" : ""}`}
                onClick={() => setSearchMode("hybrid")}
              >
                智能检索
              </button>
            </span>
            {corpusQ ? (
              <span className="corpus-search__meta" aria-live="polite">
                {filteredWikiDocs.length}/{wikiDocs.length} 篇 · {filteredRecords.length}/{records.length} 条
                {serverSearchLoading
                  ? " · 检索中…"
                  : serverSearchHits.length
                    ? ` · ${searchMode === "hybrid" ? "智能检索" : "全文"} ${serverSearchHits.length} 条`
                    : ""}
              </span>
            ) : null}
          </label>
          {corpusQ.length >= 2 && serverSearchHits.length > 0 ? (
            <ul className="corpus-search-hits">
              {serverSearchHits.map((hit) => (
                <li key={`${hit.kind}-${hit.title}-${hit.wiki_file_name || hit.record_id}`}>
                  <span className="corpus-search-hits__kind">{hit.kind}</span>
                  {hit.match_reason ? (
                    <span className="corpus-search-hits__reason"> · {hit.match_reason}</span>
                  ) : null}
                  <strong> {hit.title}</strong>
                  <p>{hit.snippet}</p>
                  {hit.wiki_file_name ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void onSelectWiki(hit.wiki_file_name!)}
                    >
                      打开
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="wiki-read-controls__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!activeWiki || !wikiExtracted?.trim() || !wikiFormattedExtracted?.trim()}
              onClick={() => setReadingTab("compare")}
            >
              双栏对照
            </button>
            {activeWiki ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="在右栏打开另一篇对照"
                onClick={() => {
                  if (splitWiki === activeWiki) return;
                  void loadSplitWiki(activeWiki);
                }}
              >
                右栏对照本篇
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refreshWikiList()}>
              刷新
            </button>
            <label className="wiki-read-controls__height">
              <span className="wiki-read-controls__label">高度</span>
              <select
                className="wiki-reading-height-select"
                value={readingPaneVh}
                onChange={(e) => setReadingPaneVh(Number(e.target.value) as 40 | 56 | 72 | 85)}
                aria-label="阅读区高度"
              >
                <option value={40}>低</option>
                <option value={56}>中</option>
                <option value={72}>高</option>
                <option value={85}>全屏</option>
              </select>
            </label>
          </div>
        </div>
        <div
          className="wiki-shelf"
          style={{ "--wiki-reading-vh": String(readingPaneVh) } as CSSProperties}
        >
          <div className={`wiki-grid${splitWiki ? " wiki-grid--split" : ""}`}>
            <aside className="wiki-sidebar" aria-label="文档列表（由你导入的材料生成）">
              {wikiDocs.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <div className="empty-state__deco" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                  暂无篇目。上传材料后，将自动拆成知识点闪卡。
                </div>
              ) : filteredWikiDocs.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <div className="empty-state__deco" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                  无匹配篇目。
                </div>
              ) : (
                filteredWikiDocs.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    className={`wiki-item${activeWiki === d.name ? " wiki-item--active" : ""}${
                      splitWiki === d.name ? " wiki-item--split" : ""
                    }`}
                    title="单击左栏 · Alt+点击右栏"
                    onClick={(e) => {
                      if (e.altKey) {
                        e.preventDefault();
                        void loadSplitWiki(d.name);
                        return;
                      }
                      void onSelectWiki(d.name);
                    }}
                  >
                    <span className="wiki-item__spine" aria-hidden />
                    <span className="wiki-item__label">{d.name}</span>
                  </button>
                ))
              )}
            </aside>
            <div className="wiki-read-pane wiki-preview-wrap wiki-preview-wrap--paper wiki-reading-panel">
              <div className="wiki-paper-rail" aria-hidden />
              <div className="wiki-reading-panel__column">
                <WikiReadPane
                  wikiFileName={activeWiki}
                  docTitle={activeDocTitle}
                  wikiLoading={wikiLoading}
                  wikiExtracted={wikiExtracted}
                  wikiFormattedExtracted={wikiFormattedExtracted}
                  readingTab={readingTab}
                  onReadingTab={setReadingTab}
                  originalFilename={originalFilename}
                  originalBytesAvailable={originalBytesAvailable}
                  formatExtractBusy={formatExtractBusy}
                  onFormatExtractedBody={() => void onFormatExtractedBody()}
                  related={relatedForActiveWiki}
                  corpusSnippets={readingCorpusSnippets}
                  onOpenWiki={(name) => void onSelectWiki(name)}
                  onOpenWikiInSecondary={(name) => void loadSplitWiki(name)}
                  aiFormatMeta={aiFormatMeta}
                />
              </div>
            </div>
            {splitWiki ? (
              <div className="wiki-read-pane wiki-read-pane--split wiki-preview-wrap wiki-preview-wrap--paper wiki-reading-panel">
                <div className="wiki-read-pane__chrome">
                  <span className="wiki-read-pane__title" title={splitWiki}>
                    {splitWiki}
                  </span>
                  <button type="button" className="btn btn-ghost wiki-read-pane__close" onClick={() => void loadSplitWiki(null)}>
                    关闭
                  </button>
                </div>
                <div className="wiki-paper-rail" aria-hidden />
                <div className="wiki-reading-panel__column">
                  <WikiReadPane
                    wikiFileName={splitWiki}
                    docTitle={splitActiveDocTitle}
                    wikiLoading={splitWikiLoading}
                    wikiExtracted={splitWikiExtracted}
                    wikiFormattedExtracted={splitWikiFormattedExtracted}
                    readingTab={splitReadingTab}
                    onReadingTab={setSplitReadingTab}
                    originalFilename={splitOriginalFilename}
                    originalBytesAvailable={splitOriginalBytesAvailable}
                    formatExtractBusy={splitFormatExtractBusy}
                    onFormatExtractedBody={() => void onFormatSplitExtractedBody()}
                    related={relatedForSplitWiki}
                    corpusSnippets={splitReadingCorpusSnippets}
                    onOpenWiki={(name) => void onSelectWiki(name)}
                    onOpenWikiInSecondary={(name) => void loadSplitWiki(name)}
                    aiFormatMeta={splitAiFormatMeta}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {activeWiki || splitWiki ? (
          <p className="wiki-footer wiki-read-footer">
            {activeWiki ? (
              <>
                <span className="wiki-read-footer__slot">
                  左 <strong>{activeWiki}</strong>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm library-curator-btn"
                  disabled={curatorBusy}
                  onClick={() => {
                    if (!activeWiki) return;
                    setCuratorBusy(true);
                    setCuratorResult(null);
                    void curatorSuggest(activeWiki)
                      .then(setCuratorResult)
                      .catch((e) =>
                        setCuratorResult({
                          suggested_tags: [],
                          quality_notes: e instanceof Error ? e.message : "策展失败",
                          split_suggestions: [],
                          flashcard_ideas: [],
                        }),
                      )
                      .finally(() => setCuratorBusy(false));
                  }}
                >
                  {curatorBusy ? "分析中…" : "知识点建议"}
                </button>
              </>
            ) : null}
            {splitWiki ? (
              <span className="wiki-read-footer__slot">
                右 <strong>{splitWiki}</strong>
              </span>
            ) : null}
          </p>
        ) : null}
        {curatorResult ? (
          <section className="library-curator-panel" aria-label="知识点建议">
            <h3 className="library-curator-panel__title">知识点建议 · {activeWiki}</h3>
            {curatorResult.quality_notes ? (
              <p className="library-curator-panel__notes">{curatorResult.quality_notes}</p>
            ) : null}
            {curatorResult.suggested_tags.length ? (
              <p className="library-curator-panel__tags">
                建议标签：{curatorResult.suggested_tags.join("、")}
              </p>
            ) : null}
            {curatorResult.split_suggestions.length ? (
              <ul className="library-curator-panel__list">
                {curatorResult.split_suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : null}
            {curatorResult.flashcard_ideas.length ? (
              <>
                <p className="library-curator-panel__kicker">可出题方向</p>
                <ul className="library-curator-panel__list">
                  {curatorResult.flashcard_ideas.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCuratorResult(null)}>
              关闭
            </button>
          </section>
        ) : null}
      </section>
      ) : null}

      {libraryTab === "advanced" ? (
        <>
      <FolderImportPanel
        onImported={async () => {
          await refreshWikiList();
          await refreshRecords();
          await refreshAssociations();
        }}
      />

      <details className="card card--desk library-advanced" id="library-records" open>
        <summary className="library-advanced__summary">
          <span className="card__kicker">更多</span>
          <span className="card__title">已导入材料</span>
          <span className="card__sub">摘要、标签与入库记录</span>
        </summary>
        <div className="library-advanced__body">
        {records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__deco" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            暂无材料。上传后会出现在这里，并进入知识点拆卡流程。
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__deco" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            无匹配材料。请调整上方搜索条件。
          </div>
        ) : (
          <div className="record-list">
            {filteredRecords.map((r) => (
              <article key={r.id} className="record record--folio">
                <div className="record__top">
                  <span className="record__name">{r.file_name}</span>
                  <span className="record__actions">
                    <span className="record__status">{formatRecordStatus(r.status)}</span>
                    {r.cached ? <span className="badge-cache">缓存</span> : null}
                    {r.id != null ? (
                      <button type="button" className="btn btn-record-delete" onClick={() => void onDeleteRecord(r)}>
                        删除
                      </button>
                    ) : null}
                  </span>
                </div>
                <div className="tag-row">
                  {(r.tags ?? []).map((t) => (
                    <span key={t} className="tag tag--bookmark">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="record__summary">{r.summary}</p>
                {r.contradictions && r.contradictions.length > 0 ? (
                  <div className="record__warn">
                    <p>
                      注意：与「
                      {r.contradictions
                        .map((c) => recordNameById.get(c.other_record_id) ?? `材料 #${c.other_record_id}`)
                        .join("」「")}
                      」在相同标签下说法不一致，建议对照阅读。
                    </p>
                    <div className="record__warn-actions">
                      {r.contradictions.map((c) => {
                        const otherName = recordNameById.get(c.other_record_id);
                        const otherNode = associations?.nodes?.find((n) => n.id === c.other_record_id);
                        if (!otherNode) return null;
                        return (
                          <button
                            key={c.other_record_id}
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void onSelectWiki(`${otherNode.slug}.md`)}
                          >
                            打开「{otherName ?? otherNode.file_name}」
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {r.id != null && relatedById.get(r.id)?.length ? (
                  <div className="record-rel">
                    <p className="record-rel__title">相关文档</p>
                    <ul className="record-rel__list">
                      {relatedById.get(r.id)!.map((x) => (
                        <li key={x.otherId} className="record-rel__item">
                          <button type="button" className="record-rel__link" onClick={() => void onSelectWiki(`${x.slug}.md`)}>
                            {x.fileName}
                          </button>
                          {x.shared.length > 0 ? (
                            <span className="record-rel__shared" title={x.shared.join("、")}>
                              {x.shared.join(" · ")}
                            </span>
                          ) : null}
                          {x.themes.length > 0 ? (
                            <span className="record-rel__semantic" title={x.themes.join("、")}>
                              相关主题：{x.themes.join(" · ")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
        </div>
      </details>

      <details className="card card--desk library-advanced" id="library-associations">
        <summary className="library-advanced__summary">
          <span className="card__kicker">更多</span>
          <span className="card__title">主题相近的篇目</span>
          <span className="card__sub">标签或主题关联</span>
        </summary>
        <div className="library-advanced__body">
        {!associations || associations.edges.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <div className="empty-state__deco" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            暂无关联。多上传几篇或打上相同标签后，这里会出现相近篇目。
          </div>
        ) : (
          <ul className="assoc-list">
            {associations.edges.slice(0, 32).map((e: AssociationEdge) => {
              const na = nodesById.get(e.source_id);
              const nb = nodesById.get(e.target_id);
              if (!na || !nb) return null;
              return (
                <li key={`${e.source_id}-${e.target_id}`} className="assoc-row">
                  <div className="assoc-row__pair">
                    <button type="button" className="assoc-row__name" onClick={() => void onSelectWiki(`${na.slug}.md`)}>
                      {na.file_name}
                    </button>
                    <span className="assoc-row__dash" aria-hidden>
                      ↔
                    </span>
                    <button type="button" className="assoc-row__name" onClick={() => void onSelectWiki(`${nb.slug}.md`)}>
                      {nb.file_name}
                    </button>
                  </div>
                  <div className="assoc-row__tags">
                    {e.via_semantic && e.shared_tags.length === 0 ? (
                      <span className="assoc-chip assoc-chip--meta">
                        语义关联
                      </span>
                    ) : null}
                    {e.shared_tags.map((t) => (
                      <span key={t} className="assoc-chip">
                        {t}
                      </span>
                    ))}
                    {(e.semantic_themes ?? []).map((t) => (
                      <span key={`s-${t}`} className="assoc-chip assoc-chip--semantic">
                        {t}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </details>
        </>
      ) : null}

      {toast ? (
        <div className="toast-warm" role="status">
          {toast}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="mood-footer mood-footer--seal">
        <p className="mood-footer__lead">关于隐私</p>
        <p>
          你的文库、闪卡与笔记保存在云端账号下，可随时在上方「导出」区下载备份。知识点仅由你上传的内容生成；拆卡与重写时才会把相关片段发往模型 API。保存的闪卡与原文建立映射，相关内容再来时优先弹出。
        </p>
      </footer>
    </main>
  );
}
