import Link from "next/link";
import { prisma } from "@learning-saas/db";
import { getOrgContext } from "@/lib/org-context";

export default async function HomePage() {
  const { orgId } = await getOrgContext();
  const topics = await prisma.topic.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { documents: true, sources: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">学习主题</h1>
          <p className="mt-1 text-sm text-slate-400">
            创建主题、添加 RSS 或种子 URL，启动采集后在「今日」里碎片化复习。
          </p>
        </div>
        <Link
          href="/topics/new"
          className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
        >
          新建主题
        </Link>
      </div>

      {topics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-slate-400">
          暂无主题。请先{" "}
          <Link href="/topics/new" className="text-sky-400 underline">
            创建一个
          </Link>
          。
        </div>
      ) : (
        <ul className="space-y-3">
          {topics.map((t) => (
            <li key={t.id}>
              <Link
                href={`/topics/${t.id}`}
                className="block rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-sky-700/60 hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium text-white">{t.title}</h2>
                    {t.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-400">{t.description}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    {t._count.sources} 源 · {t._count.documents} 篇
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
