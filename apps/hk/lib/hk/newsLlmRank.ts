/**
 * 火山方舟 **Responses API**（`/api/v3/responses`），对候选新闻做个股 / 行业 / 宏观 / 噪音标注与打分。
 * 与 Chat Completions 不同：请求体使用 `input` + `content[].type: "input_text"`。
 *
 * 默认开启；关闭：`HK_NEWS_USE_LLM=0` / `false` / `off`，或 `DOUBAO_DISABLE=1`。
 *
 * 环境变量（可选；未配置 Key 时不调用方舟，新闻仍按关键词与规则排序展示）：
 * - `DOUBAO_API_KEY` / `ARK_API_KEY`（或本地仅调试用的 `HARDCODED_ARK_API_KEY`，勿提交仓库）
 * - `DOUBAO_MODEL`：默认 `doubao-seed-2-0-pro-260215`
 * - `DOUBAO_API_BASE`：默认 `https://ark.cn-beijing.volces.com/api/v3`
 */

export type LlmNewsBucket = "stock" | "industry" | "macro" | "noise";

export type LlmRankRow = { i: number; bucket: LlmNewsBucket; score: number };

const CHUNK = 22;

const DEFAULT_DOUBAO_BASE = "https://ark.cn-beijing.volces.com/api/v3";

/** 与方舟 Responses 文档一致的默认模型名；可被 `DOUBAO_MODEL` 覆盖 */
const DEFAULT_ARK_RESPONSES_MODEL = "doubao-seed-2-0-pro-260215";

/**
 * 仅本地调试：可临时填入方舟 API Key（与 curl 中 Bearer 一致）。
 * 生产环境请留空，改用 `DOUBAO_API_KEY` / `ARK_API_KEY`，且勿将含真实 Key 的修改推送到远程仓库。
 */
const HARDCODED_ARK_API_KEY = "";

function resolveArkApiKey(): string {
  return (
    (process.env.DOUBAO_API_KEY ?? process.env.ARK_API_KEY)?.trim() || HARDCODED_ARK_API_KEY.trim()
  );
}

function llmDisabled(): boolean {
  const v = process.env.HK_NEWS_USE_LLM?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return true;
  if (process.env.DOUBAO_DISABLE === "1" || process.env.DOUBAO_DISABLE?.toLowerCase() === "true") {
    return true;
  }
  return false;
}

function extractJsonPayload(content: string): string {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) return fence[1].trim();
  return trimmed;
}

function parseLlmJson(content: string): LlmRankRow[] | null {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJsonPayload(content)) as unknown;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const results = (obj as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const out: LlmRankRow[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const r = row as { i?: unknown; bucket?: unknown; score?: unknown };
    const i = typeof r.i === "number" && Number.isFinite(r.i) ? Math.floor(r.i) : -1;
    const b = typeof r.bucket === "string" ? r.bucket : "";
    const score = typeof r.score === "number" && Number.isFinite(r.score) ? Math.round(r.score) : 0;
    if (i < 0) continue;
    if (b !== "stock" && b !== "industry" && b !== "macro" && b !== "noise") continue;
    out.push({ i, bucket: b, score: Math.max(0, Math.min(100, score)) });
  }
  return out.length ? out : null;
}

/** 从 Responses API 返回体中取出模型文本（兼容多种 output 结构） */
function extractArkResponsesText(body: Record<string, unknown>): string | null {
  const out = body.output;
  if (typeof out === "string") {
    const s = out.trim();
    return s || null;
  }
  if (!Array.isArray(out)) return null;
  const parts: string[] = [];
  for (const item of out) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "message" && Array.isArray(o.content)) {
      for (const c of o.content) {
        if (!c || typeof c !== "object") continue;
        const co = c as Record<string, unknown>;
        if (typeof co.text === "string") parts.push(co.text);
      }
    }
    if (o.type === "output_text" && typeof o.text === "string") {
      parts.push(o.text);
    }
  }
  const joined = parts.join("").trim();
  return joined || null;
}

async function rankChunk(
  name: string,
  code5: string,
  offset: number,
  lines: { title: string; summary: string }[],
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<LlmRankRow[] | null> {
  const payload = lines.map((row, j) => ({
    i: offset + j,
    title: row.title.slice(0, 200),
    summary: row.summary.slice(0, 280),
  }));

  const system =
    "你是财经新闻分类助手，只输出合法 JSON，不要 Markdown 代码围栏。字段含义：i 为输入中的全局索引；bucket 为 stock|industry|macro|noise；score 为 0–100（对该投资者阅读价值）。";
  const user = `用户正在关注港股：公司全称「${name}」，代码 ${code5}（行情展示常为 ${code5}.HK）。\n\n请对下列每条新闻判断：\n- stock：直接写该公司、股票代码、业绩/回购/增减持/诉讼/监管点名、或同一集团品牌且明显影响该股估值的信息；\n- industry：未直接点名该公司，但明显属于其所在细分行业/赛道（如互联网、游戏、云、银行板块等）的政策、竞品、上下游或行业数据；\n- macro：宏观、利率汇率、国际局势、大宗商品、港股市场整体流动性等，对港股投资者有普遍参考意义；\n- noise：与上述均弱相关、花边或无关琐事。\n\n返回 JSON 对象，键为 results，值为数组，每项形如 {"i":0,"bucket":"industry","score":72}。\n\n新闻列表：\n${JSON.stringify(payload)}`;

  const combined = `${system}\n\n${user}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28_000);
  try {
    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        thinking: { type: "disabled" },
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: combined }],
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ark_responses_http_${res.status}${t ? `:${t.slice(0, 200)}` : ""}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error;
    if (err && typeof err === "object") {
      const msg = (err as { message?: string }).message ?? JSON.stringify(err);
      throw new Error(`ark_responses_error:${msg.slice(0, 240)}`);
    }
    const text = extractArkResponsesText(body);
    if (!text) return null;
    return parseLlmJson(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对候选条目（按当前顺序）返回 LLM 标注。
 * - 关闭大模型、无候选、或未配置 API Key：返回 `null`（静默走关键词排序，不弹提示）。
 * - 已配置 Key 但请求失败或无法解析：返回 `{ rows: [], error }` 供上层展示。
 */
export async function llmRankNewsForHkSymbol(
  name: string,
  code5: string,
  items: { title: string; summary: string }[],
): Promise<{ rows: LlmRankRow[]; error?: string } | null> {
  if (llmDisabled()) return null;
  if (items.length === 0) return null;

  const apiKey = resolveArkApiKey();
  if (!apiKey) return null;

  const model = (
    process.env.DOUBAO_MODEL ??
    process.env.HK_NEWS_LLM_MODEL ??
    DEFAULT_ARK_RESPONSES_MODEL
  ).trim();

  const baseUrl = (process.env.DOUBAO_API_BASE ?? DEFAULT_DOUBAO_BASE).replace(/\/$/, "");

  const all: LlmRankRow[] = [];
  try {
    for (let offset = 0; offset < items.length; offset += CHUNK) {
      const slice = items.slice(offset, offset + CHUNK);
      const part = await rankChunk(name, code5, offset, slice, apiKey, model, baseUrl);
      if (!part) return { rows: [], error: "方舟 Responses 返回内容无法解析为 JSON" };
      all.push(...part);
    }
    return { rows: all };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return { rows: [], error: msg };
  }
}
