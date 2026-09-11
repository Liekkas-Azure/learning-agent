/** 空字符串时走同域（Next rewrites 反代）；勿在浏览器回退到 127.0.0.1:8000。 */
function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().replace(/\/+$/, "");
  }
  if (typeof window === "undefined") {
    const backend = process.env.KNOTORY_BACKEND_URL || "http://127.0.0.1:8000";
    return backend.trim().replace(/\/+$/, "");
  }
  return "";
}

export const API_BASE = resolveApiBase();

function resolveApiKey(): string | null {
  const raw = process.env.NEXT_PUBLIC_KNOTORY_API_KEY;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

/** 生产环境若后端启用了 KNOTORY_API_KEY，前端需配置同名密钥（会暴露在浏览器，仅适合个人/内网部署）。 */
export function apiUsesAuth(): boolean {
  return Boolean(resolveApiKey());
}

function resolveBearerToken(): string | null {
  if (typeof window !== "undefined") {
    try {
      const jwt = localStorage.getItem("knotory_auth_token");
      if (jwt?.trim()) return jwt.trim();
    } catch {
      /* ignore */
    }
  }
  return resolveApiKey();
}

export function knotoryAuthHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const token = resolveBearerToken();
  if (token && !h.has("Authorization")) {
    h.set("Authorization", `Bearer ${token}`);
  }
  return h;
}

export async function knotoryFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = knotoryAuthHeaders(init?.headers);
  const res = await fetch(input, { ...init, headers });
  if (typeof window !== "undefined" && res.status === 401) {
    const path = window.location.pathname;
    const isAuthPage = path === "/login" || path === "/register";
    const isPublicApi =
      input.includes("/health") || input.includes("/auth/login") || input.includes("/auth/register");
    if (!isAuthPage && !isPublicApi) {
      try {
        localStorage.removeItem("knotory_auth_token");
        localStorage.removeItem("knotory_auth_user");
        document.cookie = "knotory_token=; path=/; max-age=0; SameSite=Lax";
      } catch {
        /* ignore */
      }
      const next = encodeURIComponent(path || "/");
      window.location.href = `/login?next=${next}`;
    }
  }
  return res;
}

/** 带鉴权的文件下载（用于 <a download> 在启用 API Key 时不可用的情况）。 */
export async function downloadKnotoryResource(url: string, filename: string): Promise<void> {
  const res = await knotoryFetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`下载失败（${res.status}） ${t.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export type IngestRecord = {
  id: number;
  file_name: string;
  status: string;
  created_at: string;
  tags: string[];
  summary: string;
  cached?: boolean;
  contradictions?: Array<{ other_record_id: number; overlap_tags: string[]; note: string }>;
};

export type GraphNode = { id: string; label: string; group: string };
export type GraphLink = {
  source: string;
  target: string;
  kind?: string;
  shared_count?: number;
};

export type GraphPayload = {
  nodes: GraphNode[];
  links: GraphLink[];
  source: string;
};

export type WikiDoc = {
  name: string;
  path: string;
  updated_at: string;
};

export type AssociationNode = { id: number; file_name: string; slug: string; tags: string[] };
export type AssociationEdge = {
  source_id: number;
  target_id: number;
  shared_tags: string[];
  semantic_themes?: string[];
  via_semantic?: boolean;
};
export type AssociationsPayload = { nodes: AssociationNode[]; edges: AssociationEdge[] };

export async function fetchAssociations(limit = 40): Promise<AssociationsPayload> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/associations?limit=${limit}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`加载关联失败（${res.status}） ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as AssociationsPayload;
}

export type UploadProgress = { percent: number; phase: string };

export type BatchUploadProgress = {
  current: number;
  total: number;
  fileName: string;
  phase: string;
};

export async function uploadFilesBatch(
  files: File[],
  onProgress?: (p: BatchUploadProgress) => void,
): Promise<{ ok: number; failed: Array<{ file: string; error: string }> }> {
  const failed: Array<{ file: string; error: string }> = [];
  let ok = 0;
  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.({
      current: i,
      total,
      fileName: f.webkitRelativePath || f.name,
      phase: `正在导入 ${i + 1}/${total}…`,
    });
    try {
      await uploadFile(f);
      ok += 1;
      onProgress?.({
        current: i + 1,
        total,
        fileName: f.webkitRelativePath || f.name,
        phase: i + 1 === total ? "全部完成。" : `正在导入 ${i + 2}/${total}…`,
      });
    } catch (e) {
      failed.push({
        file: f.webkitRelativePath || f.name,
        error: e instanceof Error ? e.message : "导入失败",
      });
    }
  }
  return { ok, failed };
}

function parseUploadErrorBody(status: number, text: string): string {
  let msg = `上传失败（${status}）`;
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === "string") {
      msg = j.detail;
    } else if (Array.isArray(j.detail)) {
      msg = j.detail
        .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: string }).msg) : String(d)))
        .join("; ");
    }
  } catch {
    /* 非 JSON */
  }
  return msg;
}

