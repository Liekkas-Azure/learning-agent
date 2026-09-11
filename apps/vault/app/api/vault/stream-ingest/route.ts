import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import {
  detectOriginFromUrl,
  inferTitleFromText,
  ingestFromUrl,
  summarizePlainText,
} from "@/lib/ingest";
import { parseTagList } from "@/lib/vault-tags";
import { upsertVaultIndexDoc } from "@/lib/vault-index";
import { doubaoStructured, doubaoStructuredStrict } from "@/lib/doubao";

function looksLikeUrl(v: string) {
  return /^https?:\/\//i.test(v.trim());
}

type StreamUnit = {
  raw: string;
  type: "url" | "text";
};

function splitStreamInput(input: string): StreamUnit[] {
  const lines = input
    .split(/\n/g)
    .map((v) => v.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const out: StreamUnit[] = [];
  let buffer: string[] = [];

  function flushBuffer() {
    if (!buffer.length) return;
    out.push({ raw: buffer.join("\n").trim(), type: "text" });
    buffer = [];
  }

  for (const line of lines) {
    if (looksLikeUrl(line)) {
      flushBuffer();
      out.push({ raw: line, type: "url" });
      continue;
    }
    if (line === "---" || line === "——" || line === "###") {
      flushBuffer();
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();
  return out.filter((u) => u.raw).slice(0, 50);
}

async function createOneEntry(params: {
  orgId: string;
  input: string;
  kind: string;
  tags: string[];
  origin?: string | null;
  url?: string | null;
}) {
  const { orgId, input, tags, kind } = params;
  let title = "";
  let content = "";
  let origin: string | null = null;
  let url: string | null = null;
  let entryKind: "link" | "note" | "clip" = "note";
  let suggestedTags: string[] = [];

  if (kind === "url" || (kind === "auto" && looksLikeUrl(input))) {
    const parsed = await ingestFromUrl(input).catch(() => null);
    if (!parsed) {
      return { error: "链接抓取失败", source: input };
    }
    const ai = await doubaoStructured<{
      title: string;
      summary: string;
      tags: string[];
      category: "link" | "clip" | "note";
      origin: string;
    }>({
      prompt: `请根据以下内容生成结构化知识条目。\n输出 JSON：{"title":"","summary":"","tags":[],"category":"link|clip|note","origin":""}\n内容标题:${parsed.title}\n来源:${parsed.origin ?? "网页"}\n正文:${parsed.content.slice(0, 5000)}`,
      fallback: {
        title: parsed.title,
        summary: `${parsed.summary}\n\n${parsed.content.slice(0, 2500)}`.trim(),
        tags: parsed.suggestedTags,
        category: "link",
        origin: parsed.origin ?? "网页",
      },
      orgId,
      module: "stream_ingest_url",
    });
    entryKind = ai.category === "note" ? "note" : ai.category === "clip" ? "clip" : "link";
    title = (ai.title || parsed.title).slice(0, 160);
    content = (ai.summary || `${parsed.summary}\n\n${parsed.content.slice(0, 2500)}`).trim();
    origin = ai.origin || parsed.origin;
    url = input;
    const tagAi = await doubaoStructuredStrict<{ tags: string[] }>({
      prompt: `请仅输出 JSON：{"tags":[]}\n请基于以下网页信息提取 4~8 个知识标签。\n标题:${title}\n来源:${origin ?? "网页"}\n摘要:${content.slice(0, 1200)}\n正文:${parsed.content.slice(0, 5000)}`,
      orgId,
      module: "stream_ingest_url_tags_strict",
    });
    suggestedTags = parseTagList(tagAi.tags ?? []);
  } else {
    const fallbackKind = kind === "clip" ? "clip" : "note";
    const ai = await doubaoStructured<{
      title: string;
      summary: string;
      tags: string[];
      category: "clip" | "note";
      origin: string | null;
    }>({
      prompt: `请把以下用户输入整理成知识库条目。\n输出 JSON：{"title":"","summary":"","tags":[],"category":"clip|note","origin":null}\n输入:${input.slice(0, 6000)}`,
      fallback: {
        title: inferTitleFromText(input),
        summary: summarizePlainText(input, 2400),
        tags: [],
        category: fallbackKind,
        origin: params.origin?.trim() || null,
      },
      orgId,
      module: "stream_ingest_text",
    });
    entryKind = ai.category === "clip" ? "clip" : "note";
    title = ai.title || inferTitleFromText(input);
    content = ai.summary || summarizePlainText(input, 2400);
    origin = ai.origin || params.origin?.trim() || null;
    url = params.url?.trim() || null;
    const tagAi = await doubaoStructuredStrict<{ tags: string[] }>({
      prompt: `请仅输出 JSON：{"tags":[]}\n请基于以下文本提取 4~8 个知识标签。\n标题:${title}\n正文:${content.slice(0, 5000)}`,
      orgId,
      module: "stream_ingest_text_tags_strict",
    });
    suggestedTags = parseTagList(tagAi.tags ?? []);
    if (url && !origin) origin = detectOriginFromUrl(url);
  }

  if (suggestedTags.length === 0) {
    return { error: "LLM 未返回可用标签", source: input };
  }
  const tagNames = [...new Set([...parseTagList(suggestedTags).slice(0, 6), ...tags])].slice(0, 12);

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
        kind: entryKind,
        title,
        body: content || null,
        origin: origin || null,
        url: url || null,
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
    body: entry.body ?? "",
    url: entry.url,
    origin: entry.origin,
  });

  return { entry };
}

export async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawInput = typeof body.input === "string" ? body.input.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "auto";
  const extraTags = parseTagList(body.tags);
  const batch = Boolean(body.batch);

  if (!rawInput) return NextResponse.json({ error: "input 必填" }, { status: 400 });

  if (batch) {
    const units = splitStreamInput(rawInput);
    if (units.length === 0) {
      return NextResponse.json({ error: "未识别到可归档内容" }, { status: 400 });
    }
    const results: Array<{ ok: boolean; entry?: unknown; source: string; error?: string }> = [];
    for (const unit of units) {
      const one = await createOneEntry({
        orgId,
        input: unit.raw,
        kind: unit.type === "url" ? "url" : kind,
        tags: extraTags,
      });
      if ("entry" in one) {
        results.push({ ok: true, entry: one.entry, source: unit.raw });
      } else {
        results.push({ ok: false, source: unit.raw, error: one.error });
      }
    }
    const success = results.filter((r) => r.ok).length;
    return NextResponse.json({
      batch: true,
      total: units.length,
      success,
      failed: units.length - success,
      results,
    });
  }

  const one = await createOneEntry({
    orgId,
    input: rawInput,
    kind,
    tags: extraTags,
    origin: typeof body.origin === "string" ? body.origin : null,
    url: typeof body.url === "string" ? body.url : null,
  });
  if (!("entry" in one)) {
    return NextResponse.json({ error: one.error ?? "入库失败" }, { status: 502 });
  }

  return NextResponse.json({ entry: one.entry }, { status: 201 });
}
