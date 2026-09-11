import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";

export async function GET() {
  const { orgId } = await getOrgContext();

  const tags = await prisma.knowledgeTag.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { entries: true } },
    },
  });

  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, count: t._count.entries })),
  });
}
