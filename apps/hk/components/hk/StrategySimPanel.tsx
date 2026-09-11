"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/hk/format";
import { IntradayCloseMarkersChart } from "./IntradayCloseMarkersChart";

type StrategyMeta = {
  id: string;
  name: string;
  summary: string;
  minWarmupBars: number;
};

type SimBarPoint = {
  time: string;
  close: number;
  signal: -1 | 0 | 1;
  equity: number;
  positionShares: number;
};

type SimTrade = {
  barTime: string;
  side: "buy" | "sell";
  price: number;
  shares: number;
  cashAfter: number;
  note: string;
};

type SimBlock = {
  strategyId: string;
  windowBars: number;
  initialCash: number;
  feeBps: number;
  points: SimBarPoint[];
  trades: SimTrade[];
  finalEquity: number;
  totalReturnPct: number;
  winBars: number;
};

type ResultRow = {
  symbol: string;
  secid: string;
  lookbackBars: number;
  barsSample: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  sim: SimBlock;
  error?: string;
  message?: string;
};

type SimPayload = {
  strategies: StrategyMeta[];
  interval: string;
  lookbackRequested?: number;
  windowBars: number;
  strategyId: string;
  strategyName: string;
  strategySummary: string;
  portfolioAvgReturnPct?: number;
  symbolCount?: number;
  results: ResultRow[];
  symbol?: string;
  secid?: string;
  lookbackBars?: number;
  barsSample?: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  sim?: SimBlock;
  disclaimer: string;
};

type CompareTrade = {
  barTime: string;
  side: "buy" | "sell";
  price: number;
  shares: number;
  cashAfter: number;
  note: string;
};

type CompareRow = {
  strategyId: string;
  strategyName: string;
  strategySummary: string;
  skipped?: boolean;
  skipReason?: string;
  totalReturnPct: number;
  finalEquity: number;
  trades: CompareTrade[];
};

type ComparePayload = {
  refreshedAt: string;
  symbol: string;
  interval: string;
  windowBars: number;
  lookbackBars: number;
  barsForChart: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  comparisons: CompareRow[];
  disclaimer: string;
};

const POLL_MS = 30_000;

function signalLabel(s: -1 | 0 | 1) {
  if (s === 1) return { text: "买入信号", cls: "text-emerald-300" };
  if (s === -1) return { text: "卖出信号", cls: "text-rose-300" };
  return { text: "持有", cls: "text-neutral-500" };
}

function EquitySparkline({ points }: { points: { equity: number }[] }) {
  if (points.length < 2) return null;
  const eq = points.map((p) => p.equity);
  const min = Math.min(...eq);
  const max = Math.max(...eq);
  const span = max - min || 1;
  const w = 280;
  const h = 64;
  const pad = 4;
  const d = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p.equity - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full max-w-xs" aria-hidden>
      <path d={d} fill="none" className="stroke-sky-400" strokeWidth="2" />
    </svg>
  );
}

