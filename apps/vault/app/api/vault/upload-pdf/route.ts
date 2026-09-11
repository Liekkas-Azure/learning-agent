import { NextResponse } from "next/server";
import pdf from "pdf-parse";
import { getOrgContext, prisma } from "@learning-saas/db";
import { parseTagList } from "@/lib/vault-tags";
import { upsertVaultIndexDoc } from "@/lib/vault-index";
import { doubaoStructuredStrict } from "@/lib/doubao";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 必填" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "仅支持 PDF 文件" }, { status: 400 });
  }

  const titleInput = String(form.get("title") ?? "").trim();
  const origin = String(form.get("origin") ?? "PDF").trim() || "PDF";
  const tags = parseTagList(form.get("tags"));

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = await pdf(buf).catch(() => null);
  if (!parsed || !parsed.text.trim()) {
    return NextResponse.json({ error: "PDF 解析失败或内容为空" }, { status: 422 });
  }

  const title = titleInput || file.name.replace(/\.pdf$/i, "") || "PDF 文档";
  const text = parsed.text.replace(/\s+\n/g, "\n").trim();
  const summary = text.slice(0, 1000);
  const aiTags = await doubaoStructuredStrict<{ tags: string[] }>({
    prompt: `请从以下文档中提取 4~8 个中文知识标签，返回 JSON：{"tags":[]}\n标题:${title}\n正文:${text.slice(0, 8000)}`,
    orgId,
    module: "upload_pdf_tags",
  });
  const normalizedAiTags = parseTagList(aiTags.tags ?? []);
  if (normalizedAiTags.length === 0) {
    return NextResponse.json({ error: "LLM 未返回可用标签，请重试" }, { status: 502 });
  }
  const tagNames = [...new Set([...normalizedAiTags, ...tags])].slice(0, 10);

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
        kind: "clip",
        title,
        body: summary,
        origin,
        url: `file://${encodeURIComponent(file.name)}`,
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
    body: text.slice(0, 40_000),
    url: entry.url,
    origin: entry.origin,
  });

  return NextResponse.json({
    entry,
    pages: parsed.numpages,
    chars: text.length,
  });
}
