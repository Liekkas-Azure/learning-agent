import { NextResponse } from "next/server";
import { getOrgContext, prisma, SourceType } from "@learning-saas/db";
import { ensureVaultTopic } from "@/lib/vault-topic";
import { getIngestionQueue } from "@/lib/queue";

const VALID_TYPES: SourceType[] = ["RSS", "SEED_URL"];

export async function GET() {
  const { orgId } = await getOrgContext();
  const topic = await ensureVaultTopic(orgId);
  const sources = await prisma.source.findMany({
    where: { topicId: topic.id },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  const topic = await ensureVaultTopic(orgId);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = (body.type as SourceType) ?? "RSS";
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "type 仅支持 RSS 或 SEED_URL" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url 必填" }, { status: 400 });
  }
  const refreshMinutes = Math.min(
    24 * 60,
    Math.max(5, Number.parseInt(String(body.refreshMinutes ?? "60"), 10) || 60),
  );
  const source = await prisma.source.create({
    data: {
      topicId: topic.id,
      type,
      policy: "strict",
      config: {
        url,
        label: typeof body.label === "string" ? body.label.trim() : null,
      },
      crawlDepth: type === "SEED_URL" ? 1 : 0,
      refreshCron: String(refreshMinutes),
    },
  });

  // 首次创建后立刻触发一次抓取，后续由 worker 定时刷新。
  const queue = getIngestionQueue();
  if (source.type === "RSS") {
    await queue.add("FETCH_RSS", { orgId, sourceId: source.id }, { removeOnComplete: 100 });
  } else {
    await queue.add(
      "CRAWL_URL",
      { orgId, topicId: topic.id, sourceId: source.id, url, depthLeft: 1, policy: "strict" },
      { removeOnComplete: 100 },
    );
  }

  return NextResponse.json({ source }, { status: 201 });
}
