import { Worker } from "bullmq";
import { prisma } from "@learning-saas/db";
import { QUEUE_NAME, redisConnection } from "./config";
import { createQueue } from "./queue";
import { processCrawl, type CrawlPayload } from "./processors/crawl";
import { processRss, type RssPayload } from "./processors/rss";
import { processEmbed } from "./processors/embed";
import { processRefresh, type RefreshPayload } from "./processors/refresh";
import type { EmbedPayload } from "./queue";

const connection = redisConnection();
const queue = createQueue();

async function scheduleDueRefreshes(): Promise<void> {
  const sources = await prisma.source.findMany({
    where: { refreshCron: { not: null } },
  });
  for (const s of sources) {
    const intervalMin = parseInt(s.refreshCron ?? "", 10);
    if (!intervalMin || intervalMin < 5) continue;
    const last = s.lastFetchedAt ?? new Date(0);
    if (Date.now() - last.getTime() < intervalMin * 60 * 1000) continue;
    const topic = await prisma.topic.findUnique({ where: { id: s.topicId } });
    if (!topic) continue;
    await queue.add(
      "REFRESH_SOURCE",
      { orgId: topic.orgId, sourceId: s.id } satisfies RefreshPayload,
      {
        jobId: `refresh-due-${s.id}-${Math.floor(Date.now() / (intervalMin * 60 * 1000))}`,
        removeOnComplete: true,
      },
    );
  }
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    switch (job.name) {
      case "CRAWL_URL":
        return processCrawl(prisma, queue, job as typeof job & { data: CrawlPayload });
      case "FETCH_RSS":
        return processRss(prisma, queue, job as typeof job & { data: RssPayload });
      case "EMBED_DOCUMENT":
        return processEmbed(prisma, job as typeof job & { data: EmbedPayload });
      case "REFRESH_SOURCE":
        return processRefresh(prisma, queue, job as typeof job & { data: RefreshPayload });
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  },
  { connection },
);

worker.on("failed", (job, err) => {
  console.error("Job failed", job?.id, job?.name, err);
});

void scheduleDueRefreshes();
setInterval(() => {
  void scheduleDueRefreshes();
}, 5 * 60 * 1000);

console.log("Worker listening on queue", QUEUE_NAME);
