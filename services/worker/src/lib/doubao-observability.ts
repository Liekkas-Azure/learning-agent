import type { PrismaClient } from "@learning-saas/db";

const WINDOW_MS = 1000;
const MAX_PER_WINDOW = 8;
let windowStart = Date.now();
let sentInWindow = 0;

export async function doubaoRateLimit() {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow < MAX_PER_WINDOW) {
    sentInWindow += 1;
    return;
  }
  const wait = WINDOW_MS - (now - windowStart);
  await new Promise((r) => setTimeout(r, Math.max(30, wait)));
  windowStart = Date.now();
  sentInWindow = 1;
}

export async function trackDoubaoCall(params: {
  prisma: PrismaClient;
  orgId: string;
  module: string;
  ok: boolean;
  durationMs: number;
  attempts: number;
  model: string;
  tokenPrompt?: number | null;
  tokenCompletion?: number | null;
  tokenTotal?: number | null;
  error?: string | null;
}) {
  await params.prisma.auditLog.create({
    data: {
      orgId: params.orgId,
      action: params.ok ? "doubao.call.ok" : "doubao.call.error",
      metadata: {
        module: params.module,
        durationMs: params.durationMs,
        attempts: params.attempts,
        model: params.model,
        tokenPrompt: params.tokenPrompt ?? null,
        tokenCompletion: params.tokenCompletion ?? null,
        tokenTotal: params.tokenTotal ?? null,
        error: params.error ?? null,
      },
    },
  });
}
