import { doubaoRateLimit, trackDoubaoCall } from "@/lib/doubao-observability";

const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_MODEL = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced ?? text).trim();
  return JSON.parse(raw) as unknown;
}

type StructuredResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

async function requestStructured(params: {
  prompt: string;
  orgId?: string;
  module?: string;
}): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) return { ok: false, error: "ARK_API_KEY_MISSING" };
  const moduleName = params.module ?? "vault";
  const start = Date.now();
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await doubaoRateLimit();
      const res = await fetch(DOUBAO_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DOUBAO_MODEL,
          reasoning_effort: "medium",
          messages: [
            {
              role: "system",
              content: "你是一个知识整理助手。必须严格返回 JSON，不要输出解释文字。",
            },
            {
              role: "user",
              content: [{ type: "text", text: params.prompt }],
            },
          ],
        }),
      });
      if (!res.ok) {
        lastError = `HTTP_${res.status}`;
        if (res.status >= 500 || res.status === 429) {
          await new Promise((r) => setTimeout(r, 220 * attempt));
          continue;
        }
        break;
      }
      const data = (await res.json()) as StructuredResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        lastError = "EMPTY_CONTENT";
        await new Promise((r) => setTimeout(r, 220 * attempt));
        continue;
      }
      const parsed = extractJson(text);
      await trackDoubaoCall({
        orgId: params.orgId,
        module: moduleName,
        ok: true,
        attempts: attempt,
        durationMs: Date.now() - start,
        model: DOUBAO_MODEL,
        tokenPrompt: data.usage?.prompt_tokens ?? null,
        tokenCompletion: data.usage?.completion_tokens ?? null,
        tokenTotal: data.usage?.total_tokens ?? null,
      });
      return { ok: true, value: parsed };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "REQUEST_FAILED";
      await new Promise((r) => setTimeout(r, 220 * attempt));
    }
  }
  await trackDoubaoCall({
    orgId: params.orgId,
    module: moduleName,
    ok: false,
    attempts: 3,
    durationMs: Date.now() - start,
    model: DOUBAO_MODEL,
    error: lastError ?? "UNKNOWN",
  });
  return { ok: false, error: lastError ?? "UNKNOWN" };
}

export async function doubaoStructured<T>(params: {
  prompt: string;
  fallback: T;
  orgId?: string;
  module?: string;
}): Promise<T> {
  const result = await requestStructured(params);
  if (!result.ok) return params.fallback;
  return result.value as T;
}

export async function doubaoStructuredStrict<T>(params: {
  prompt: string;
  orgId?: string;
  module?: string;
}): Promise<T> {
  const result = await requestStructured(params);
  if (!result.ok) {
    throw new Error(`LLM 结构化提取失败: ${result.error}`);
  }
  return result.value as T;
}