const UPLOAD_WAIT_PHASES = [
  "正在读取文件…",
  "正在解析版式…",
  "正在提取正文…",
  "正在生成摘要和标签…",
];

/**
 * 使用 fetch 上传（与 GET 列表一致，避免 XHR + CORS/进度事件在部分环境下不触发的问题）。
 * onProgress 在等待服务端时用定时器模拟阶段文案（非真实字节百分比）。
 */
export async function uploadFile(file: File, onProgress?: (p: UploadProgress) => void): Promise<IngestRecord> {
  const fd = new FormData();
  fd.append("file", file);

  let uiTick: ReturnType<typeof setInterval> | null = null;
  const clearUi = () => {
    if (uiTick) {
      clearInterval(uiTick);
      uiTick = null;
    }
  };

  if (onProgress) {
    onProgress({ percent: 5, phase: "正在上传…" });
    let pct = 5;
    let tick = 0;
    uiTick = setInterval(() => {
      tick += 1;
      pct = Math.min(92, pct + 1.3);
      const idx = Math.min(UPLOAD_WAIT_PHASES.length - 1, Math.floor(tick / 4));
      onProgress({ percent: pct, phase: UPLOAD_WAIT_PHASES[idx] });
    }, 480);
  }

  const controller = new AbortController();
  const abortTimer = globalThis.setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await knotoryFetch(`${API_BASE}/api/v1/upload`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    globalThis.clearTimeout(abortTimer);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(parseUploadErrorBody(res.status, text));
    }
    if (onProgress) {
      onProgress({ percent: 100, phase: "已完成。" });
    }
    return JSON.parse(text) as IngestRecord;
  } catch (e) {
    globalThis.clearTimeout(abortTimer);
    const aborted =
      e !== null &&
      typeof e === "object" &&
      "name" in e &&
      (e as { name: string }).name === "AbortError";
    if (aborted) {
      throw new Error("处理时间较长，请稍候再试或检查网络。");
    }
    if (e instanceof TypeError) {
      throw new Error("无法连接服务，请刷新页面后重试。");
    }
    throw e;
  } finally {
    clearUi();
  }
}

export async function fetchGraph() {
  const res = await knotoryFetch(`${API_BASE}/api/v1/graph`);
  if (!res.ok) throw new Error(`关系图加载失败（${res.status}）`);
  return (await res.json()) as GraphPayload;
}

export async function listWiki() {
  const res = await knotoryFetch(`${API_BASE}/api/v1/wiki`);
  if (res.status === 401) throw new Error("请先登录后再查看文档列表");
  if (!res.ok) throw new Error(`文档列表加载失败（${res.status}）`);
  return (await res.json()) as WikiDoc[];
}

export async function listRecords(limit = 40): Promise<IngestRecord[]> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/records?limit=${limit}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`最近记录加载失败（${res.status}） ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as IngestRecord[];
}

export async function deleteRecord(id: number): Promise<{ ok: boolean; id: number; removed_base: string }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/records/${id}`, { method: "DELETE" });
  const text = await res.text();
  if (!res.ok) {
    let msg = `删除失败（${res.status}）`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return JSON.parse(text) as { ok: boolean; id: number; removed_base: string };
}

export type AiFormatMeta = {
  updated_at?: string;
  provider?: string;
  segments?: number;
  source_sha256?: string;
  operation?: string;
};

export type WikiReadingTab = "original" | "ai" | "compare";

export type WikiReadPayload = {
  content: string;
  extracted_text: string | null;
  formatted_text: string | null;
  original_filename: string | null;
  original_bytes_available: boolean;
  ai_format_meta?: AiFormatMeta | null;
};

export async function getWikiContent(name: string): Promise<WikiReadPayload> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/wiki/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`读取文档失败（${res.status}）`);
  const data = (await res.json()) as WikiReadPayload;
  return {
    content: data.content,
    extracted_text: data.extracted_text ?? null,
    formatted_text: data.formatted_text ?? null,
    original_filename: data.original_filename ?? null,
    original_bytes_available: Boolean(data.original_bytes_available),
    ai_format_meta: data.ai_format_meta ?? null,
  };
}

export type KnotoryDeploymentMeta = {
  api_version?: string;
  storage_mode?: string;
  storage_backend?: string;
  neo4j_configured?: boolean;
  corpus_scope?: string;
  api_auth_required?: boolean;
  export_available?: boolean;
  portable_layout?: Record<string, string>;
  export_endpoints?: Record<string, string>;
};

export type KnotoryHealth = {
  ok?: boolean;
  checks?: { llm_configured?: boolean };
  cloud_demo_url?: string | null;
  is_cloud_demo?: boolean;
  auth_required?: boolean;
};

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export async function registerUser(email: string, password: string, displayName = ""): Promise<AuthSession> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `注册失败（${res.status}）`);
  }
  return (await res.json()) as AuthSession;
}

