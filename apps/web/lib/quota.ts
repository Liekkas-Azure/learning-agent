import { prisma } from "@learning-saas/db";

export async function canEnqueueCrawl(orgId: string): Promise<boolean> {
  const quota = await prisma.orgQuota.findUnique({ where: { orgId } });
  if (!quota) return true;
  const now = new Date();
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!quota.quotaResetAt || quota.quotaResetAt < startOfUtcDay) {
    await prisma.orgQuota.update({
      where: { orgId },
      data: {
        crawlsUsedToday: 0,
        embedsUsedToday: 0,
        quotaResetAt: startOfUtcDay,
      },
    });
  }
  const q = await prisma.orgQuota.findUnique({ where: { orgId } });
  if (!q) return true;
  return q.crawlsUsedToday < q.dailyCrawlLimit;
}
