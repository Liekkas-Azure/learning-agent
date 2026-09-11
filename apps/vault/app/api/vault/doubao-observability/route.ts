import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";

export async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  const { searchParams } = new URL(req.url);
  const hours = Math.min(168, Math.max(1, Number.parseInt(searchParams.get("hours") ?? "24", 10) || 24));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const logs = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: { in: ["doubao.call.ok", "doubao.call.error"] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { id: true, action: true, createdAt: true, metadata: true },
  });

  const total = logs.length;
  const okCount = logs.filter((l) => l.action === "doubao.call.ok").length;
  const errorCount = total - okCount;
  const successRate = total ? okCount / total : 0;

  const moduleAgg = new Map<string, { total: number; ok: number; duration: number; tokens: number }>();
  const errors = new Map<string, number>();

  for (const log of logs) {
    const md = (log.metadata ?? {}) as Record<string, unknown>;
    const moduleName = typeof md.module === "string" ? md.module : "unknown";
    const duration = typeof md.durationMs === "number" ? md.durationMs : 0;
    const tokens = typeof md.tokenTotal === "number" ? md.tokenTotal : 0;
    const rec = moduleAgg.get(moduleName) ?? { total: 0, ok: 0, duration: 0, tokens: 0 };
    rec.total += 1;
    rec.duration += duration;
    rec.tokens += tokens;
    if (log.action === "doubao.call.ok") rec.ok += 1;
    moduleAgg.set(moduleName, rec);
    if (log.action === "doubao.call.error") {
      const err = typeof md.error === "string" ? md.error : "UNKNOWN";
      errors.set(err, (errors.get(err) ?? 0) + 1);
    }
  }

  const byModule = [...moduleAgg.entries()].map(([name, v]) => ({
    name,
    total: v.total,
    ok: v.ok,
    successRate: v.total ? v.ok / v.total : 0,
    avgLatencyMs: v.total ? v.duration / v.total : 0,
    avgTokens: v.total ? v.tokens / v.total : 0,
  }));

  const errorTop = [...errors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([reason, count]) => ({ reason, count }));

  return NextResponse.json({
    windowHours: hours,
    total,
    okCount,
    errorCount,
    successRate,
    byModule: byModule.sort((a, b) => b.total - a.total),
    errorTop,
    recent: logs.slice(0, 50),
  });
}
