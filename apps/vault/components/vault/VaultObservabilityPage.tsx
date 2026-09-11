"use client";

import { useEffect, useState } from "react";
import { useCallback } from "react";

type Obs = {
  windowHours: number;
  total: number;
  okCount: number;
  errorCount: number;
  successRate: number;
  byModule: Array<{
    name: string;
    total: number;
    ok: number;
    successRate: number;
    avgLatencyMs: number;
    avgTokens: number;
  }>;
  errorTop: Array<{ reason: string; count: number }>;
};

export function VaultObservabilityPage() {
  const [hours, setHours] = useState("24");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Obs | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ hours });
      const res = await fetch(`/api/vault/doubao-observability?${params.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const json = (await res.json()) as Obs;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ai-section-label">LLM Observability</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">豆包调用可观测面板</h1>
        </div>
        <div className="flex items-center gap-2">
          <select value={hours} onChange={(e) => setHours(e.target.value)} className="ai-select">
            <option value="6">近 6 小时</option>
            <option value="24">近 24 小时</option>
            <option value="72">近 72 小时</option>
            <option value="168">近 7 天</option>
          </select>
          <button type="button" onClick={() => void load()} className="ai-btn-secondary px-3 py-2 text-sm">
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </div>

      {!data && !loading ? <div className="ai-muted-panel px-4 py-8 text-sm text-slate-500">暂无观测数据。</div> : null}
      {data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">总调用</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">{data.total}</p>
            </div>
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">成功</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">{data.okCount}</p>
            </div>
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">失败</p>
              <p className="mt-1 text-xl font-semibold text-rose-300">{data.errorCount}</p>
            </div>
            <div className="ai-metric-tile">
              <p className="text-xs text-slate-500">成功率</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">{(data.successRate * 100).toFixed(1)}%</p>
            </div>
          </section>

          <section className="ai-card-strong p-4">
            <h2 className="text-sm font-semibold text-slate-100">模块维度</h2>
            <div className="ai-table-shell mt-3">
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>模块</th>
                    <th>调用</th>
                    <th>成功率</th>
                    <th>平均耗时(ms)</th>
                    <th>平均Token</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModule.map((m) => (
                    <tr key={m.name}>
                      <td>{m.name}</td>
                      <td>{m.total}</td>
                      <td>{(m.successRate * 100).toFixed(1)}%</td>
                      <td>{m.avgLatencyMs.toFixed(0)}</td>
                      <td>{m.avgTokens.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ai-card-strong p-4">
            <h2 className="text-sm font-semibold text-slate-100">失败原因 Top</h2>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-400">
              {data.errorTop.map((e) => (
                <li key={e.reason}>
                  {e.reason}：{e.count}
                </li>
              ))}
              {data.errorTop.length === 0 ? <li>暂无失败。</li> : null}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