export async function loginUser(email: string, password: string): Promise<AuthSession> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `登录失败（${res.status}）`);
  }
  return (await res.json()) as AuthSession;
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/auth/me`);
  if (!res.ok) return null;
  return (await res.json()) as AuthUser;
}

export function corpusManifestUrl(): string {
  return `${API_BASE}/api/v1/corpus/manifest`;
}

export function corpusArchiveUrl(): string {
  return `${API_BASE}/api/v1/corpus/archive`;
}

export async function fetchKnotoryHealth(): Promise<KnotoryHealth | null> {
  try {
    const res = await knotoryFetch(`${API_BASE}/health`);
    if (!res.ok) return null;
    return (await res.json()) as KnotoryHealth;
  } catch {
    return null;
  }
}

export async function fetchKnotoryDeploymentMeta(): Promise<KnotoryDeploymentMeta | null> {
  try {
    const res = await knotoryFetch(`${API_BASE}/api/v1/meta`);
    if (!res.ok) return null;
    return (await res.json()) as KnotoryDeploymentMeta;
  } catch {
    return null;
  }
}

export function wikiExportFileUrl(
  wikiFileName: string,
  role: "wiki" | "extracted" | "ai" | "ai_meta",
): string {
  return `${API_BASE}/api/v1/wiki/${encodeURIComponent(wikiFileName)}/export?role=${role}`;
}
export function wikiOriginalFileUrl(wikiFileName: string): string {
  return `${API_BASE}/api/v1/wiki/${encodeURIComponent(wikiFileName)}/original`;
}

export type ReadingCompanionBundleItem = {
  section_id: string;
  section_title: string;
  status: "pending" | "ok" | "error";
  companion_markdown: string | null;
  provider: string | null;
  error_message: string | null;
  updated_at: string | null;
};

export type ReadingCompanionBundle = {
  wiki_file_name: string;
  items: ReadingCompanionBundleItem[];
  any_pending: boolean;
};

/** 拉取服务端预生成/缓存的伴读（入库后台与每日任务写入）；有 pending 时 GET 会尝试启动后台补跑 */
export async function fetchReadingCompanionBundle(wikiName: string): Promise<ReadingCompanionBundle> {
  const res = await knotoryFetch(
    `${API_BASE}/api/v1/wiki/${encodeURIComponent(wikiName)}/reading-companions`,
  );
  if (!res.ok) {
    const t = await res.text();
    let msg = `导读加载失败（${res.status}）`;
    try {
      const j = JSON.parse(t) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ReadingCompanionBundle;
}

/** 强制刷新该 wiki 全部章节伴读（可能较久） */
export async function refreshReadingCompanionBundle(
  wikiName: string,
  force = false,
): Promise<ReadingCompanionBundle> {
  const q = force ? "?force=true" : "";
  const res = await knotoryFetch(
    `${API_BASE}/api/v1/wiki/${encodeURIComponent(wikiName)}/reading-companions/refresh${q}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`伴读刷新失败（${res.status}）`);
  return (await res.json()) as ReadingCompanionBundle;
}

export type ReadingCorpusSnippet = { file_name: string; summary: string };

