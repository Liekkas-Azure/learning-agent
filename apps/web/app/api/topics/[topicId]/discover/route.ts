import { NextResponse } from "next/server";
import { assertTopicInOrg, getOrgContext, prisma } from "@learning-saas/db";
import { discoverSourcesForTopic } from "@/lib/discover-sources";
import { logEvent } from "@/lib/telemetry";

type Params = { params: Promise<{ topicId: string }> };

function configUrl(s: { config: unknown }): string | null {
  const c = s.config as { url?: string };
  return typeof c?.url === "string" ? c.url : null;
}

export async function POST(_req: Request, ctx: Params) {
  const { topicId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const seeds = await discoverSourcesForTopic({
    title: topic.title,
    description: topic.description,
    language: topic.language,
  });

  const existing = await prisma.source.findMany({ where: { topicId } });
  const seen = new Set(
    existing.map((e) => configUrl(e)).filter((u): u is string => Boolean(u)),
  );

  let created = 0;
  const added: { type: string; url: string; provider: string }[] = [];

  for (const item of seeds) {
    if (seen.has(item.url)) continue;
    await prisma.source.create({
      data: {
        topicId,
        type: item.type,
        policy: "strict",
        crawlDepth: item.type === "SEED_URL" ? 0 : 1,
        refreshCron: item.type === "RSS" ? "720" : null,
        config: {
          url: item.url,
          discoveredBy: item.provider,
          label: item.label,
          autoDiscovered: true,
        },
      },
    });
    seen.add(item.url);
    created += 1;
    added.push({ type: item.type, url: item.url, provider: item.provider });
  }

  await prisma.auditLog.create({
    data: {
      orgId,
      action: "sources.discovered",
      metadata: { topicId, created, candidates: seeds.length },
    },
  });

  logEvent("api.topics.discover", { topicId, created });

  return NextResponse.json({
    created,
    candidates: seeds.length,
    sources: added,
    hint:
      created === 0 && seeds.length === 0
        ? "未找到可用来源，可稍后重试；配置 BOCHA_API_KEY（博查网页搜索）可增强国内网页检索。"
        : undefined,
  });
}
