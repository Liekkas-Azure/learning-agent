import type { HkCandle } from "./eastmoney";
import { rsiAt, smaAt } from "./indicators";

export type HkDailySnapshot = {
  sma20: number | null;
  sma60: number | null;
  rsi14: number | null;
  /** 相对 SMA20 偏离，% */
  distSma20Pct: number | null;
  return5dPct: number | null;
  return20dPct: number | null;
  return60dPct: number | null;
  /** 近 20 个交易日对数收益年化波动率估计，% */
  volatility20dAnnPct: number | null;
  /** 近至多 120 根日线收盘价最大回撤，%（非正） */
  maxDrawdown120Pct: number | null;
};

export type HkIntraday5mSnapshot = {
  closes: number[];
  times: string[];
  /** 窗口内首根至末根收盘涨跌幅，% */
  windowChangePct: number | null;
};

export type HkDashboardSnapshot = {
  daily: HkDailySnapshot;
  intraday5m: HkIntraday5mSnapshot | null;
};

function stdevSample(xs: number[]): number | undefined {
  if (xs.length < 2) return undefined;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

function pctReturn(closes: number[], lastI: number, days: number): number | null {
  if (lastI < days) return null;
  const prev = closes[lastI - days];
  const last = closes[lastI];
  if (prev === undefined || last === undefined || prev === 0) return null;
  return (last / prev - 1) * 100;
}

function maxDrawdownPct(closes: number[], lookback: number): number | null {
  if (closes.length < 2) return null;
  const n = closes.length;
  const from = Math.max(0, n - lookback);
  let peak = closes[from] ?? 0;
  if (peak <= 0) return null;
  let mdd = 0;
  for (let i = from; i < n; i++) {
    const c = closes[i]!;
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = (c - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd * 100;
}

/**
 * 基于日线收盘 + 可选 5 分钟 K，生成看板「研究向」快照（教学口径，非券商实时指标）。
 */
export function computeDashboardSnapshot(
  daily: HkCandle[],
  intraday5m: HkCandle[],
): HkDashboardSnapshot | null {
  const closes = daily.map((c) => c.close).filter((x) => Number.isFinite(x));
  const n = closes.length;
  if (n < 5) return null;
  const lastI = n - 1;
  const last = closes[lastI]!;

  const sma20v = smaAt(closes, 20, lastI);
  const sma60v = smaAt(closes, 60, lastI);
  const rsi14v = rsiAt(closes, 14, lastI);

  const distSma20Pct =
    sma20v !== undefined && sma20v !== 0 ? ((last - sma20v) / sma20v) * 100 : null;

  const logRets: number[] = [];
  const start = Math.max(1, n - 21);
  for (let i = start; i < n; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && b > 0) logRets.push(Math.log(b / a));
  }
  const sd = stdevSample(logRets);
  const volatility20dAnnPct =
    sd !== undefined && Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;

  let intraday: HkIntraday5mSnapshot | null = null;
  if (intraday5m.length >= 2) {
    const ic = intraday5m.map((b) => b.close);
    const times = intraday5m.map((b) => b.date);
    const w0 = intraday5m[0]!.close;
    const w1 = intraday5m[intraday5m.length - 1]!.close;
    const windowChangePct = w0 !== 0 ? (w1 / w0 - 1) * 100 : null;
    intraday = { closes: ic, times, windowChangePct };
  }

  return {
    daily: {
      sma20: sma20v ?? null,
      sma60: sma60v ?? null,
      rsi14: rsi14v ?? null,
      distSma20Pct,
      return5dPct: pctReturn(closes, lastI, 5),
      return20dPct: pctReturn(closes, lastI, 20),
      return60dPct: pctReturn(closes, lastI, 60),
      volatility20dAnnPct,
      maxDrawdown120Pct: maxDrawdownPct(closes, 120),
    },
    intraday5m: intraday,
  };
}
