"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TopicActions({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function ingest() {
    setLoading(true);
    setMsg(null);
    const res = await fetch(`/api/topics/${topicId}/ingest`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMsg(data.error ?? "触发失败");
      return;
    }
    setMsg(`已入队 ${data.enqueued} 个任务，请确保 Worker 与 Redis 已运行。`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => void ingest()}
        disabled={loading}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {loading ? "入队中…" : "开始采集 / 刷新"}
      </button>
      <a
        href={`/topics/${topicId}/today`}
        className="inline-flex items-center justify-center rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
      >
        今日 5 分钟
      </a>
      {msg ? <p className="text-sm text-slate-400">{msg}</p> : null}
    </div>
  );
}
