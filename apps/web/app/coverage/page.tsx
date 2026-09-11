import Link from "next/link";
import { getOrgContext, prisma } from "@learning-saas/db";
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
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-sm font-medium text-slate-500 transition hover:text-cyan-300/90">
          ← 主题
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          <span className="ai-title-gradient">学习洞察</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
          用量、覆盖域名与失败信号一览，便于管理预期与配额。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="主题" value={topics} hint="topics" />
        <Stat label="资料条目" value={documents} hint="documents" />
        <Stat label="来源" value={sources} hint="sources" />
        <Stat label="抓取失败" value={failures} hint="audit" accent={failures > 0} />
      </div>

      <section className="ai-card p-5 sm:p-6">
        <h2 className="ai-section-label mb-4">订阅与配额</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-slate-600">套餐</dt>
            <dd className="mt-1 font-mono text-lg text-white">{sub?.plan ?? "—"}</dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-slate-600">状态</dt>
            <dd className="mt-1 font-mono text-lg text-emerald-200/90">{sub?.status ?? "—"}</dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-slate-600">今日抓取</dt>
            <dd className="mt-1 font-mono text-lg text-cyan-200/90">
              {quota ? `${quota.crawlsUsedToday} / ${quota.dailyCrawlLimit}` : "—"}
            </dd>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-slate-600">今日嵌入</dt>
            <dd className="mt-1 font-mono text-lg text-violet-200/90">
              {quota ? `${quota.embedsUsedToday} / ${quota.dailyEmbedLimit}` : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <DomainChart data={chartData} />

      <section className="space-y-3">
        <h2 className="ai-section-label">最近更新</h2>
        <ul className="space-y-2">
          {recent.length === 0 ? (
            <li className="text-sm text-slate-600">暂无记录</li>
          ) : (
            recent.map((r) => (
              <li key={r.canonicalUrl} className="ai-card flex flex-col gap-1 px-4 py-3">
                <span className="text-sm font-medium text-slate-200">{r.title ?? r.canonicalUrl}</span>
                <span className="font-mono text-[11px] text-slate-600">
                  {r.domain} · {new Date(r.fetchedAt).toLocaleString()}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`ai-card relative overflow-hidden p-5 ${
        accent ? "border-rose-500/25 shadow-[0_0_40px_-16px_rgba(244,63,94,0.35)]" : ""
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
          accent ? "via-rose-400/40" : "via-cyan-400/30"
        } to-transparent`}
      />
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 font-mono text-[10px] text-slate-600">{hint}</p>
    </div>
  );
}
