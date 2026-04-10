import { prisma } from "@learning-saas/db";

export type OrgContext = {
  orgId: string;
  userId: string;
};

export async function getOrgContext(): Promise<OrgContext> {
  const slug = process.env.DEMO_ORG_SLUG ?? "demo-org";
  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    throw new Error("Organization not found. Run: npm run db:push && npm run db:seed");
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