export async function fetchReadingCompanion(opts: {
  wikiName: string;
  sectionTitle: string;
  sectionText: string;
  docTitle?: string;
  corpus: ReadingCorpusSnippet[];
  extractedRaw?: string | null;
}): Promise<{ companion_markdown: string; provider: string }> {
  const { wikiName, sectionTitle, sectionText, docTitle, corpus, extractedRaw } = opts;
  const res = await knotoryFetch(`${API_BASE}/api/v1/wiki/${encodeURIComponent(wikiName)}/reading-companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      section_title: sectionTitle,
      section_text: sectionText,
      doc_title: docTitle ?? "",
      corpus: corpus.map((c) => ({ file_name: c.file_name, summary: c.summary })),
      extracted_raw: extractedRaw ?? null,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `伴读生成失败（${res.status}）`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return JSON.parse(text) as { companion_markdown: string; provider: string };
}

type CompanionSseEvent =
  | { type: "meta"; provider: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

function parseSseBlocks(buffer: string): { events: CompanionSseEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: CompanionSseEvent[] = [];
  for (const block of parts) {
    const lines = block.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        events.push(JSON.parse(raw) as CompanionSseEvent);
      } catch {
        /* ignore bad chunk */
      }
    }
  }
  return { events, rest };
}

/** 流式伴读（SSE）；onDelta 收到增量文本；onMeta 收到 provider */
export async function fetchReadingCompanionStream(
  opts: {
    wikiName: string;
    sectionTitle: string;
    sectionText: string;
    docTitle?: string;
    corpus: ReadingCorpusSnippet[];
    extractedRaw?: string | null;
    signal?: AbortSignal;
  },
  handlers: {
    onDelta: (text: string) => void;
    onMeta?: (provider: string) => void;
  },
): Promise<void> {
  const { wikiName, sectionTitle, sectionText, docTitle, corpus, extractedRaw, signal } = opts;
  const res = await knotoryFetch(`${API_BASE}/api/v1/wiki/${encodeURIComponent(wikiName)}/reading-companion/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      section_title: sectionTitle,
      section_text: sectionText,
      doc_title: docTitle ?? "",
      corpus: corpus.map((c) => ({ file_name: c.file_name, summary: c.summary })),
      extracted_raw: extractedRaw ?? null,
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = `伴读流异常（${res.status}）`;
    try {
      const j = JSON.parse(t) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("伴读流：无法读取响应正文");

  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = parseSseBlocks(buf);
    buf = rest;
    for (const ev of events) {
      if (ev.type === "meta" && handlers.onMeta) handlers.onMeta(ev.provider);
      if (ev.type === "delta" && ev.text) handlers.onDelta(ev.text);
      if (ev.type === "error") throw new Error(ev.message);
    }
  }
  const tail = parseSseBlocks(buf + "\n\n");
  for (const ev of tail.events) {
    if (ev.type === "meta" && handlers.onMeta) handlers.onMeta(ev.provider);
    if (ev.type === "delta" && ev.text) handlers.onDelta(ev.text);
    if (ev.type === "error") throw new Error(ev.message);
  }
}

export async function formatWikiExtractedBody(name: string): Promise<{
  formatted: string;
  provider: string;
  segments: number;
  ai_format_meta?: AiFormatMeta | null;
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/wiki/${encodeURIComponent(name)}/format-body`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `重新排版失败（${res.status}）`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") {
        msg = j.detail;
      }
    } catch {
      /* 非 JSON */
    }
    throw new Error(msg);
  }
  return JSON.parse(text) as {
    formatted: string;
    provider: string;
    segments: number;
    ai_format_meta?: AiFormatMeta | null;
  };
}

export type KnowledgeFlashcard = {
  id: number;
  card_kind: string;
  topic: string;
  topics: string[];
  front_text: string;
  back_text: string;
  wiki_file_name: string;
  section_id: string;
  source_title: string;
  source_anchor?: string;
  source_wiki_url?: string;
  quality_score?: number;
  quality_flags?: string;
  generation_meta?: string;
  feed_explain?: string;
  feed_reason?: string;
  review_due?: boolean;
  visual_mermaid?: string;
  visual_caption?: string;
  visual_palette?: string;
  visual_emoji?: string;
  visual_image_url?: string;
};

export type FlashcardImageStatus = {
  ready: boolean;
  model: string;
  hint: string;
};

export async function fetchFlashcardImageStatus(): Promise<FlashcardImageStatus> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/image-status`);
  if (!res.ok) throw new Error(`配图状态查询失败（${res.status}）`);
  return (await res.json()) as FlashcardImageStatus;
}

