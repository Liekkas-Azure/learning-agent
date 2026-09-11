import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import { ensureVaultTopic } from "@/lib/vault-topic";

type Params = { params: Promise<{ sourceId: string }> };

export async function DELETE(_req: Request, ctx: Params) {
  const { sourceId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await ensureVaultTopic(orgId);
  const res = await prisma.source.deleteMany({
    where: { id: sourceId, topicId: topic.id },
  });
  if (!res.count) return NextResponse.json({ error: "订阅不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
