import { prisma } from "@learning-saas/db";

type TrackInput = {
  orgId?: string | null;
  module: string;
  ok: boolean;
  durationMs: number;
  attempts: number;
  model: string;
  tokenPrompt?: number | null;
  tokenCompletion?: number | null;
  tokenTotal?: number | null;
  error?: string | null;
};

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

export async function trackDoubaoCall(input: TrackInput) {
  if (!input.orgId) return;
  await prisma.auditLog.create({
    data: {
      orgId: input.orgId,
      action: input.ok ? "doubao.call.ok" : "doubao.call.error",
      metadata: {
        module: input.module,
        durationMs: input.durationMs,
        attempts: input.attempts,
        model: input.model,
        tokenPrompt: input.tokenPrompt ?? null,
        tokenCompletion: input.tokenCompletion ?? null,
        tokenTotal: input.tokenTotal ?? null,
        error: input.error ?? null,
      },
    },
  });
}
