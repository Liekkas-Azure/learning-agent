import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertTopicInOrg, getOrgContext, prisma } from "@learning-saas/db";
import { TopicActions } from "./topic-actions";

type Props = { params: Promise<{ topicId: string }> };

export default async function TopicPage(props: Props) {
  const { topicId } = await props.params;
  const { orgId } = await getOrgContext();
  const topic = await assertTopicInOrg(topicId, orgId);
  if (!topic) notFound();

  const [sources, documents] = await Promise.all([
    prisma.source.findMany({ where: { topicId }, orderBy: { createdAt: "desc" } }),
    prisma.document.findMany({
      where: { topicId },
      orderBy: { fetchedAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        canonicalUrl: true,
        excerpt: true,
        domain: true,
        fetchedAt: true,
      },
    }),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-sm font-medium text-slate-500 transition hover:text-cyan-300/90">
          ← 全部主题
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              <span className="ai-title-gradient">{topic.title}</span>
            </h1>
            {topic.description ? (
              <p className="text-sm leading-relaxed text-slate-400 sm:text-base">{topic.description}</p>
            ) : null}
          </div>
          <Link
            href={`/topics/${topicId}/today`}
            className="ai-btn-ghost shrink-0 border border-white/[0.08] text-xs sm:text-sm"
          >
            进入今日 →
          </Link>
        </div>
      </div>

      <TopicActions topicId={topicId} />

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-2">
          <h2 className="ai-section-label">资料来源</h2>
          <span className="font-mono text-[10px] text-slate-600">{sources.length} sources</span>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-500">
          「智能采集」会基于百度百科、国内 RSS 与（若配置 <code className="ai-code-inline">BOCHA_API_KEY</code>
          ）博查网页检索自动挑选条目，无需粘贴链接。
        </p>
        {sources.length === 0 ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-100/90">
            尚未发现来源 — 请先点击上方「智能采集资料」。
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {sources.map((s) => {
              const cfg = s.config as {
                url?: string;
                label?: string;
                discoveredBy?: string;
              };
              return (
                <li key={s.id} className="ai-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ai-badge ai-badge-accent">{s.type}</span>
                    <span className="ai-badge">{s.policy}</span>
                    {cfg.discoveredBy ? (
                      <span className="rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-violet-200/90">
                        {cfg.discoveredBy}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-100">{cfg.label ?? cfg.url}</p>
                  {cfg.url ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-600">{cfg.url}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <details className="ai-card group overflow-hidden">
          <summary className="cursor-pointer list-none px-4 py-3.5 text-sm text-slate-400 transition hover:bg-white/[0.03] hover:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-xs text-slate-600">{"{}"}</span>
              高级 · 手动添加 RSS / URL
            </span>
          </summary>
          <div className="border-t border-white/[0.06] px-4 pb-4 pt-2">
            <AddSourceForm topicId={topicId} />
          </div>
        </details>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-2">
          <h2 className="ai-section-label">资料库</h2>
          <span className="font-mono text-[10px] text-slate-600">{documents.length} docs</span>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-600">采集完成后，结构化条目会出现在这里。</p>
        ) : (
          <ul className="space-y-3">
            {documents.map((d) => (
              <li key={d.id} className="ai-card p-4 transition hover:border-cyan-400/20">
                <a
                  href={d.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-cyan-200/95 transition hover:text-cyan-100"
                >
                  {d.title ?? d.canonicalUrl}
                </a>
                <p className="mt-1.5 font-mono text-[11px] text-slate-600">
                  {d.domain} · {new Date(d.fetchedAt).toLocaleString()}
                </p>
                {d.excerpt ? <p className="mt-2 text-sm leading-relaxed text-slate-500">{d.excerpt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddSourceForm({ topicId }: { topicId: string }) {
  return (
    <form
      className="space-y-4 pt-2"
      action={async (formData) => {
        "use server";
        const type = String(formData.get("type") || "SEED_URL");
        const url = String(formData.get("url") || "").trim();
        const policy = String(formData.get("policy") || "strict");
        const refreshCron = String(formData.get("refreshCron") || "").trim();
        const depth = Number(formData.get("depth") || 1);
        if (!url) return;
        const { orgId } = await getOrgContext();
        const topic = await assertTopicInOrg(topicId, orgId);
        if (!topic) return;
        await prisma.source.create({
          data: {
            topicId,
            type: type as "RSS" | "SEED_URL" | "SEARCH_QUERY",
            policy: policy === "expanded" ? "expanded" : "strict",
            config: { url },
            crawlDepth: Number.isFinite(depth) ? Math.min(3, Math.max(0, depth)) : 1,
            refreshCron: refreshCron || null,
          },
        });
        revalidatePath(`/topics/${topicId}`);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">类型</span>
          <select name="type" className="ai-select">
            <option value="SEED_URL">网页种子</option>
            <option value="RSS">RSS</option>
            <option value="SEARCH_QUERY">搜索（占位）</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">策略</span>
          <select name="policy" className="ai-select">
            <option value="strict">strict</option>
            <option value="expanded">expanded</option>
          </select>
        </label>
      </div>
      <label className="block space-y-2 text-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">URL</span>
        <input name="url" required className="ai-input" placeholder="https://..." />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">扩展深度</span>
          <input
            name="depth"
            type="number"
            min={0}
            max={3}
            defaultValue={1}
            className="ai-input"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">刷新间隔（分钟）</span>
          <input name="refreshCron" type="number" min={5} placeholder="可选" className="ai-input" />
        </label>
      </div>
      <button type="submit" className="ai-btn-secondary">
        添加来源
      </button>
    </form>
  );
}
