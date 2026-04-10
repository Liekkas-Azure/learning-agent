import { NextResponse } from "next/server";
import { prisma } from "@learning-saas/db";
import { assertTopicInOrg, getOrgContext } from "@/lib/org-context";
import { getIngestionQueue } from "@/lib/queue";
import { canEnqueueCrawl } from "@/lib/quota";

type Params = { params: Promise<{ topicId: string }> };

export async function POST(_req: Request, ctx: Params) {
  const { topicId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ok = await canEnqueueCrawl(orgId);
  if (!ok) {
    return NextResponse.json({ error: "Daily crawl quota exceeded" }, { status: 429 });
  }

  const sources = await prisma.source.findMany({ where: { topicId } });
  const queue = getIngestionQueue();
  let jobs = 0;

  for (const s of sources) {
    if (s.type === "RSS") {
      await queue.add("FETCH_RSS", { orgId, sourceId: s.id }, { removeOnComplete: 100 });
      jobs += 1;
    }
    if (s.type === "SEED_URL") {
      const cfg = s.config as { url?: string };
      if (cfg?.url) {
        await queue.add(
          "CRAWL_URL",
          {
            orgId,
            topicId,
            sourceId: s.id,
            url: cfg.url,
            depthLeft: s.crawlDepth,
            policy: s.policy,
          },
          { removeOnComplete: 200 },
        );
        jobs += 1;
      }
    }
    if (s.type === "SEARCH_QUERY") {
      await prisma.auditLog.create({
        data: {
          orgId,
          action: "ingest.search_stub",
          metadata: { topicId, sourceId: s.id, hint: "Connect Bing/Google search API here" },
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: { orgId, action: "ingest.triggered", metadata: { topicId, jobs } },
  });

  return NextResponse.json({ enqueued: jobs });
}
