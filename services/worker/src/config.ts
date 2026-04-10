export const QUEUE_NAME = "ingestion";

export function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  return { url };
}

export const MAX_RESPONSE_BYTES = 2_000_000;
export const USER_AGENT = "LearningSaaSBot/1.0 (+https://example.com)";
