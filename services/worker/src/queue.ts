import { Queue } from "bullmq";
import { QUEUE_NAME, redisConnection } from "./config";
import type { CrawlPayload } from "./processors/crawl";

export type EmbedPayload = { orgId: string; documentId: string };
export type RssPayload = { orgId: string; sourceId: string };
export type RefreshPayload = { orgId: string; sourceId: string };

export type IngestionJobName = "CRAWL_URL" | "FETCH_RSS" | "EMBED_DOCUMENT" | "REFRESH_SOURCE";

export type IngestionJobData =
  | { name: "CRAWL_URL"; data: CrawlPayload }
  | { name: "FETCH_RSS"; data: RssPayload }
  | { name: "EMBED_DOCUMENT"; data: EmbedPayload }
  | { name: "REFRESH_SOURCE"; data: RefreshPayload };

export type IngestionQueue = Queue;

export function createQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: redisConnection() });
}
