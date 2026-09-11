import { NextResponse } from "next/server";
import { assertTopicInOrg, getOrgContext, prisma } from "@learning-saas/db";

type Params = { params: Promise<{ topicId: string }> };

export async function GET(_req: Request, ctx: Params) {
  const { topicId } = await ctx.params;
  const { orgId, userId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cards = await prisma.learningArtifact.findMany({
    where: { topicId, kind: "card" },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  /** 与客户端 /progress 一致：优先 payload.id，否则用 artifact id（旧数据可能没有 payload.id） */
  function progressKey(c: (typeof cards)[0]): string {
    const p = c.payload as { id?: string };
    return typeof p?.id === "string" && p.id.length > 0 ? p.id : c.id;
  }

  const progress = await prisma.userProgress.findUnique({
    where: { userId_topicId: { userId, topicId } },
  });
  const seen = new Set<string>(
    Array.isArray(progress?.cardIdsSeen) ? (progress!.cardIdsSeen as string[]) : [],
  );

  const pool = cards.filter((c) => !seen.has(progressKey(c)));
  const pick = pool.slice(0, 7);
  if (pick.length < 5 && cards.length) {
    const fallback = cards.filter((c) => !pick.find((p) => p.id === c.id)).slice(0, 5 - pick.length);
    pick.push(...fallback);
  }

  return NextResponse.json({
    cards: pick.map((c) => ({
      id: c.id,
      progressId: progressKey(c),
      payload: c.payload,
    })),
  });
}
