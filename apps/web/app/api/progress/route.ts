import { NextResponse } from "next/server";
import { assertTopicInOrg, getOrgContext, prisma } from "@learning-saas/db";

export async function POST(req: Request) {
  const { orgId, userId } = await getOrgContext();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const topicId = typeof body.topicId === "string" ? body.topicId : "";
  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  if (!topicId || !cardId) {
    return NextResponse.json({ error: "topicId and cardId required" }, { status: 400 });
  }
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.userProgress.findUnique({
    where: { userId_topicId: { userId, topicId } },
  });
  const prev = Array.isArray(existing?.cardIdsSeen) ? ([...existing!.cardIdsSeen] as string[]) : [];
  if (!prev.includes(cardId)) prev.push(cardId);

  await prisma.userProgress.upsert({
    where: { userId_topicId: { userId, topicId } },
    create: {
      userId,
      topicId,
      cardIdsSeen: prev,
      lastSessionAt: new Date(),
    },
    update: {
      cardIdsSeen: prev,
      lastSessionAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, seen: prev.length });
}
