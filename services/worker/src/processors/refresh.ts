import type { Job } from "bullmq";
import type { PrismaClient } from "@learning-saas/db";
import { fetch } from "undici";
import { USER_AGENT } from "../config";
import type { IngestionQueue } from "../queue";
import type { CrawlPayload } from "./crawl";
import type { RssPayload } from "./rss";

export type RefreshPayload = { orgId: string; sourceId: string };

export async function processRefresh(
  prisma: PrismaClient,
  queue: IngestionQueue,
  job: Job<RefreshPayload>,
): Promise<void> {
  const { orgId, sourceId } = job.data;
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error("Source not found");

  if (source.type === "RSS") {
    const cfg = source.config as { url?: string };
    if (!cfg?.url) return;
    let shouldFetch = true;
    try {
      const head = await fetch(cfg.url, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      const etag = head.headers.get("etag");
      const lm = head.headers.get("last-modified");
      if (source.etag && etag && source.etag === etag) shouldFetch = false;
      if (source.lastModifiedHeader && lm && source.lastModifiedHeader === lm) shouldFetch = false;
    } catch {
      shouldFetch = true;
    }
    if (shouldFetch) {
      await queue.add("FETCH_RSS", { orgId, sourceId } satisfies RssPayload, {
        removeOnComplete: 100,
      });
    }
    return;
  }

  if (source.type === "SEED_URL") {
    const cfg = source.config as { url?: string };
    if (!cfg?.url) return;
    let changed = true;
    try {
      const head = await fetch(cfg.url, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      const etag = head.headers.get("etag");
      const lm = head.headers.get("last-modified");
      if (source.etag && etag && source.etag === etag) changed = false;
      if (source.lastModifiedHeader && lm && source.lastModifiedHeader === lm) changed = false;
    } catch {
      changed = true;
    }
    if (changed) {
      const payload: CrawlPayload = {
        orgId,
        topicId: source.topicId,
        sourceId,
        url: cfg.url,
        depthLeft: source.crawlDepth,
        policy: source.policy,
      };
      await queue.add("CRAWL_URL", payload, { removeOnComplete: 200 });
    }
  }

  if (source.type === "SEARCH_QUERY") {
    await prisma.auditLog.create({
      data: {
        orgId,
        action: "refresh.search_skipped",
        metadata: { sourceId, hint: "Wire a search API to enqueue new URLs" },
      },
    });
  }
}
