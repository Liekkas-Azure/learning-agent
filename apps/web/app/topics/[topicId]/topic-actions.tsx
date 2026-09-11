"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TopicActions({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function smartCollect() {
    setLoading(true);
    setMsg(null);
    const d = await fetch(`/api/topics/${topicId}/discover`, { method: "POST" });
    const discovered = await d.json().catch(() => ({}));
    if (!d.ok) {
      setLoading(false);
      setMsg(discovered.error ?? "发现来源失败");
      return;
    }

    const res = await fetch(`/api/topics/${topicId}/ingest`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMsg(data.error ?? "入队失败");
      return;
    }

    const parts = [
      `发现 ${discovered.created ?? 0} 个新来源（候选 ${discovered.candidates ?? 0}）`,
      `已入队 ${data.enqueued ?? 0} 个任务`,
    ];
    if (discovered.hint) parts.push(discovered.hint);
    setMsg(parts.join(" · ") + "。请保持 Worker 与 Redis 运行。");
    router.refresh();
  }

  return (
    <div className="ai-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => void smartCollect()}
          disabled={loading}
          className="ai-btn-primary min-h-[44px] px-5"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
              编排中…
            </span>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                />
              </svg>
              智能采集资料
            </>
          )}
        </button>
        <a href={`/topics/${topicId}/today`} className="ai-btn-secondary min-h-[44px] justify-center sm:min-w-[140px]">
          今日学习
        </a>
      </div>
      {msg ? (
        <p className="mt-4 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-sm leading-relaxed text-slate-400">
          {msg}
        </p>
      ) : (
        <p className="mt-4 text-xs leading-relaxed text-slate-600">
          自动写入来源并入队抓取；完成后在「资料库」与「今日」中查看。
        </p>
      )}
    </div>
  );
}
