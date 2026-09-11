import { NextResponse } from "next/server";
import { assertTopicInOrg, getOrgContext, prisma } from "@learning-saas/db";

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
        { title: { contains: q } },
        { excerpt: { contains: q } },
        { canonicalUrl: { contains: q } },
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
