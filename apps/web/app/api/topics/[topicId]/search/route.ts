import { NextResponse } from "next/server";
import { prisma } from "@learning-saas/db";
import { assertTopicInOrg, getOrgContext } from "@/lib/org-context";

type Params = { params: Promise<{ topicId: string }> };

export async function GET(req: Request, ctx: Params) {
  const { topicId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ documents: [] });
  }

  const documents = await prisma.document.findMany({
    where: {
      topicId,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { excerpt: { contains: q, mode: "insensitive" } },
        { canonicalUrl: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 20,
    orderBy: { fetchedAt: "desc" },
    select: {
      id: true,
      title: true,
      canonicalUrl: true,
      excerpt: true,
      domain: true,
      fetchedAt: true,
    },
  });

  return NextResponse.json({ documents });
}
