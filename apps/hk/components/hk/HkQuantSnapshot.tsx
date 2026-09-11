"use client";

import type { HkDashboardSnapshot } from "@/lib/hk/dashboardSnapshot";
import { formatNumber } from "@/lib/hk/format";
import { IntradaySparkline } from "./IntradaySparkline";

type Props = {
  snapshot: HkDashboardSnapshot;
  symbol: string;
};

function cell(label: string, value: string, hint?: string, valueClass?: string) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:border-cyan-400/15">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass ?? "text-slate-50"}`}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[10px] leading-snug text-slate-600">{hint}</div> : null}
    </div>
  );
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = formatNumber(n, digits);
  return `${n > 0 ? "+" : ""}${s}%`;
}

export function HkQuantSnapshot({ snapshot, symbol }: Props) {
  const d = snapshot.daily;
  const intra = snapshot.intraday5m;

  return (
    <div className="ai-card rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-4">
        <div>
          <p className="ai-section-label">Research snapshot</p>
          <h2 className="mt-1 text-base font-semibold text-slate-100">研究快照 · {symbol}</h2>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
            趋势 / 摆动 / 波动与日内形态并列（日线收盘 + 5 分钟示意）。
          </p>
        </div>
        {intra?.closes.length ? (
          <div className="flex items-center gap-3">
            <div className="text-right text-[11px] text-slate-500">
              近 {intra.closes.length} 根 5 分钟收盘
              {intra.windowChangePct !== null ? (
                <span
                  className={
                    intra.windowChangePct >= 0 ? "ml-1 font-medium text-emerald-400" : "ml-1 font-medium text-rose-400"
                  }
                >
                  {fmtPct(intra.windowChangePct)}
                </span>
              ) : null}
            </div>
            <IntradaySparkline closes={intra.closes} />
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {cell("RSI(14)", d.rsi14 !== null ? formatNumber(d.rsi14, 1) : "—", "摆动强弱，非买卖信号")}
        {cell("SMA20", d.sma20 !== null ? formatNumber(d.sma20, 3) : "—", "日线均线")}
        {cell("SMA60", d.sma60 !== null ? formatNumber(d.sma60, 3) : "—", "中期趋势参考")}
        {cell(
          "偏离 SMA20",
          fmtPct(d.distSma20Pct, 2),
          "收盘相对均线位置",
          d.distSma20Pct === null
            ? undefined
            : d.distSma20Pct >= 0
              ? "text-emerald-300"
              : "text-rose-300",
        )}
        {cell(
          "5 日涨跌",
          fmtPct(d.return5dPct),
          undefined,
          d.return5dPct === null
            ? undefined
            : d.return5dPct >= 0
              ? "text-emerald-300"
              : "text-rose-300",
        )}
        {cell(
          "20 日涨跌",
          fmtPct(d.return20dPct),
          undefined,
          d.return20dPct === null
            ? undefined
            : d.return20dPct >= 0
              ? "text-emerald-300"
              : "text-rose-300",
        )}
        {cell(
          "60 日涨跌",
          fmtPct(d.return60dPct),
          undefined,
          d.return60dPct === null
            ? undefined
            : d.return60dPct >= 0
              ? "text-emerald-300"
              : "text-rose-300",
        )}
        {cell(
          "20 日年化波动",
          d.volatility20dAnnPct !== null ? `${formatNumber(d.volatility20dAnnPct, 2)}%` : "—",
          "对数收益标准差×√252",
        )}
        {cell(
          "120 日最大回撤",
          d.maxDrawdown120Pct !== null ? `${formatNumber(d.maxDrawdown120Pct, 2)}%` : "—",
          "基于日线收盘",
          "text-amber-200/90",
        )}
      </div>
    </div>
  );
}
