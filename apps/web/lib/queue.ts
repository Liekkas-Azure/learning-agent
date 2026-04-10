import { Queue } from "bullmq";

const QUEUE_NAME = "ingestion";

function connection() {
  return { url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" };
}

let queue: Queue | null = null;

export function getIngestionQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: connection() });
  }
  return queue;
}
