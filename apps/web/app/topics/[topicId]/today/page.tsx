"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type CardPayload = {
  id?: string;
  title?: string;
  body?: string;
  url?: string;
  multimodal?: { type: string };
};

type TodayCard = { id: string; progressId: string; payload: CardPayload };

export default function TodayPage() {
  const params = useParams();
  const topicId = String(params.topicId ?? "");
  const [cards, setCards] = useState<TodayCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/topics/${topicId}/today`);
    const data = await res.json();
    const raw = (data.cards ?? []) as {
      id: string;
      progressId?: string;
      payload?: CardPayload;
    }[];
    setCards(
      raw.map((c) => ({
        id: c.id,
        progressId: c.progressId ?? c.payload?.id ?? c.id,
        payload: c.payload ?? {},
      })),
    );
    setIdx(0);
    setLoading(false);
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = cards[idx];
  const payload = current?.payload;

  async function markSeen() {
    const cardId = current?.progressId;
    if (!cardId) return;
    await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, cardId }),
    });
    if (idx + 1 < cards.length) setIdx(idx + 1);
    else void load();
  }

  if (loading) {
    return (
      <div className="space-y-6 py-8">
        <div className="h-4 w-32 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="ai-shimmer-border min-h-[50vh]">
          <div className="ai-shimmer-inner flex min-h-[50vh] flex-col justify-center gap-4 p-8">
            <div className="h-3 w-24 animate-pulse rounded bg-white/[0.08]" />
            <div className="h-8 w-3/4 max-w-md animate-pulse rounded-lg bg-white/[0.06]" />
            <div className="space-y-2 pt-4">
              <div className="h-3 w-full animate-pulse rounded bg-white/[0.05]" />
              <div className="h-3 w-full animate-pulse rounded bg-white/[0.05]" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.05]" />
            </div>
          </div>
        </div>
        <p className="text-center font-mono text-xs text-slate-600">loading_cards…</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="ai-card mx-auto max-w-md space-y-6 px-6 py-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl text-slate-500">
          ◇
        </div>
        <div>
          <p className="text-sm font-medium text-slate-300">暂无学习卡片</p>
          <p className="mt-2 text-sm text-slate-500">请先完成「智能采集」并等待 Worker 处理。</p>
        </div>
        <Link href={`/topics/${topicId}`} className="ai-btn-secondary inline-flex w-full justify-center">
          返回主题
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <Link href={`/topics/${topicId}`} className="text-sm font-medium text-slate-500 transition hover:text-cyan-300/90">
          ← 主题
        </Link>
        <span className="rounded-full border border-white/[0.1] bg-black/30 px-3 py-1 font-mono text-[11px] text-slate-500">
          {idx + 1} / {cards.length}
        </span>
      </div>

      <div className="ai-shimmer-border">
        <article
          role="button"
          tabIndex={0}
          onClick={() => void markSeen()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void markSeen();
            }
          }}
          className="ai-shimmer-inner min-h-[48vh] cursor-pointer p-6 transition hover:bg-[#0a101c]/95 sm:p-8"
          aria-label="点击卡片进入下一张"
        >
          <div className="flex items-center gap-2">
            <span className="ai-badge ai-badge-accent">
              {payload?.multimodal?.type === "text" ? "TEXT" : "CARD"}
            </span>
            <span className="ai-divider flex-1 opacity-50" />
            <span className="hidden text-[10px] text-slate-600 sm:inline">点击任意处继续</span>
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {payload?.title ?? "要点"}
          </h1>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-[1.75] text-slate-400">{payload?.body}</p>
          {payload?.url ? (
            <a
              href={payload.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-cyan-300/95 transition hover:text-cyan-200"
            >
              查看原文
              <span aria-hidden>↗</span>
            </a>
          ) : null}
        </article>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={() => void markSeen()} className="ai-btn-primary min-h-[48px] flex-1">
          下一张
        </button>
        <button
          type="button"
          onClick={() => setIdx(Math.min(cards.length - 1, idx + 1))}
          className="ai-btn-secondary min-h-[48px] px-5"
        >
          跳过
        </button>
      </div>

      <p className="text-center font-mono text-[10px] leading-relaxed text-slate-600">
        PWA 安装后可离线打开已缓存页面 · 适合碎片时间
      </p>
    </div>
  );
}
