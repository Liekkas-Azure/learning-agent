"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewTopicPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "创建失败");
      return;
    }
    router.push(`/topics/${data.topic.id}`);
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link href="/" className="text-sm font-medium text-slate-500 transition hover:text-cyan-300/90">
          ← 返回
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          <span className="ai-title-gradient">新建学习主题</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          描述你想掌握的方向即可。保存后在详情页点击「智能采集资料」，系统会<strong className="font-medium text-slate-300">自动发现</strong>
          百度百科、国内资讯 RSS 与（可选）博查网页结果。
        </p>
      </div>

      <div className="ai-shimmer-border">
        <form onSubmit={onSubmit} className="ai-shimmer-inner space-y-5 p-6 sm:p-7">
          <label className="block space-y-2">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">标题</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="ai-input"
              placeholder="例如：线性代数 · 特征值与对角化"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">描述（可选）</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="ai-input min-h-[120px] resize-y"
              placeholder="学习目标、已有基础、希望侧重概念还是习题…"
            />
          </label>
          {error ? (
            <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
          ) : null}
          <button type="submit" disabled={loading} className="ai-btn-primary w-full">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
                创建中…
              </span>
            ) : (
              "创建并进入主题"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
