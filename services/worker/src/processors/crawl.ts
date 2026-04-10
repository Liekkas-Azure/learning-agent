import type { Job } from "bullmq";
import type { PrismaClient, SourcePolicy } from "@learning-saas/db";
import { fetch } from "undici";
import * as cheerio from "cheerio";
import { MAX_RESPONSE_BYTES, USER_AGENT } from "../config";
import { extractArticle } from "../lib/extract";
import { chunkText } from "../lib/chunk";
import { sha256 } from "../lib/hash";
import { isAllowedByRobots } from "../lib/robots";
import { assertFetchableUrl, canonicalizeUrl } from "../lib/url";
import { ensureQuotaForCrawl } from "../lib/quota";
import type { IngestionQueue } from "../queue";

export type CrawlPayload = {
  orgId: string;
  topicId: string;
  sourceId?: string;
  url: string;
  depthLeft?: number;
  policy: SourcePolicy;
};

async function fetchBody(url: string): Promise<{
  body: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
}> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const cl = res.headers.get("content-length");
  if (cl && Number(cl) > MAX_RESPONSE_BYTES) {
    throw new Error("Response too large (content-length)");
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const t = await res.text();
    return {
      body: t.slice(0, MAX_RESPONSE_BYTES),
      status: res.status,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) throw new Error("Response too large");
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return {
    body,
    status: res.status,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

function respectRobotsForPolicy(policy: SourcePolicy): boolean {
  return policy === "strict";
}

export async function processCrawl(
  prisma: PrismaClient,
  queue: IngestionQueue,
  job: Job<CrawlPayload>,
): Promise<void> {
  const { orgId, topicId, sourceId, url, depthLeft = 0, policy } = job.data;
  const allowedQuota = await ensureQuotaForCrawl(prisma, orgId);
  if (!allowedQuota) {
    throw new Error("Daily crawl quota exceeded");
  }

  const parsed = assertFetchableUrl(url);
  const canonical = canonicalizeUrl(parsed);
  const respect = respectRobotsForPolicy(policy);
  const robotsOk = await isAllowedByRobots(canonical, respect);

  let html = "";
  let status = 0;
  let etag: string | null = null;
  let lastModified: string | null = null;
  try {
    const r = await fetchBody(canonical);
    html = r.body;
    status = r.status;
    etag = r.etag;
    lastModified = r.lastModified;
  } catch (e) {
    await prisma.auditLog.create({
      data: {
        orgId,
        action: "crawl.failed",
        metadata: { url: canonical, error: String(e), robotsAllowed: robotsOk, policy },
      },
    });
    throw e;
  }

  const domain = parsed.hostname;
  const extracted = extractArticle(html, canonical);
  const hash = sha256(extracted.textContent || html);

  const existing = await prisma.document.findUnique({
    where: { topicId_canonicalUrl: { topicId, canonicalUrl: canonical } },
  });

  if (existing?.contentHash === hash) {
    await prisma.document.update({
      where: { id: existing.id },
      data: { fetchedAt: new Date(), httpStatus: status, etag, lastModifiedHeader: lastModified, robotsAllowed: robotsOk },
    });
    await prisma.auditLog.create({
      data: {
        orgId,
        action: "crawl.unchanged",
        metadata: { url: canonical, documentId: existing.id, policy },
      },
    });
    return;
  }

  const excerpt =
    extracted.excerpt ??
    (extracted.textContent ? extracted.textContent.slice(0, 400) : null);

  const doc = await prisma.document.upsert({
    where: { topicId_canonicalUrl: { topicId, canonicalUrl: canonical } },
    create: {
      topicId,
      sourceId: sourceId ?? null,
      url: canonical,
      canonicalUrl: canonical,
      title: extracted.title,
      excerpt,
      bodyText: policy === "strict" ? excerpt : extracted.textContent.slice(0, 50_000),
      contentHash: hash,
      storageTier: policy === "strict" ? "summary" : "full",
      httpStatus: status,
      robotsAllowed: robotsOk,
      domain,
      etag,
      lastModifiedHeader: lastModified,
    },
    update: {
      sourceId: sourceId ?? undefined,
      title: extracted.title,
      excerpt,
      bodyText: policy === "strict" ? excerpt : extracted.textContent.slice(0, 50_000),
      contentHash: hash,
      storageTier: policy === "strict" ? "summary" : "full",
      fetchedAt: new Date(),
      httpStatus: status,
      robotsAllowed: robotsOk,
      domain,
      etag,
      lastModifiedHeader: lastModified,
    },
  });

  await prisma.chunk.deleteMany({ where: { documentId: doc.id } });
  const parts = chunkText(extracted.textContent || excerpt || "");
  let pos = 0;
  for (const content of parts) {
    await prisma.chunk.create({
      data: { documentId: doc.id, content, position: pos++ },
    });
  }

  await prisma.learningArtifact.deleteMany({
    where: { topicId, kind: "card", documentId: doc.id },
  });

  const cards = parts.slice(0, 8).map((c, i) => ({
    topicId,
    documentId: doc.id,
    kind: "card" as const,
    payload: {
      id: `${doc.id}-${i}`,
      title: extracted.title ?? `要点 ${i + 1}`,
      body: c.slice(0, 500),
      documentId: doc.id,
      url: canonical,
      multimodal: { type: "text" as const },
    },
  }));
  for (const c of cards) {
    await prisma.learningArtifact.create({ data: c });
  }

  await prisma.auditLog.create({
    data: {
      orgId,
      action: "crawl.complete",
      metadata: {
        url: canonical,
        documentId: doc.id,
        httpStatus: status,
        robotsAllowed: robotsOk,
        policy,
        jobId: job.id,
      },
    },
  });

  if (sourceId) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { lastFetchedAt: new Date() },
    });
  }

  await queue.add(
    "EMBED_DOCUMENT",
    { orgId, documentId: doc.id },
    { removeOnComplete: 100, removeOnFail: 50 },
  );

  if (depthLeft > 0 && sourceId) {
    const $ = cheerio.load(html);
    const sameHost = parsed.hostname;
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || links.length >= 12) return;
      try {
        const next = new URL(href, canonical);
        if (next.hostname !== sameHost) return;
        if (next.protocol !== "http:" && next.protocol !== "https:") return;
        links.push(canonicalizeUrl(next));
      } catch {
        /* skip */
      }
    });
    const unique = [...new Set(links)].filter((l) => l !== canonical).slice(0, 8);
    for (const link of unique) {
      await queue.add(
        "CRAWL_URL",
        { orgId, topicId, sourceId, url: link, depthLeft: depthLeft - 1, policy },
        { removeOnComplete: 200, removeOnFail: 100 },
      );
    }
  }
}
