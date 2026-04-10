import { NextResponse } from "next/server";
import { prisma } from "@learning-saas/db";
import { assertTopicInOrg, getOrgContext } from "@/lib/org-context";

type Params = { params: Promise<{ topicId: string }> };

export async function GET(_req: Request, ctx: Params) {
  const { topicId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const documents = await prisma.document.findMany({
    where: { topicId },
    orderBy: { fetchedAt: "desc" },
    select: {
      id: true,
      title: true,
      canonicalUrl: true,
      excerpt: true,
      fetchedAt: true,
      domain: true,
      storageTier: true,
      robotsAllowed: true,
    },
  });
  return NextResponse.json({ documents });
}
