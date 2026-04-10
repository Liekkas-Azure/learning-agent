import robotsParser from "robots-parser";
import { fetch } from "undici";
import { USER_AGENT } from "../config";
import { assertFetchableUrl } from "./url";

const cache = new Map<string, { expires: number; check: (url: string) => boolean }>();

function cacheKey(origin: string) {
  return origin;
}

export async function isAllowedByRobots(
  targetUrl: string,
  respectRobots: boolean,
): Promise<boolean> {
  if (!respectRobots) return true;
  const u = assertFetchableUrl(targetUrl);
  const origin = `${u.protocol}//${u.host}`;
  const now = Date.now();
  const key = cacheKey(origin);
  let entry = cache.get(key);
  if (!entry || entry.expires < now) {
    const robotsUrl = new URL("/robots.txt", origin).toString();
    let body = "";
    try {
      const res = await fetch(robotsUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        body = await res.text();
        if (body.length > 500_000) body = body.slice(0, 500_000);
      }
    } catch {
      body = "";
    }
    const robots = robotsParser(robotsUrl, body);
    entry = {
      expires: now + 60 * 60 * 1000,
      check: (url: string) => robots.isAllowed(url, USER_AGENT) !== false,
    };
    cache.set(key, entry);
  }
  return entry.check(u.toString());
}