export function flashcardImageSrc(visualImageUrl: string | undefined): string {
  const raw = (visualImageUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const base = API_BASE.replace(/\/+$/, "");
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export type FlashcardFeedbackAction =
  | "like"
  | "dislike"
  | "skip"
  | "save"
  | "open_source"
  | "bad_card"
  | "flip";

export type MasteryTopic = {
  topic: string;
  total: number;
  due: number;
  mature: number;
  mastery_pct: number;
};

export type DailyTopicHeat = {
  topic: string;
  heat: number;
  heat_pct: number;
};

export type DailyProgress = {
  date: string;
  today_count: number;
  goal: number;
  goal_met: boolean;
  progress_pct: number;
  streak_days: number;
  breakdown?: Record<string, number>;
};

export type DailyDigest = {
  date: string;
  one_liner: string;
  highlight_card?: { id: number; topic: string; front_text: string } | null;
  progress: DailyProgress;
  due_count: number;
  saved_recent: Array<{ id?: number; front_text?: string; topic?: string; saved_at?: string }>;
  topic_heat: DailyTopicHeat[];
  weak_topics: string[];
  mastery_snapshot: MasteryTopic[];
  top_topics: { topic: string; score: number }[];
};

export type StylePreference = {
  learned: boolean;
  labels: string[];
  feedback_count: number;
  summary: string;
};

export type FlashcardProfile = {
  session_id: string;
  total_feedback: number;
  top_topics: { topic: string; score: number }[];
  daily_topic_heat?: DailyTopicHeat[];
  mastery: MasteryTopic[];
  daily?: DailyProgress;
  style_preference?: StylePreference;
};

export async function syncFlashcardsFromCorpus(opts?: {
  useLlm?: boolean;
  background?: boolean;
  skipImages?: boolean;
  mode?: "full" | "enrich" | "llm_only" | "fast_only";
  recordIds?: number[];
  wikiFileNames?: string[];
}): Promise<FlashcardSyncStatus & { ok?: boolean; started?: boolean }> {
  const q = new URLSearchParams({
    use_llm: opts?.useLlm === false ? "false" : "true",
    background: opts?.background === false ? "false" : "true",
    skip_images: opts?.skipImages ? "true" : "false",
  });
  if (opts?.mode) q.set("mode", opts.mode);
  for (const id of opts?.recordIds ?? []) q.append("record_id", String(id));
  for (const name of opts?.wikiFileNames ?? []) q.append("wiki_file_name", name);
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/sync?${q}`, { method: "POST" });
  if (!res.ok) throw new Error(`闪卡同步失败（${res.status}）`);
  return (await res.json()) as FlashcardSyncStatus & { ok?: boolean; started?: boolean };
}

export async function fetchPipelineStatus(): Promise<PipelineStatus> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/pipeline/status`);
  if (!res.ok) throw new Error(`流水线状态获取失败（${res.status}）`);
  return (await res.json()) as PipelineStatus;
}

export async function fetchSavedFlashcards(limit = 30): Promise<{ count: number; items: SavedFlashcard[] }> {
  const q = new URLSearchParams({ limit: String(limit) });
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/saved?${q}`);
  if (!res.ok) throw new Error(`搞懂清单获取失败（${res.status}）`);
  return (await res.json()) as { count: number; items: SavedFlashcard[] };
}

export function flashcardExportJsonUrl(wikiFileName?: string): string {
  const q = wikiFileName ? `?wiki_file_name=${encodeURIComponent(wikiFileName)}` : "";
  return `${API_BASE}/api/v1/flashcards/export/json${q}`;
}

export type FlashcardFeedPayload = {
  session_id: string;
  items: KnowledgeFlashcard[];
  count: number;
  has_more?: boolean;
  has_corpus?: boolean;
  qa_ratio?: number;
  due_count?: number;
  profile?: FlashcardProfile;
  daily?: DailyProgress;
  is_demo?: boolean;
  sync?: {
    running?: boolean;
    error?: string | null;
    stage?: string;
    progress_current?: number;
    progress_total?: number;
  };
  llm_configured?: boolean;
};

export type FlashcardSyncStatus = {
  running: boolean;
  queued?: boolean;
  use_llm?: boolean;
  skip_images?: boolean;
  mode?: string;
  stage?: string;
  started_at?: string | null;
  finished_at?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  progress_current?: number;
  progress_total?: number;
  current_wiki?: string;
  wikis_done?: number;
  wikis_total?: number;
};

export type PipelineIngestJob = {
  record_id: number;
  file_name: string;
  stage: string;
  error?: string | null;
  started_at?: string;
  finished_at?: string | null;
};

export type PipelineWikiItem = {
  record_id: number;
  file_name: string;
  wiki_file_name: string;
  status: string;
  flashcard_count: number;
};

export type PipelineStatus = {
  ingest: {
    active: PipelineIngestJob[];
    recent: PipelineIngestJob[];
    active_count: number;
  };
  flashcard_sync: FlashcardSyncStatus;
  wiki_items: PipelineWikiItem[];
  totals: {
    records: number;
    active_flashcards: number;
    wikis_with_cards: number;
  };
};

export type SavedFlashcard = {
  id: number;
  front_text: string;
  back_text: string;
  wiki_file_name: string;
  section_id: string;
  topic: string;
  saved_at: string;
};

export type CorpusSearchHit = {
  kind: "wiki" | "record" | "clip";
  title: string;
  snippet: string;
  score?: number;
  hybrid_score?: number;
  match_reason?: string;
  wiki_file_name?: string;
  record_id?: number;
  clip_id?: number;
};

export async function searchCorpus(query: string, limit = 30): Promise<{ query: string; count: number; items: CorpusSearchHit[] }> {
  const q = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await knotoryFetch(`${API_BASE}/api/v1/corpus/search?${q}`);
  if (!res.ok) throw new Error(`文库搜索失败（${res.status}）`);
  return (await res.json()) as { query: string; count: number; items: CorpusSearchHit[] };
}

export async function fetchFlashcardFeed(
  sessionId: string,
  limit = 8,
  opts?: { autoSync?: boolean; excludeIds?: number[]; signal?: AbortSignal },
): Promise<FlashcardFeedPayload> {
  const q = new URLSearchParams({
    session_id: sessionId,
    limit: String(limit),
    auto_sync: opts?.autoSync ? "true" : "false",
  });
  if (opts?.excludeIds?.length) {
    q.set("exclude_ids", opts.excludeIds.join(","));
  }
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/feed?${q}`, { signal: opts?.signal });
  if (!res.ok) throw new Error(`推荐流加载失败（${res.status}）`);
  return (await res.json()) as FlashcardFeedPayload;
}

export async function fetchDemoFlashcardFeed(limit = 8): Promise<FlashcardFeedPayload> {
  const q = new URLSearchParams({ limit: String(limit) });
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/demo-feed?${q}`);
  if (!res.ok) throw new Error(`示例流加载失败（${res.status}）`);
  const data = (await res.json()) as FlashcardFeedPayload;
  return { ...data, is_demo: true };
}

export async function fetchDailyStats(sessionId: string, goal?: number): Promise<DailyProgress> {
  const q = new URLSearchParams({ session_id: sessionId });
  if (goal != null && goal >= 1 && goal <= 50) q.set("goal", String(goal));
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/daily-stats?${q}`);
  if (!res.ok) throw new Error(`每日进度读取失败（${res.status}）`);
  return (await res.json()) as DailyProgress;
}

