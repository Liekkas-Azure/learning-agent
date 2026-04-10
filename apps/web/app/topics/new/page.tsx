"use client";

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
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">新建学习主题</h1>
        <p className="mt-1 text-sm text-slate-400">例如：「线性代数」「Rust 异步」等。</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-slate-300">标题</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none ring-sky-500/40 focus:ring-2"
            placeholder="主题名称"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-slate-300">描述（可选）</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none ring-sky-500/40 focus:ring-2"
            placeholder="学习目标、范围、已有基础等"
          />
        </label>
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
        >
          {loading ? "创建中…" : "创建"}
        </button>
      </form>
    </div>
  );
}
