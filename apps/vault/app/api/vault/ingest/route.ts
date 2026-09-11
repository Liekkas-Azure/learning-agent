import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import { ingestFromUrl } from "@/lib/ingest";
import { parseTagList } from "@/lib/vault-tags";
import { upsertVaultIndexDoc } from "@/lib/vault-index";
import { doubaoStructured, doubaoStructuredStrict } from "@/lib/doubao";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const url = typeof b.url === "string" ? b.url.trim() : "";
  const shouldSave = Boolean(b.save);
  if (!url) {
    return NextResponse.json({ error: "url 必填" }, { status: 400 });
  }

  let parsed: Awaited<ReturnType<typeof ingestFromUrl>>;
  try {
    parsed = await ingestFromUrl(url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "抓取失败" }, { status: 502 });
  }

  if (!shouldSave) {
    return NextResponse.json({ draft: parsed });
  }

  const { orgId } = await getOrgContext();

  const ai = await doubaoStructured<{
    title: string;
    summary: string;
    tags: string[];
    origin: string;
  }>({
    prompt: `请整理以下网页信息用于个人知识库，输出 JSON：{"title":"","summary":"","tags":[],"origin":""}\n标题:${parsed.title}\n来源:${parsed.origin ?? "网页"}\n正文:${parsed.content.slice(0, 6000)}`,
    fallback: {
      title: parsed.title,
      summary: parsed.summary,
      tags: parsed.suggestedTags,
      origin: parsed.origin ?? "网页",
    },
    orgId,
    module: "ingest_url",
  });

  const customTags = parseTagList(b.tags);
  const tagAi = await doubaoStructuredStrict<{ tags: string[] }>({
    prompt: `请仅输出 JSON：{"tags":[]}\n请基于以下网页内容提取 4~8 个知识标签。\n标题:${ai.title || parsed.title}\n来源:${ai.origin || parsed.origin || "网页"}\n摘要:${ai.summary || parsed.summary}\n正文:${parsed.content.slice(0, 5000)}`,
    orgId,
    module: "ingest_url_tags_strict",
  });
  const autoTags = parseTagList(tagAi.tags ?? []).slice(0, 6);
  if (autoTags.length === 0) {
    return NextResponse.json({ error: "LLM 未返回可用标签，请重试" }, { status: 502 });
  }
  const tagNames = [...new Set([...autoTags, ...customTags])].slice(0, 8);

  const entry = await prisma.$transaction(async (tx) => {
    const connectTags = await Promise.all(
      tagNames.map(async (name) => {
        const tag = await tx.knowledgeTag.upsert({
          where: { orgId_name: { orgId, name } },
          create: { orgId, name },
          update: {},
        });
        return { id: tag.id };
      }),
    );

    return tx.knowledgeEntry.create({
      data: {
        orgId,
        kind: "link",
        title: ai.title || parsed.title,
        url,
        origin: ai.origin || parsed.origin,
        body: ai.summary || parsed.summary,
        tags: { connect: connectTags },
      },
      select: {
        id: true,
        kind: true,
        title: true,
        url: true,
        body: true,
        origin: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { id: true, name: true } },
      },
    });
  });

  await upsertVaultIndexDoc({
    orgId,
    entryId: entry.id,
    title: entry.title,
    body: `${ai.summary || parsed.summary}\n\n${parsed.content.slice(0, 2500)}`.trim(),
    url: entry.url,
    origin: entry.origin,
  });

  return NextResponse.json({ entry, draft: parsed }, { status: 201 });
}
