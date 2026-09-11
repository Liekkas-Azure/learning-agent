import { prisma } from "./client";

export type OrgContext = {
  orgId: string;
  userId: string;
};

/**
 * 开发环境（或非 production 且允许）在缺少 demo 组织时自动写入 Organization / OrgQuota / Subscription，
 * 避免仅因未执行 seed 导致全站页面报错。
 */
async function ensureDemoOrgIfAllowed(slug: string): Promise<void> {
  const allow =
    process.env.NODE_ENV !== "production" || process.env.DEMO_AUTO_BOOTSTRAP === "1";
  if (!allow) return;

  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) return;

  const org = await prisma.organization.create({
    data: { name: "Demo Organization", slug },
  });
  await prisma.orgQuota.create({
    data: {
      orgId: org.id,
      dailyCrawlLimit: 200,
      dailyEmbedLimit: 1000,
    },
  });
  await prisma.subscription.create({
    data: { orgId: org.id, plan: "free", status: "active" },
  });
}

export async function getOrgContext(): Promise<OrgContext> {
  const slug = process.env.DEMO_ORG_SLUG ?? "demo-org";
  let org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    await ensureDemoOrgIfAllowed(slug);
    org = await prisma.organization.findUnique({ where: { slug } });
  }
  if (!org) {
    throw new Error(
      "未找到组织（Organization）。请在仓库根目录配置 DATABASE_URL 后执行：npm run db:push && npm run db:seed",
    );
  }
  const user =
    (await prisma.user.findUnique({ where: { email: "demo@local.test" } })) ??
    (await prisma.user.create({ data: { email: "demo@local.test" } }));
  return { orgId: org.id, userId: user.id };
}

export async function assertTopicInOrg(topicId: string, orgId: string) {
  const topic = await prisma.topic.findFirst({ where: { id: topicId, orgId } });
  if (!topic) {
    return null;
  }
  return topic;
}
