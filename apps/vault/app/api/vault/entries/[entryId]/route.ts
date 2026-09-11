import type { Prisma } from "@learning-saas/db";
import { NextResponse } from "next/server";
import { getOrgContext, prisma, type KnowledgeEntryKind } from "@learning-saas/db";
import { parseTagList } from "@/lib/vault-tags";
import { removeVaultIndexDoc, upsertVaultIndexDoc } from "@/lib/vault-index";

type Params = { params: Promise<{ entryId: string }> };

function isKind(v: unknown): v is KnowledgeEntryKind {
  return v === "link" || v === "note" || v === "clip";
}

export async function GET(_req: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  const { orgId } = await getOrgContext();

  const entry = await prisma.knowledgeEntry.findFirst({
    where: { id: entryId, orgId },
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

  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PATCH(req: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  const { orgId } = await getOrgContext();

  const existing = await prisma.knowledgeEntry.findFirst({ where: { id: entryId, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
  const title = typeof b.title === "string" ? b.title.trim() : undefined;
  const url = typeof b.url === "string" ? b.url.trim() : undefined;
  const noteBody = typeof b.body === "string" ? b.body.trim() : undefined;
  const origin = typeof b.origin === "string" ? b.origin.trim() : undefined;
  const kind = b.kind;

  if (kind !== undefined && !isKind(kind)) {
    return NextResponse.json({ error: "kind 须为 link | note | clip" }, { status: 400 });
  }
  if (title !== undefined && !title) {
    return NextResponse.json({ error: "title 不能为空" }, { status: 400 });
  }

  const nextKind = kind ?? existing.kind;
  const nextUrl = url !== undefined ? (url || null) : existing.url;
  const nextTitle = title ?? existing.title;

  if (nextKind === "link" && !nextUrl) {
    return NextResponse.json({ error: "链接类条目需要 url" }, { status: 400 });
  }

  const hasTagInput = b.tags !== undefined || b.tagList !== undefined;
  const tagNames = hasTagInput ? parseTagList(b.tags ?? b.tagList) : null;
  const tagConnect =
    tagNames === null
      ? undefined
      : await Promise.all(
          tagNames.map(async (name) => {
            const tag = await prisma.knowledgeTag.upsert({
              where: { orgId_name: { orgId, name } },
              create: { orgId, name },
              update: {},
            });
            return { id: tag.id };
          }),
        );

  const data: Prisma.KnowledgeEntryUpdateInput = {};
  if (kind !== undefined) data.kind = kind;
  if (title !== undefined) data.title = nextTitle;
  if (url !== undefined) data.url = url || null;
  if (noteBody !== undefined) data.body = noteBody || null;
  if (origin !== undefined) data.origin = origin || null;
  if (tagConnect !== undefined) data.tags = { set: tagConnect };

  if (Object.keys(data).length === 0) {
    const entry = await prisma.knowledgeEntry.findFirst({
      where: { id: entryId, orgId },
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
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ entry });
  }

  const entry = await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data,
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

  await upsertVaultIndexDoc({
    orgId,
    entryId: entry.id,
    title: entry.title,
    body: entry.body ?? "",
    url: entry.url,
    origin: entry.origin,
  });

  return NextResponse.json({ entry });
}

export async function DELETE(_req: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  const { orgId } = await getOrgContext();

  const res = await prisma.knowledgeEntry.deleteMany({ where: { id: entryId, orgId } });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await removeVaultIndexDoc(orgId, entryId);
  return NextResponse.json({ ok: true });
}
