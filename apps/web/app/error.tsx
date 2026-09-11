"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-white">页面加载出错</h1>
      <p className="text-sm leading-relaxed text-slate-400">
        请稍后重试。若仅首页异常，多为数据库连接或环境变量未就绪；开发环境请确认{" "}
        <code className="ai-code-inline">DATABASE_URL</code> 与 <code className="ai-code-inline">npm run db:push</code>。
      </p>
      {error.message ? (
        <pre className="max-h-36 overflow-auto rounded-xl border border-white/[0.08] bg-black/40 p-3 text-left font-mono text-xs text-rose-200/90">
          {error.message}
        </pre>
      ) : null}
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => reset()} className="ai-btn-secondary">
          重试
        </button>
        <Link href="/" className="ai-btn-primary">
          回首页
        </Link>
      </div>
    </div>
  );
}