export async function fetchDueCount(): Promise<number> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/due?limit=1`);
  if (!res.ok) return 0;
  const data = (await res.json()) as { count?: number };
  return data.count ?? 0;
}

export async function fetchDailyDigest(sessionId: string): Promise<DailyDigest> {
  const res = await knotoryFetch(
    `${API_BASE}/api/v1/flashcards/daily-digest?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) throw new Error(`每日摘要加载失败（${res.status}）`);
  return (await res.json()) as DailyDigest;
}

export async function fetchSharePack(cardIds: number[]): Promise<{ count: number; items: Array<{ topic: string; front: string; back: string }> }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/share-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_ids: cardIds }),
  });
  if (!res.ok) throw new Error(`分享包生成失败（${res.status}）`);
  return (await res.json()) as { count: number; items: Array<{ topic: string; front: string; back: string }> };
}

export async function fetchFlashcardSyncStatus(): Promise<FlashcardSyncStatus> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/sync/status`);
  if (!res.ok) throw new Error(`同步状态读取失败（${res.status}）`);
  return (await res.json()) as FlashcardSyncStatus;
}

export async function sendFlashcardFeedback(
  cardId: number,
  body: { action: FlashcardFeedbackAction; dwell_ms?: number; session_id: string },
): Promise<void> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: body.action,
      dwell_ms: body.dwell_ms ?? 0,
      session_id: body.session_id,
    }),
  });
  if (!res.ok) throw new Error(`反馈提交失败（${res.status}）`);
}

export async function fetchFlashcardProfile(sessionId: string): Promise<FlashcardProfile> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/profile?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`偏好读取失败（${res.status}）`);
  return (await res.json()) as FlashcardProfile;
}

export async function fetchDueFlashcards(limit = 20): Promise<{ count: number; items: KnowledgeFlashcard[] }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/due?limit=${limit}`);
  if (!res.ok) throw new Error(`待复习加载失败（${res.status}）`);
  return (await res.json()) as { count: number; items: KnowledgeFlashcard[] };
}

export async function submitSrsReview(cardId: number, rating: 0 | 1 | 2 | 3): Promise<void> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new Error(`复习提交失败（${res.status}）`);
}

export async function fetchExamFlashcards(wikiFileName: string, limit = 15): Promise<{
  wiki_file_name: string;
  count: number;
  items: KnowledgeFlashcard[];
}> {
  const q = new URLSearchParams({ wiki_file_name: wikiFileName, limit: String(limit) });
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/exam?${q}`);
  if (!res.ok) throw new Error(`测验加载失败（${res.status}）`);
  return (await res.json()) as { wiki_file_name: string; count: number; items: KnowledgeFlashcard[] };
}

export async function fetchFlashcardNote(cardId: number): Promise<string> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/note`);
  if (!res.ok) return "";
  const data = (await res.json()) as { text?: string };
  return data.text || "";
}

export async function saveFlashcardNote(cardId: number, text: string): Promise<void> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/note`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`笔记保存失败（${res.status}）`);
}

export async function regenerateFlashcard(
  cardId: number,
  body: { direction?: string; use_note?: boolean },
): Promise<KnowledgeFlashcard> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      direction: body.direction ?? "",
      use_note: body.use_note ?? true,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `闪卡重写失败（${res.status}）`);
  }
  const data = (await res.json()) as { item: KnowledgeFlashcard };
  return data.item;
}

export type FlashcardUnderstanding = import("@/lib/flashcardUnderstand").FlashcardUnderstanding;

export async function fetchFlashcardUnderstanding(
  cardId: number,
  body: { mode: string; use_note?: boolean },
): Promise<FlashcardUnderstanding> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/understand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: body.mode,
      use_note: body.use_note ?? true,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `理解辅助生成失败（${res.status}）`);
  }
  const data = (await res.json()) as { understanding: FlashcardUnderstanding };
  return data.understanding;
}

export async function applyFlashcardUnderstanding(
  cardId: number,
  body: { mode: string; preview?: FlashcardUnderstanding },
): Promise<KnowledgeFlashcard> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/understand/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `替换闪卡失败（${res.status}）`);
  }
  const data = (await res.json()) as { item: KnowledgeFlashcard };
  return data.item;
}

export type FeynmanBrief = {
  card_id: number;
  concept: string;
  topic: string;
  topics: string[];
  source_title: string;
  wiki_file_name: string;
  section_id: string;
  reference_question: string;
  reference_answer_preview: string;
  prompt: string;
  tips: string[];
  note_hint?: string;
};

export type FeynmanEvaluation = {
  card_id: number;
  attempt: number;
  passed: boolean;
  score: number;
  coach_message: string;
  gaps: string[];
  strengths: string[];
  reference_points: string[];
  followup_prompt?: string;
  provider?: string;
};

export async function fetchFeynmanBrief(cardId: number): Promise<FeynmanBrief> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/feynman/brief`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `费曼题目加载失败（${res.status}）`);
  }
  const data = (await res.json()) as { brief: FeynmanBrief };
  return data.brief;
}

