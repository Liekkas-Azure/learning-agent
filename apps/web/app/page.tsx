import type { Prisma } from "@learning-saas/db";
import Link from "next/link";
import { getOrgContext, prisma } from "@learning-saas/db";

const topicListInclude = {
  _count: { select: { documents: true, sources: true } },
} satisfies Prisma.TopicInclude;

type TopicListItem = Prisma.TopicGetPayload<{ include: typeof topicListInclude }>;

/**
 * 冷启动或本地 SQLite 偶发较慢，本地可调大；在 Vercel 等无服务器环境下默认墙钟约 10s，
 * 若仍用 45s 等库超时，函数会先被平台掐断（浏览器表现为首页打不开 / 504），来不及渲染降级 UI。
 */
function homeDbTimeoutMs(): number {
  const custom = Number.parseInt(process.env.HOME_PAGE_DB_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(custom) && custom >= 1_000 && custom <= 120_000) return custom;
  if (process.env.VERCEL) return 8_000;
  return 45_000;
}

/** 无服务器函数最大执行时间（Vercel 等会读取；具体上限仍受套餐约束） */
export const maxDuration = 60;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label}超时（${ms}ms）：数据库可能未启动或网络不可达`)),
      ms,
    );
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

export default async function HomePage() {
  let topics: TopicListItem[] = [];
  let loadError: string | null = null;

  try {
    topics = await withTimeout(
      (async () => {
        const { orgId } = await getOrgContext();
        return prisma.topic.findMany({
          where: { orgId },
          orderBy: { updatedAt: "desc" },
          include: topicListInclude,
        });
      })(),
      homeDbTimeoutMs(),
      "首页数据加载",
    );
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  if (loadError) {
    return (
      <div className="ai-shimmer-border max-w-2xl">
        <div className="ai-shimmer-inner space-y-5 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200">
              !
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">暂时无法连接数据层</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                本页需要读取「学习主题」。请检查 <code className="ai-code-inline">DATABASE_URL</code>、是否已{" "}
                <code className="ai-code-inline">db:push</code> / <code className="ai-code-inline">db:seed</code>
                ，并确认数据库进程已启动。部署在无服务器环境时，若库连不上，超时过长会导致页面在返回本页面前被平台中断；已默认在{" "}
                <code className="ai-code-inline">VERCEL</code> 下缩短等待，可用{" "}
                <code className="ai-code-inline">HOME_PAGE_DB_TIMEOUT_MS</code> 覆盖（1000–120000）。
              </p>
            </div>
          </div>
          <div className="ai-divider" />
          <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
            <p className="ai-section-label mb-2">错误详情</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-rose-200/90">
              {loadError}
            </pre>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-400">
            <li>
              核对根目录 <code className="ai-code-inline">.env</code> 与{" "}
              <code className="ai-code-inline">apps/web/.env.local</code> 中的路径。
            </li>
            <li>
              执行 <code className="ai-code-inline">npm run db:push</code> 与{" "}
              <code className="ai-code-inline">npm run db:seed</code>。
            </li>
            <li>重启 <code className="ai-code-inline">npm run dev</code>。</li>
          </ol>
          <Link href="/topics/new" className="ai-btn-primary inline-flex w-full sm:w-auto">
            仍要新建主题
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-3">
          <p className="ai-section-label">Learning workspace</p>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1">
            <span className="ai-pulse-dot">
              <span />
              <span />
            </span>
            <span className="text-xs font-medium text-cyan-200/90">智能选源已就绪</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="ai-title-gradient">学习主题</span>
          </h1>
          <p className="text-sm leading-relaxed text-slate-400 sm:text-base">
            用一句话描述你想学的内容；系统会从百度百科、国内资讯源与（可选）博查检索中<strong className="font-medium text-slate-300">自动挑选来源</strong>
            ，再在「今日」里碎片化巩固。
          </p>
        </div>
        <Link href="/topics/new" className="ai-btn-primary shrink-0 self-start lg:self-auto">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建主题
        </Link>
      </div>

      {topics.length === 0 ? (
        <div className="ai-card flex flex-col items-center gap-4 px-6 py-14 text-center">
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-6">
            <p className="text-sm text-slate-400">还没有主题</p>
            <p className="mt-1 font-mono text-xs text-slate-600">topics.length === 0</p>
          </div>
          <Link href="/topics/new" className="ai-link text-sm font-medium">
            创建第一个主题 →
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {topics.map((t) => (
            <li key={t.id}>
              <Link
                href={`/topics/${t.id}`}
                className="ai-card ai-card-hover group relative z-10 block cursor-pointer p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-medium tracking-tight text-white group-hover:text-cyan-100/95">{t.title}</h2>
                    {t.description ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500">{t.description}</p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">暂无描述</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="ai-badge ai-badge-accent">
                      {t._count.sources} 源
                    </span>
                    <span className="ai-badge">{t._count.documents} 篇</span>
                  </div>
                </div>
                <div className="ai-divider mt-4" />
                <p className="mt-3 font-mono text-[10px] text-slate-600 opacity-0 transition group-hover:opacity-100">
                  open_topic →
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
