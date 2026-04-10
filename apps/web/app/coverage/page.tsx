import Link from "next/link";
import { prisma } from "@learning-saas/db";
import { getOrgContext } from "@/lib/org-context";
import { DomainChart } from "./domain-chart";

export default async function CoveragePage() {
  const { orgId } = await getOrgContext();

  const [topics, documents, sources, failures, byDomain, recent, quota, sub] = await Promise.all([
    prisma.topic.count({ where: { orgId } }),
    prisma.document.count({ where: { topic: { orgId } } }),
    prisma.source.count({ where: { topic: { orgId } } }),
    prisma.auditLog.count({ where: { orgId, action: "crawl.failed" } }),
    prisma.document.groupBy({
      by: ["domain"],
      where: { topic: { orgId }, domain: { not: null } },
      _count: true,
      orderBy: { _count: { domain: "desc" } },
      take: 8,
    }),
    prisma.document.findMany({
      where: { topic: { orgId } },
      orderBy: { fetchedAt: "desc" },
      take: 6,
      select: { title: true, canonicalUrl: true, fetchedAt: true, domain: true },
    }),
    prisma.orgQuota.findUnique({ where: { orgId } }),
    prisma.subscription.findUnique({ where: { orgId } }),
  ]);

  const chartData = byDomain.map((d) => ({
    name: d.domain ?? "?",
    count: d._count,
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← 返回
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">覆盖率仪表盘</h1>
        <p className="mt-1 text-sm text-slate-400">
          管理预期：来源数、文档数、失败信号与配额使用情况。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="主题" value={topics} />
        <Stat label="资料条目" value={documents} />
        <Stat label="来源" value={sources} />
        <Stat label="抓取失败（审计）" value={failures} />
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="text-sm font-medium text-slate-300">订阅与配额</h2>
        <dl className="mt-3 grid gap-2 text-sm text-slate-400 sm:grid-cols-2">
          <div>
            <dt>套餐</dt>
            <dd className="text-white">{sub?.plan ?? "—"}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd className="text-white">{sub?.status ?? "—"}</dd>
          </div>
          <div>
            <dt>今日抓取</dt>
            <dd className="text-white">
              {quota ? `${quota.crawlsUsedToday} / ${quota.dailyCrawlLimit}` : "—"}
            </dd>
          </div>
          <div>
            <dt>今日嵌入</dt>
            <dd className="text-white">
              {quota ? `${quota.embedsUsedToday} / ${quota.dailyEmbedLimit}` : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <DomainChart data={chartData} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">最近更新</h2>
        <ul className="space-y-2 text-sm">
          {recent.map((r) => (
            <li key={r.canonicalUrl} className="flex flex-col rounded-lg border border-slate-800/80 px-3 py-2">
              <span className="text-slate-200">{r.title ?? r.canonicalUrl}</span>
              <span className="text-xs text-slate-500">
                {r.domain} · {new Date(r.fetchedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
