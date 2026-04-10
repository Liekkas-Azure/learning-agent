import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@learning-saas/db";
import { getOrgContext, assertTopicInOrg } from "@/lib/org-context";
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
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← 返回主题列表
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">{topic.title}</h1>
        {topic.description ? <p className="mt-2 text-slate-400">{topic.description}</p> : null}
      </div>

      <TopicActions topicId={topicId} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">资料来源</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-slate-500">尚未添加来源。使用下方表单添加 RSS 或网页种子。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
              >
                <span className="font-mono text-xs text-sky-300">{s.type}</span>
                <span className="text-slate-400">{s.policy}</span>
                <span className="truncate text-slate-300">
                  {(s.config as { url?: string }).url ?? JSON.stringify(s.config)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <AddSourceForm topicId={topicId} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">资料库</h2>
          <Link
            href={`/topics/${topicId}/today`}
            className="text-sm text-sky-400 hover:underline"
          >
            今日学习 →
          </Link>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">采集完成后，条目会出现在这里。</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <a
                  href={d.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-300 hover:underline"
                >
                  {d.title ?? d.canonicalUrl}
                </a>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                  {d.domain} · {new Date(d.fetchedAt).toLocaleString()}
                </p>
                {d.excerpt ? <p className="mt-2 text-sm text-slate-400">{d.excerpt}</p> : null}
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
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/30 p-4"
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">类型</span>
          <select
            name="type"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-white"
          >
            <option value="SEED_URL">网页种子</option>
            <option value="RSS">RSS</option>
            <option value="SEARCH_QUERY">搜索（占位）</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">策略</span>
          <select
            name="policy"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-white"
          >
            <option value="strict">strict（遵守 robots，摘要为主）</option>
            <option value="expanded">expanded（更激进，自担风险）</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-slate-400">URL 或 RSS 地址</span>
        <input
          name="url"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          placeholder="https://..."
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">扩展深度（仅种子）</span>
          <input
            name="depth"
            type="number"
            min={0}
            max={3}
            defaultValue={1}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">刷新间隔（分钟，可选）</span>
          <input
            name="refreshCron"
            type="number"
            min={5}
            placeholder="如 360"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>
      </div>
      <button
        type="submit"
        className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
      >
        添加来源
      </button>
    </form>
  );
}
