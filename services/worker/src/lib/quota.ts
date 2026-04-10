import type { PrismaClient } from "@learning-saas/db";

export async function ensureQuotaForCrawl(prisma: PrismaClient, orgId: string): Promise<boolean> {
  const quota = await prisma.orgQuota.findUnique({ where: { orgId } });
  if (!quota) return true;
  const now = new Date();
  let resetAt = quota.quotaResetAt;
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!resetAt || resetAt < startOfUtcDay) {
    await prisma.orgQuota.update({
      where: { orgId },
      data: {
        crawlsUsedToday: 0,
        embedsUsedToday: 0,
        quotaResetAt: startOfUtcDay,
      },
    });
  }
  const fresh = await prisma.orgQuota.findUnique({ where: { orgId } });
  if (!fresh) return true;
  if (fresh.crawlsUsedToday >= fresh.dailyCrawlLimit) return false;
  await prisma.orgQuota.update({
    where: { orgId },
    data: { crawlsUsedToday: { increment: 1 } },
  });
  return true;
}

export async function consumeEmbedQuota(prisma: PrismaClient, orgId: string): Promise<boolean> {
  const quota = await prisma.orgQuota.findUnique({ where: { orgId } });
  if (!quota) return true;
  if (quota.embedsUsedToday >= quota.dailyEmbedLimit) return false;
  await prisma.orgQuota.update({
    where: { orgId },
    data: { embedsUsedToday: { increment: 1 } },
  });
  return true;
}
