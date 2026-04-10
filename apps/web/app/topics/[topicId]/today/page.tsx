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

export default function TodayPage() {
  const params = useParams();
  const topicId = String(params.topicId ?? "");
  const [cards, setCards] = useState<{ id: string; payload: CardPayload }[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/topics/${topicId}/today`);
    const data = await res.json();
    setCards(data.cards ?? []);
    setIdx(0);
    setLoading(false);
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = cards[idx];
  const payload = current?.payload;

  async function markSeen() {
    const id = payload?.id;
    if (!id) return;
    await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, cardId: id }),
    });
    if (idx + 1 < cards.length) setIdx(idx + 1);
    else void load();
  }

  if (loading) {
    return <p className="text-slate-400">加载中…</p>;
  }

  if (!current) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-slate-400">暂无卡片。请先为主题添加来源并触发采集。</p>
        <Link href={`/topics/${topicId}`} className="text-sky-400 underline">
          返回主题
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href={`/topics/${topicId}`} className="text-sm text-sky-400 hover:underline">
          ← 主题
        </Link>
        <span className="text-xs text-slate-500">
          {idx + 1} / {cards.length}
        </span>
      </div>

      <article className="min-h-[50vh] rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-xl">
        <p className="text-xs uppercase tracking-widest text-sky-500/90">
          {payload?.multimodal?.type === "text" ? "文本要点" : "学习卡片"}
        </p>
        <h1 className="mt-2 text-xl font-semibold text-white">{payload?.title ?? "要点"}</h1>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
          {payload?.body}
        </p>
        {payload?.url ? (
          <a
            href={payload.url}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-block text-sm text-sky-400 hover:underline"
          >
            查看原文
          </a>
        ) : null}
      </article>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void markSeen()}
          className="flex-1 rounded-xl bg-sky-500 py-3 text-sm font-medium text-slate-950 hover:bg-sky-400"
        >
          下一张
        </button>
        <button
          type="button"
          onClick={() => setIdx(Math.min(cards.length - 1, idx + 1))}
          className="rounded-xl border border-slate-600 px-4 text-sm text-slate-300 hover:bg-slate-800"
        >
          跳过
        </button>
      </div>

      <p className="text-center text-xs text-slate-600">
        安装为 PWA 后可在手机主屏幕离线复习已缓存页面。
      </p>
    </div>
  );
}
