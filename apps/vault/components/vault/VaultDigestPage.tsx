"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Digest = {
  date: string;
  stats: { total: number; links: number; clips: number; notes: number };
  topOrigins: Array<{ name: string; count: number }>;
  topTags: Array<{ name: string; count: number }>;
  highlights: Array<{
    id: string;
    title: string;
    origin: string | null;
    kind: "link" | "clip" | "note";
    url: string | null;
    snippet: string;
    tags: string[];
  }>;
  suggestions: string[];
};

export function VaultDigestPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(d: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: d });
      const res = await fetch(`/api/vault/digest?${params.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const json = (await res.json()) as Digest;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(date);
  }, [date]);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ai-section-label">Daily Digest</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">每日学习 Digest</h1>
          <p className="mt-1 text-sm text-slate-500">把抓取和收藏内容转化为当日可学习摘要。</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="ai-input"
          />
          <button type="button" onClick={() => void load(date)} className="ai-btn-secondary px-3 py-2 text-sm">
            刷新
          </button>
        </div>
      </div>

      {loading ? <div className="ai-muted-panel px-4 py-8 text-sm text-slate-500">正在生成当日 Digest…</div> : null}
      {!loading && !data ? <div className="ai-muted-panel px-4 py-8 text-sm text-slate-500">暂无数据。</div> : null}

      {data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">总条目</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">{data.stats.total}</p>
            </div>
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">链接</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">{data.stats.links}</p>
            </div>
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">摘录</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">{data.stats.clips}</p>
            </div>
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">笔记</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">{data.stats.notes}</p>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="ai-card-strong p-4">
              <h2 className="text-sm font-semibold text-slate-100">高频主题词</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.topTags.map((t) => (
                  <span key={t.name} className="rounded-full border border-white/[0.1] px-2.5 py-1 text-xs text-slate-300">
                    {t.name} · {t.count}
                  </span>
                ))}
              </div>
            </div>
            <div className="ai-card-strong p-4">
              <h2 className="text-sm font-semibold text-slate-100">主要来源</h2>
              <ul className="mt-2 space-y-1.5">
                {data.topOrigins.map((o) => (
                  <li key={o.name} className="text-xs text-slate-400">
                    {o.name}：{o.count} 条
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="ai-card-strong p-4">
            <h2 className="text-sm font-semibold text-slate-100">今日精选</h2>
            <ul className="mt-3 space-y-2">
              {data.highlights.map((h) => (
                <li key={h.id} className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
                  <Link href={`/${h.id}`} className="text-sm font-medium text-slate-100 hover:text-cyan-200">
                    {h.title}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-2">{h.snippet}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="ai-card-strong p-4">
            <h2 className="text-sm font-semibold text-slate-100">学习建议</h2>
            <ul className="mt-2 space-y-1.5">
              {data.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-slate-400">
                  {i + 1}. {s}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