export async function evaluateFeynmanExplanation(
  cardId: number,
  body: { explanation: string; attempt?: number },
): Promise<FeynmanEvaluation> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/${cardId}/feynman/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      explanation: body.explanation,
      attempt: body.attempt ?? 1,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `费曼评估失败（${res.status}）`);
  }
  const data = (await res.json()) as { evaluation: FeynmanEvaluation };
  return data.evaluation;
}

export async function ingestClip(body: {
  text: string;
  source_title?: string;
  source_url?: string;
  tags?: string[];
}): Promise<{ ok: boolean; wiki_file_name?: string }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/clips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`摘录入库失败（${res.status}）`);
  return (await res.json()) as { ok: boolean; wiki_file_name?: string };
}

export async function scanWatchFolder(): Promise<{
  ok: boolean;
  imported?: number;
  skipped?: number;
  hint?: string;
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/watch/scan`, { method: "POST" });
  if (!res.ok) throw new Error(`目录扫描失败（${res.status}）`);
  return (await res.json()) as { ok: boolean; imported?: number; skipped?: number; hint?: string };
}

export async function fetchFlashcardUsage(): Promise<{
  active_flashcards: number;
  feedback_events: number;
  server_notes: number;
  cached_images: number;
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/usage`);
  if (!res.ok) throw new Error(`用量读取失败（${res.status}）`);
  return (await res.json()) as {
    active_flashcards: number;
    feedback_events: number;
    server_notes: number;
    cached_images: number;
  };
}

export function flashcardExportMarkdownUrl(wikiFileName?: string): string {
  const q = wikiFileName ? `?wiki_file_name=${encodeURIComponent(wikiFileName)}` : "";
  return `${API_BASE}/api/v1/flashcards/export/markdown${q}`;
}

export function flashcardNotesExportUrl(): string {
  return `${API_BASE}/api/v1/flashcards/notes/export`;
}

export async function submitWaitlistEmail(email: string, source = "welcome"): Promise<{ ok: boolean; duplicate?: boolean }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, source }),
  });
  if (!res.ok) throw new Error(`登记失败（${res.status}）`);
  return (await res.json()) as { ok: boolean; duplicate?: boolean };
}

export type LearningAction =
  | "feed_review"
  | "srs_due"
  | "feynman"
  | "deep_read"
  | "exam"
  | "rag_clarify";

export type LearningExecution = {
  ok: boolean;
  primary_action?: LearningAction;
  tool?: string;
  policy?: string;
  today_focus?: string;
  error?: string;
  cta?: { label: string; href: string };
  payload?: Record<string, unknown>;
};

export type LearningAgentResult = {
  engine?: "langgraph" | "state_machine";
  trace?: string[];
  diagnosis_summary?: string;
  diagnosis?: {
    prerequisite_blockers?: Array<{
      prerequisite_key: string;
      concept_key: string;
      mastery_pct: number;
      depth?: number;
    }>;
    observation_sources?: Record<string, number>;
  };
  policy?: {
    action?: LearningAction;
    policy?: string;
    context_key?: string;
  };
  execution?: LearningExecution;
  execution_history?: LearningExecution[];
  evaluation?: {
    ok?: boolean;
    score?: number;
    issues?: string[];
    needs_replan?: boolean;
  };
  memory_write?: {
    written?: boolean;
    value_score?: number;
    title?: string;
  };
  replanned?: boolean;
};

export type LearningPathResponse = {
  days: number;
  steps: Array<{
    day: number;
    title: string;
    wiki_file_name: string;
    focus_topic?: string;
    tasks: string[];
    why?: string;
    actions?: Array<{ label: string; href: string }>;
  }>;
  mastery: MasteryTopic[];
  weak_topics?: string[];
  strategy_summary?: string;
  primary_action?: LearningAction;
  agent?: LearningAgentResult;
};

