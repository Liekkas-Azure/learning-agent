import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";

export async function GET() {
  const { orgId } = await getOrgContext();

  const [topics, documents, sources, failures] = await Promise.all([
    prisma.topic.count({ where: { orgId } }),
    prisma.document.count({ where: { topic: { orgId } } }),
    prisma.source.count({ where: { topic: { orgId } } }),
    prisma.auditLog.count({
      where: { orgId, action: "crawl.failed" },
    }),
  ]);

  const byDomain = await prisma.document.groupBy({
    by: ["domain"],
    where: { topic: { orgId }, domain: { not: null } },
    _count: true,
    orderBy: { _count: { domain: "desc" } },
    take: 12,
  });

  const recent = await prisma.document.findMany({
    where: { topic: { orgId } },
    orderBy: { fetchedAt: "desc" },
    take: 5,
    select: { title: true, canonicalUrl: true, fetchedAt: true, domain: true },
  });

  const quota = await prisma.orgQuota.findUnique({ where: { orgId } });
  const sub = await prisma.subscription.findUnique({ where: { orgId } });

  return NextResponse.json({
    topics,
    documents,
    sources,
    failureSignals: failures,
    topDomains: byDomain.map((d: (typeof byDomain)[number]) => ({
      domain: d.domain,
      count: d._count,
    })),
    recentUpdates: recent,
    quota: quota
      ? {
          dailyCrawlLimit: quota.dailyCrawlLimit,
          crawlsUsedToday: quota.crawlsUsedToday,
          dailyEmbedLimit: quota.dailyEmbedLimit,
          embedsUsedToday: quota.embedsUsedToday,
        }
      : null,
    subscription: sub ? { plan: sub.plan, status: sub.status } : null,
  });
}
