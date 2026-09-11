import { Queue } from "bullmq";

const QUEUE_NAME = "ingestion";

let queue: Queue | null = null;

function redisConnection() {
  return { url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" };
}

export function getIngestionQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  }
  return queue;
}