function uniqueSymbols(primary: string, extraRaw: string, max: number): string[] {
  const parts = [primary.trim(), ...extraRaw.split(/[,，\s]+/).map((s) => s.trim())].filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.padStart(5, "0");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

type Props = { symbol: string; /** 嵌入 Tab 等容器时去掉外层卡片，避免双边框 */ embedded?: boolean };

export function StrategySimPanel({ symbol, embedded }: Props) {
  const [strategyId, setStrategyId] = useState("sma_cross_5_20");
  const [interval, setInterval] = useState<"1m" | "5m" | "15m">("5m");
  const [windowBars, setWindowBars] = useState<1 | 5 | 15>(5);
  const [extraSymbols, setExtraSymbols] = useState("");
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [payload, setPayload] = useState<SimPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [comparePayload, setComparePayload] = useState<ComparePayload | null>(null);
  const [compareErr, setCompareErr] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [selectedCompareStrategyId, setSelectedCompareStrategyId] = useState<string | null>(null);
  const [realtimeCompare, setRealtimeCompare] = useState(true);

  const load = useCallback(async () => {
    if (!symbol?.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const list = uniqueSymbols(symbol, extraSymbols, 5);
      const symbolsQs = list.join(",");
      const params = new URLSearchParams({
        symbol: list[0] ?? symbol.trim(),
        symbols: symbolsQs,
        strategy: strategyId,
        window: String(windowBars),
        interval,
        lookback: interval === "1m" ? "320" : interval === "5m" ? "240" : "180",
      });
      const res = await fetch(`/api/hk-strategy-sim?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as SimPayload & {
        error?: string;
        message?: string;
        strategies?: StrategyMeta[];
      };
      if (json.strategies?.length) setStrategies(json.strategies);
      if (!res.ok) {
        setPayload(null);
        setErr(json.message ?? json.error ?? "加载失败");
        return;
      }
      setPayload(json as SimPayload);
    } catch {
      setPayload(null);
      setErr("网络异常");
    } finally {
      setLoading(false);
    }
  }, [symbol, strategyId, interval, windowBars, extraSymbols]);

  const loadCompare = useCallback(async () => {
    if (!symbol?.trim()) return;
    setCompareLoading(true);
    setCompareErr(null);
    try {
      const lb = interval === "1m" ? "320" : interval === "5m" ? "240" : "180";
      const params = new URLSearchParams({
        symbol: symbol.trim(),
        interval,
        window: String(windowBars),
        lookback: lb,
      });
      const res = await fetch(`/api/hk-strategy-sim-compare?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ComparePayload & { error?: string; message?: string };
      if (!res.ok) {
        setComparePayload(null);
        setCompareErr(json.message ?? json.error ?? "对比加载失败");
        return;
      }
      setComparePayload(json);
    } catch {
      setComparePayload(null);
      setCompareErr("网络异常");
    } finally {
      setCompareLoading(false);
    }
  }, [symbol, interval, windowBars]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCompare();
  }, [loadCompare]);

  useEffect(() => {
    if (!realtimeCompare || !symbol?.trim()) return;
    const id = window.setInterval(() => void loadCompare(), POLL_MS);
    return () => window.clearInterval(id);
  }, [realtimeCompare, symbol, loadCompare]);

  useEffect(() => {
    if (!comparePayload?.comparisons?.length) return;
    const playable = comparePayload.comparisons.filter((c) => !c.skipped);
    if (!playable.length) return;
    setSelectedCompareStrategyId((prev) => {
      if (prev && playable.some((c) => c.strategyId === prev)) return prev;
      return playable[0]!.strategyId;
    });
  }, [comparePayload]);

  const stratOptions = useMemo(() => {
    if (strategies.length) return strategies;
    return [
      { id: "sma_cross_5_20", name: "双均线（5/20）", summary: "", minWarmupBars: 22 },
      { id: "rsi_6_reversion", name: "RSI(6) 反转", summary: "", minWarmupBars: 12 },
      { id: "roc_10_momentum", name: "ROC 动量", summary: "", minWarmupBars: 14 },
      { id: "donchian_15_break", name: "唐奇安突破", summary: "", minWarmupBars: 18 },
      { id: "bollinger_20_2_mean_revert", name: "布林带均值回归", summary: "", minWarmupBars: 24 },
      { id: "dual_ma_atr_trail", name: "双均线 + ATR 止损", summary: "", minWarmupBars: 36 },
    ];
  }, [strategies]);

  const intervalLabel = payload?.interval === "5m" ? "5" : payload?.interval === "15m" ? "15" : "1";
  const results = payload?.results?.length ? payload.results : [];

  const selectedCompare = comparePayload?.comparisons.find(
    (c) => c.strategyId === selectedCompareStrategyId,
  );

  return (
    <div
      className={embedded ? "space-y-6" : "ai-card p-5 sm:p-6"}
    >
      <h2 className="text-lg font-semibold text-slate-50">量化策略 · 近窗模拟</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        默认 5 分钟 K、最近 5 根为回测窗口；支持 1 / 15 分钟与多标的独立回测。下方「全策略对比」每{" "}
        {POLL_MS / 1000} 秒自动刷新行情并重算（可关闭）；单策略区用于细调参数。
      </p>

      <div className="mt-5 rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.08] to-violet-500/[0.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-cyan-100">全策略实时对比（同一批 K 线）</h3>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={realtimeCompare}
              onChange={(e) => setRealtimeCompare(e.target.checked)}
              className="ai-checkbox accent-cyan-500"
            />
            每 {POLL_MS / 1000}s 自动刷新
          </label>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          使用当前「K 线周期」与「回测窗口根数」拉取数据；按策略分别在最近窗口内回测，表格为窗口收益率排序。选中策略后查看收盘价走势上的买点 / 卖点。
        </p>
        {compareErr ? (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {compareErr}
          </div>
        ) : null}
        {comparePayload ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
              <span>
                上次刷新：{new Date(comparePayload.refreshedAt).toLocaleString("zh-Hans-CN")}
              </span>
              <span>
                已加载 {comparePayload.lookbackBars} 根 {comparePayload.interval} K · 窗口{" "}
                {comparePayload.windowBars} 根
              </span>
              {compareLoading ? <span className="text-sky-300">更新中…</span> : null}
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="border-b border-white/10 bg-black/30 text-neutral-500">
                  <tr>
                    <th className="px-3 py-2">策略</th>
                    <th className="px-3 py-2">窗口收益</th>
                    <th className="px-3 py-2">期末权益</th>
                    <th className="px-3 py-2">成交</th>
                    <th className="px-3 py-2">查看买卖点</th>
                  </tr>
                </thead>
                <tbody>
                  {comparePayload.comparisons.map((c) => (
                    <tr
                      key={c.strategyId}
                      className={`border-b border-white/5 ${
                        selectedCompareStrategyId === c.strategyId ? "bg-white/[0.06]" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-neutral-200">{c.strategyName}</td>
                      <td
                        className={`px-3 py-2 font-medium ${
                          c.skipped
                            ? "text-neutral-500"
                            : c.totalReturnPct >= 0
                              ? "text-emerald-300"
                              : "text-rose-300"
                        }`}
                      >
                        {c.skipped ? (
                          c.skipReason ?? "—"
                        ) : (
                          <>
                            {c.totalReturnPct >= 0 ? "+" : ""}
                            {formatNumber(c.totalReturnPct, 4)}%
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">
                        {c.skipped ? "—" : `${formatNumber(c.finalEquity, 0)} 元`}
                      </td>
                      <td className="px-3 py-2 text-neutral-400">
                        {c.skipped ? "—" : `${c.trades.length} 笔`}
                      </td>
                      <td className="px-3 py-2">
                        {!c.skipped ? (
                          <button
                            type="button"
                            onClick={() => setSelectedCompareStrategyId(c.strategyId)}
                            className="text-sky-300 underline decoration-sky-500/40 hover:text-sky-200"
                          >
                            选中
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedCompare && !selectedCompare.skipped ? (
              <div className="space-y-2">
                <p className="text-xs text-neutral-400">{selectedCompare.strategySummary}</p>
                <IntradayCloseMarkersChart
                  bars={comparePayload.barsForChart}
                  trades={selectedCompare.trades}
                  title={`${comparePayload.symbol} · ${selectedCompare.strategyName} · 收盘走势与成交点（▲ 买 ▼ 卖）`}
                />
                {selectedCompare.trades.length ? (
                  <ul className="grid gap-1 text-[11px] text-neutral-400 sm:grid-cols-2">
                    {selectedCompare.trades.map((t, i) => (
                      <li key={`${t.barTime}-${i}`} className="font-mono">
                        <span className={t.side === "buy" ? "text-emerald-400" : "text-rose-400"}>
                          {t.side === "buy" ? "买" : "卖"}
                        </span>{" "}
                        {t.barTime} @ {formatNumber(t.price, 3)} × {t.shares} 股
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-neutral-500">该窗口内无成交，仅显示价格走势。</p>
                )}
              </div>
            ) : null}
          </div>
        ) : !compareErr ? (
          <p className="mt-3 text-xs text-neutral-500">{compareLoading ? "加载对比…" : null}</p>
        ) : null}
        <button
          type="button"
          onClick={() => void loadCompare()}
          disabled={compareLoading}
          className="ai-btn-secondary mt-3 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          立即刷新对比
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium text-slate-500">K 线周期</span>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as "1m" | "5m" | "15m")}
            className="ai-select text-sm text-slate-100"
          >
            <option value="1m">1 分钟</option>
            <option value="5m">5 分钟</option>
            <option value="15m">15 分钟</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium text-slate-500">回测窗口（根数）</span>
          <select
            value={windowBars}
            onChange={(e) => setWindowBars(Number(e.target.value) as 1 | 5 | 15)}
            className="ai-select text-sm text-slate-100"
          >
            <option value={1}>1 根</option>
            <option value={5}>5 根</option>
            <option value={15}>15 根</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm lg:col-span-2">
          <span className="text-xs font-medium text-slate-500">策略</span>
          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className="ai-select text-sm text-slate-100"
          >
            {stratOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1.5 text-sm">
        <span className="text-xs font-medium text-slate-500">多标的（逗号分隔，最多 5 只含主代码）</span>
        <input
          type="text"
          value={extraSymbols}
          onChange={(e) => setExtraSymbols(e.target.value)}
          placeholder="例如：00941,01810（主代码已含）"
          className="ai-input text-sm"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ai-btn-primary text-sm disabled:opacity-50"
        >
          {loading ? "计算中…" : "重新模拟"}
        </button>
      </div>

      {payload?.strategySummary ? (
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">{payload.strategySummary}</p>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {err}
        </div>
      ) : null}

      {payload && results.length > 0 ? (
        <div className="mt-5 space-y-6">
          {results.length > 1 && payload.portfolioAvgReturnPct !== undefined ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
              <div className="text-neutral-500">多标的组合（各标的独立回测，收益率算术平均）</div>
              <div
                className={
                  payload.portfolioAvgReturnPct >= 0
                    ? "mt-1 text-lg font-semibold text-emerald-300"
                    : "mt-1 text-lg font-semibold text-rose-300"
                }
              >
                {payload.portfolioAvgReturnPct >= 0 ? "+" : ""}
                {formatNumber(payload.portfolioAvgReturnPct, 4)}%
              </div>
            </div>
          ) : null}

          {results.map((row) => (
            <div key={row.symbol} className="space-y-4 border-b border-white/5 pb-6 last:border-0 last:pb-0">
              <h3 className="text-sm font-medium text-sky-200/90">{row.symbol}</h3>
              {row.error ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                  {row.message ?? row.error}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div>
                      <div className="text-neutral-500">窗口收益</div>
                      <div
                        className={
                          row.sim.totalReturnPct >= 0
                            ? "text-lg font-semibold text-emerald-300"
                            : "text-lg font-semibold text-rose-300"
                        }
                      >
                        {row.sim.totalReturnPct >= 0 ? "+" : ""}
                        {formatNumber(row.sim.totalReturnPct, 4)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-neutral-500">期末权益（示意）</div>
                      <div className="text-lg font-semibold text-neutral-100">
                        {formatNumber(row.sim.finalEquity, 2)} 元
                      </div>
                    </div>
                    <div>
                      <div className="text-neutral-500">初始资金</div>
                      <div className="text-lg font-semibold text-neutral-200">
                        {formatNumber(row.sim.initialCash, 0)} 元
                      </div>
                    </div>
                    <div>
                      <div className="text-neutral-500">窗口内权益上升根数</div>
                      <div className="text-lg font-semibold text-neutral-200">
                        {row.sim.winBars}/{Math.max(1, row.sim.points.length - 1)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs text-neutral-500">窗口内权益曲线</div>
                    <EquitySparkline points={row.sim.points} />
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-medium text-neutral-200">
                      最近 {row.sim.windowBars} 根 {intervalLabel} 分钟 K 与信号
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-white/10">
                      <table className="w-full min-w-[520px] text-left text-xs">
                        <thead className="border-b border-white/10 bg-white/[0.04] text-neutral-500">
                          <tr>
                            <th className="px-3 py-2">时间</th>
                            <th className="px-3 py-2">收盘</th>
                            <th className="px-3 py-2">信号</th>
                            <th className="px-3 py-2">持仓股数</th>
                            <th className="px-3 py-2">权益</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.sim.points.map((p) => {
                            const sl = signalLabel(p.signal);
                            return (
                              <tr key={`${row.symbol}-${p.time}`} className="border-b border-white/5">
                                <td className="px-3 py-2 font-mono text-neutral-300">{p.time}</td>
                                <td className="px-3 py-2">{formatNumber(p.close, 3)}</td>
                                <td className={`px-3 py-2 ${sl.cls}`}>{sl.text}</td>
                                <td className="px-3 py-2 text-neutral-400">{p.positionShares}</td>
                                <td className="px-3 py-2 text-neutral-200">{formatNumber(p.equity, 2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {row.sim.trades.length ? (
                    <div>
                      <h4 className="mb-2 text-sm font-medium text-neutral-200">窗口内成交</h4>
                      <ul className="space-y-2 text-xs text-neutral-300">
                        {row.sim.trades.map((t, idx) => (
                          <li
                            key={`${row.symbol}-${t.barTime}-${idx}`}
                            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                          >
                            <span className={t.side === "buy" ? "text-emerald-300" : "text-rose-300"}>
                              {t.side === "buy" ? "买" : "卖"}
                            </span>
                            <span className="mx-2 text-neutral-500">{t.barTime}</span>
                            <span>{formatNumber(t.price, 3)}</span>
                            <span className="mx-2 text-neutral-500">{t.shares} 股</span>
                            <span className="text-neutral-500">{t.note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">本窗口内未触发买卖（或仅单边信号）。</p>
                  )}
                </>
              )}
            </div>
          ))}

          <p className="text-[11px] leading-relaxed text-neutral-600">{payload.disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}
