import { NextResponse } from "next/server";
import { prisma, SourcePolicy, SourceType } from "@learning-saas/db";
import { assertTopicInOrg, getOrgContext } from "@/lib/org-context";

type Params = { params: Promise<{ topicId: string }> };

const types: SourceType[] = ["RSS", "SEED_URL", "SEARCH_QUERY"];
const policies: SourcePolicy[] = ["strict", "expanded"];

export async function POST(req: Request, ctx: Params) {
  const { topicId } = await ctx.params;
  const { orgId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const type = body.type as SourceType;
  if (!types.includes(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  const policy = (policies.includes(body.policy) ? body.policy : "strict") as SourcePolicy;
  const config = body.config;
  if (!config || typeof config !== "object") {
    return NextResponse.json({ error: "config object required" }, { status: 400 });
  }
  const crawlDepth = typeof body.crawlDepth === "number" ? Math.min(3, Math.max(0, body.crawlDepth)) : 1;
  const refreshCron =
    typeof body.refreshCron === "string" && body.refreshCron.trim()
      ? body.refreshCron.trim()
      : null;

  const source = await prisma.source.create({
    data: {
      topicId,
      type,
      policy,
      config,
      crawlDepth,
      refreshCron,
    },
  });

  await prisma.auditLog.create({
    data: { orgId, action: "source.created", metadata: { sourceId: source.id, topicId } },
  });

  return NextResponse.json({ source });
}
