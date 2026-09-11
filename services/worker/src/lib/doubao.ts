import type { PrismaClient } from "@learning-saas/db";
import { doubaoRateLimit, trackDoubaoCall } from "./doubao-observability";

const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_MODEL = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse((fenced ?? text).trim()) as unknown;
}

export async function doubaoStructured<T>(params: {
  prisma: PrismaClient;
  orgId: string;
  module: string;
  prompt: string;
  fallback: T;
}): Promise<T> {
  const key = process.env.ARK_API_KEY;
  if (!key) return params.fallback;
  const start = Date.now();
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await doubaoRateLimit();
      const res = await fetch(DOUBAO_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: DOUBAO_MODEL,
          reasoning_effort: "medium",
          messages: [
            { role: "system", content: "你是知识整理引擎，严格输出 JSON，不要输出解释。" },
            { role: "user", content: [{ type: "text", text: params.prompt }] },
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
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        lastError = "EMPTY_CONTENT";
        await new Promise((r) => setTimeout(r, 220 * attempt));
        continue;
      }
      const parsed = extractJson(text) as T;
      await trackDoubaoCall({
        prisma: params.prisma,
        orgId: params.orgId,
        module: params.module,
        ok: true,
        attempts: attempt,
        durationMs: Date.now() - start,
        model: DOUBAO_MODEL,
        tokenPrompt: data.usage?.prompt_tokens ?? null,
        tokenCompletion: data.usage?.completion_tokens ?? null,
        tokenTotal: data.usage?.total_tokens ?? null,
      });
      return parsed;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "REQUEST_FAILED";
      await new Promise((r) => setTimeout(r, 220 * attempt));
    }
  }
  await trackDoubaoCall({
    prisma: params.prisma,
    orgId: params.orgId,
    module: params.module,
    ok: false,
    attempts: 3,
    durationMs: Date.now() - start,
    model: DOUBAO_MODEL,
    error: lastError ?? "UNKNOWN",
  });
  return params.fallback;
}
