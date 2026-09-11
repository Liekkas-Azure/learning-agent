import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import { doubaoStructured } from "@/lib/doubao";

function dayRange(input?: string | null) {
  const base = input ? new Date(input) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  const { searchParams } = new URL(req.url);
  const { start, end } = dayRange(searchParams.get("date"));

  const entries = await prisma.knowledgeEntry.findMany({
    where: {
      orgId,
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      kind: true,
      title: true,
      url: true,
      body: true,
      origin: true,
      createdAt: true,
      tags: { select: { id: true, name: true } },
    },
  });

  const byOrigin = new Map<string, number>();
  const byTag = new Map<string, number>();
  for (const e of entries) {
    const origin = (e.origin || "未知来源").trim();
    byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
    for (const t of e.tags) {
      byTag.set(t.name, (byTag.get(t.name) ?? 0) + 1);
    }
  }

  const topOrigins = [...byOrigin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  const topTags = [...byTag.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  const highlights = entries.slice(0, 8).map((e) => ({
    id: e.id,
    title: e.title,
    origin: e.origin,
    kind: e.kind,
    url: e.url,
    snippet: (e.body ?? "").slice(0, 160),
    tags: e.tags.map((t) => t.name),
  }));

  const ai = await doubaoStructured<{ summary: string; suggestions: string[] }>({
    prompt: `请根据今日知识库内容生成学习日报洞察。仅输出 JSON：{"summary":"","suggestions":["","",""]}\n统计:${JSON.stringify({
      total: entries.length,
      topOrigins,
      topTags,
    })}\n精选:${JSON.stringify(highlights.slice(0, 5))}`,
    fallback: {
      summary: "今日资料已完成自动汇总，建议优先处理高频主题并输出实践复盘。",
      suggestions: [
        topTags[0] ? `围绕「${topTags[0].name}」整理一页结构化复盘。` : "先从 3 条高质量资料开始沉淀。",
        topOrigins[0] ? `来源「${topOrigins[0].name}」占比最高，建议去重并抽取共性。` : "补充 1-2 个稳定来源做订阅。",
        "把今日高价值内容转化为可执行清单（实践步骤 + 验收标准）。",
      ],
    },
    orgId,
    module: "digest_summary",
  });

  return NextResponse.json({
    date: start.toISOString().slice(0, 10),
    stats: {
      total: entries.length,
      links: entries.filter((e) => e.kind === "link").length,
      clips: entries.filter((e) => e.kind === "clip").length,
      notes: entries.filter((e) => e.kind === "note").length,
    },
    topOrigins,
    topTags,
    highlights,
    summary: ai.summary,
    suggestions: ai.suggestions,
  });
}