export async function fetchLearningPath(days = 7): Promise<LearningPathResponse> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/learning-path?days=${days}`);
  if (!res.ok) throw new Error(`学习路径加载失败（${res.status}）`);
  return (await res.json()) as LearningPathResponse;
}

export async function submitLearningActionFeedback(
  action: LearningAction,
  reward: number,
  contextKey = "",
): Promise<void> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/agent/action-feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      reward: Math.max(0, Math.min(1, reward)),
      context_key: contextKey,
    }),
  });
  if (!res.ok) throw new Error(`学习反馈提交失败（${res.status}）`);
}

export async function buildWritingDraft(cardIds: number[]): Promise<{ outline_markdown: string }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/writing-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_ids: cardIds }),
  });
  if (!res.ok) throw new Error(`草稿生成失败（${res.status}）`);
  return (await res.json()) as { outline_markdown: string };
}

export type RagSource = {
  index: number;
  kind?: string;
  title?: string;
  wiki_file_name?: string;
  snippet?: string;
};

export async function chatRag(query: string): Promise<{ answer: string; sources: RagSource[]; provider: string }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/chat/rag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`问答失败（${res.status}）`);
  return (await res.json()) as { answer: string; sources: RagSource[]; provider: string };
}

export async function factCheck(claim: string): Promise<{
  verdict: string;
  confidence: number;
  summary: string;
  sources: RagSource[];
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/fact-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim }),
  });
  if (!res.ok) throw new Error(`事实检验失败（${res.status}）`);
  return (await res.json()) as { verdict: string; confidence: number; summary: string; sources: RagSource[] };
}

export async function fetchContradictions(limit = 50): Promise<{ count: number; items: Array<{
  record_id: number;
  file_name: string;
  wiki_file_name: string;
  other_record_id: number;
  overlap_tags: string[];
  note: string;
}> }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/contradictions?limit=${limit}`);
  if (!res.ok) throw new Error(`矛盾列表加载失败（${res.status}）`);
  return (await res.json()) as { count: number; items: Array<{
    record_id: number;
    file_name: string;
    wiki_file_name: string;
    other_record_id: number;
    overlap_tags: string[];
    note: string;
  }> };
}

export async function fetchSrsCalendar(days = 14): Promise<{ days: number; items: Array<{ date: string; due_count: number }> }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/srs/calendar?days=${days}`);
  if (!res.ok) throw new Error(`复习日历加载失败（${res.status}）`);
  return (await res.json()) as { days: number; items: Array<{ date: string; due_count: number }> };
}

export async function fetchSrsTrend(topN = 8): Promise<{
  mastery: MasteryTopic[];
  due_summary: { overdue: number; due_today: number; due_this_week: number };
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/srs/trend?top_n=${topN}`);
  if (!res.ok) throw new Error(`掌握度趋势加载失败（${res.status}）`);
  return (await res.json()) as {
    mastery: MasteryTopic[];
    due_summary: { overdue: number; due_today: number; due_this_week: number };
  };
}

export function obsidianVaultExportUrl(): string {
  return `${API_BASE}/api/v1/corpus/export/obsidian`;
}

export async function runCorpusBackup(): Promise<{ ok: boolean; started?: boolean; hint?: string }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/corpus/backup/run`, { method: "POST" });
  if (!res.ok) throw new Error(`备份启动失败（${res.status}）`);
  return (await res.json()) as { ok: boolean; started?: boolean; hint?: string };
}

export async function fetchCorpusBackupStatus(): Promise<{
  last_run_at: string | null;
  last_path: string | null;
  last_error: string | null;
  running: boolean;
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/corpus/backup/status`);
  if (!res.ok) throw new Error(`备份状态读取失败（${res.status}）`);
  return (await res.json()) as {
    last_run_at: string | null;
    last_path: string | null;
    last_error: string | null;
    running: boolean;
  };
}

export async function regenerateFlashcardImages(limit = 200): Promise<{ ok: boolean; hint?: string }> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/images/regenerate?limit=${limit}`, { method: "POST" });
  if (!res.ok) throw new Error(`批量配图启动失败（${res.status}）`);
  return (await res.json()) as { ok: boolean; hint?: string };
}

export async function fetchImageRegenerateStatus(): Promise<{
  running: boolean;
  total: number;
  done: number;
  ok: number;
  failed: number;
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/flashcards/images/regenerate/status`);
  if (!res.ok) throw new Error(`配图进度读取失败（${res.status}）`);
  return (await res.json()) as { running: boolean; total: number; done: number; ok: number; failed: number };
}

export async function curatorSuggest(wikiFileName: string): Promise<{
  suggested_tags: string[];
  quality_notes: string;
  split_suggestions: string[];
  flashcard_ideas: string[];
}> {
  const res = await knotoryFetch(`${API_BASE}/api/v1/curator/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wiki_file_name: wikiFileName }),
  });
  if (!res.ok) throw new Error(`策展建议失败（${res.status}）`);
  return (await res.json()) as {
    suggested_tags: string[];
    quality_notes: string;
    split_suggestions: string[];
    flashcard_ideas: string[];
  };
}

export async function searchCorpusHybrid(query: string, limit = 30): Promise<{ query: string; count: number; items: CorpusSearchHit[] }> {
  const q = new URLSearchParams({ q: query, limit: String(limit), mode: "hybrid" });
  const res = await knotoryFetch(`${API_BASE}/api/v1/corpus/search?${q}`);
  if (!res.ok) throw new Error(`混合检索失败（${res.status}）`);
  return (await res.json()) as { query: string; count: number; items: CorpusSearchHit[] };
}
