import { NextResponse } from "next/server";
import { prisma } from "@learning-saas/db";
import { getOrgContext } from "@/lib/org-context";
import { logEvent } from "@/lib/telemetry";

export async function GET() {
  const { orgId } = await getOrgContext();
  const topics = await prisma.topic.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: true, sources: true } } },
  });
  logEvent("api.topics.list", { count: topics.length });
  return NextResponse.json({ topics });
}

export async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const topic = await prisma.topic.create({
    data: {
      orgId,
      title,
      description: typeof body.description === "string" ? body.description : null,
      goals: body.goals ?? null,
      language: typeof body.language === "string" ? body.language : "zh",
    },
  });
  await prisma.auditLog.create({
    data: { orgId, action: "topic.created", metadata: { topicId: topic.id } },
  });
  return NextResponse.json({ topic });
}
