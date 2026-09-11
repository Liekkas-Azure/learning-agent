import { NextResponse } from "next/server";
import { getOrgContext, prisma, type KnowledgeEntryKind } from "@learning-saas/db";
import { parseTagList } from "@/lib/vault-tags";
import { upsertVaultIndexDoc } from "@/lib/vault-index";

function isKind(v: unknown): v is KnowledgeEntryKind {
  return v === "link" || v === "note" || v === "clip";
}

export async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const tag = (searchParams.get("tag") ?? "").trim();
  const take = Math.min(80, Math.max(1, Number.parseInt(searchParams.get("take") ?? "40", 10) || 40));

  const where: {
    orgId: string;
    tags?: { some: { name: string } };
    OR?: Array<Record<string, { contains: string }>>;
  } = { orgId };

  if (tag) {
    where.tags = { some: { name: tag } };
  }

  if (q.length >= 1) {
    where.OR = [
      { title: { contains: q } },
      { body: { contains: q } },
      { url: { contains: q } },
      { origin: { contains: q } },
    ];
  }

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
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

  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const { orgId } = await getOrgContext();
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
  const kind = b.kind;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const url = typeof b.url === "string" ? b.url.trim() : null;
  const noteBody = typeof b.body === "string" ? b.body.trim() : null;
  const origin = typeof b.origin === "string" ? b.origin.trim() || null : null;

  if (!isKind(kind)) {
    return NextResponse.json({ error: "kind 须为 link | note | clip" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  if (kind === "link" && !url) {
    return NextResponse.json({ error: "链接类条目需要 url" }, { status: 400 });
  }

  const tagNames = parseTagList(b.tags ?? b.tagList);

  const entry = await prisma.$transaction(async (tx) => {
    const tagConnect = await Promise.all(
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
        kind,
        title,
        url: url || null,
        body: noteBody,
        origin,
        tags: { connect: tagConnect },
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

  return NextResponse.json({ entry }, { status: 201 });
}
