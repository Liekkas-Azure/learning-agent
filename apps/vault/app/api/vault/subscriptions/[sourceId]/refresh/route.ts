import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import { ensureVaultTopic } from "@/lib/vault-topic";
import { getIngestionQueue } from "@/lib/queue";

type Params = { params: Promise<{ sourceId: string }> };

export async function POST(_req: Request, ctx: Params) {
  const { sourceId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await ensureVaultTopic(orgId);
  const source = await prisma.source.findFirst({
    where: { id: sourceId, topicId: topic.id },
  });
  if (!source) return NextResponse.json({ error: "订阅不存在" }, { status: 404 });

  const queue = getIngestionQueue();
  if (source.type === "RSS") {
    await queue.add("FETCH_RSS", { orgId, sourceId }, { removeOnComplete: 100 });
  }
  if (source.type === "SEED_URL") {
    const cfg = source.config as { url?: string };
    if (cfg.url) {
      await queue.add(
        "CRAWL_URL",
        {
          orgId,
          topicId: topic.id,
          sourceId,
          url: cfg.url,
          depthLeft: source.crawlDepth,
          policy: source.policy,
        },
        { removeOnComplete: 100 },
      );
    }
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: { lastFetchedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
