import type { Job } from "bullmq";
import type { PrismaClient } from "@learning-saas/db";
import Parser from "rss-parser";
import { fetch } from "undici";
import { USER_AGENT } from "../config";
import type { IngestionQueue } from "../queue";
import type { CrawlPayload } from "./crawl";

export type RssPayload = { orgId: string; sourceId: string };

const parser = new Parser({
  headers: { "User-Agent": USER_AGENT },
  requestOptions: { timeout: 15000 },
});

export async function processRss(
  prisma: PrismaClient,
  queue: IngestionQueue,
  job: Job<RssPayload>,
): Promise<void> {
  const { orgId, sourceId } = job.data;
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    include: { topic: true },
  });
  if (!source) throw new Error("Source not found");
  const cfg = source.config as { url?: string };
  if (!cfg?.url) throw new Error("RSS source missing config.url");

  const res = await fetch(cfg.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(20000),
  });
  const xml = await res.text();
  const feed = await parser.parseString(xml);

  const policy = source.policy;
  const depth = Math.max(0, source.crawlDepth - 1);

  for (const item of feed.items.slice(0, 30)) {
    const link = item.link ?? item.guid;
    if (!link) continue;
    const payload: CrawlPayload = {
      orgId,
      topicId: source.topicId,
      sourceId,
      url: link,
      depthLeft: depth,
      policy,
    };
    await queue.add("CRAWL_URL", payload, { removeOnComplete: 200, removeOnFail: 100 });
  }

  const hash = Buffer.from(xml).toString("base64").slice(0, 64);
  await prisma.source.update({
    where: { id: sourceId },
    data: {
      lastFetchedAt: new Date(),
      etag: res.headers.get("etag"),
      lastModifiedHeader: res.headers.get("last-modified"),
      contentHash: hash,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      action: "rss.fetched",
      metadata: { sourceId, items: feed.items.length, jobId: job.id },
    },
  });
}
