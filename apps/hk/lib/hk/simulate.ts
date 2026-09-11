import type { HkCandle } from "./eastmoney";
import { atrSimple } from "./indicators";
import type { StrategyFn, StrategySignal } from "./strategies";
import { computeDualMaSignal } from "./strategies";

export type SimTrade = {
  barTime: string;
  side: "buy" | "sell";
  price: number;
  shares: number;
  cashAfter: number;
  note: string;
};

export type SimBarPoint = {
  time: string;
  close: number;
  signal: -1 | 0 | 1;
  equity: number;
  positionShares: number;
};

export type WindowSimResult = {
  strategyId: string;
  windowBars: number;
  initialCash: number;
  feeBps: number;
  /** 窗口内每根 K 的权益与信号 */
  points: SimBarPoint[];
  trades: SimTrade[];
  finalEquity: number;
  totalReturnPct: number;
  winBars: number;
};

/**
 * 在最近 `windowBars` 根 K 上按收盘价撮合、单向做多、整手股数；
 * 信号函数可读取 bars[0..i] 全历史。
 */
export function simulateLastWindow(
  bars: HkCandle[],
  windowBars: number,
  strategyId: string,
  signalFn: StrategyFn,
  opts?: { initialCash?: number; feeBps?: number },
): WindowSimResult {
  const initialCash = opts?.initialCash ?? 1_000_000;
  const feeBps = opts?.feeBps ?? 5;
  const fee = feeBps / 10_000;

  if (bars.length === 0 || windowBars < 1) {
    return {
      strategyId,
      windowBars,
      initialCash,
      feeBps,
      points: [],
      trades: [],
      finalEquity: initialCash,
      totalReturnPct: 0,
      winBars: 0,
    };
  }

  const start = Math.max(0, bars.length - windowBars);
  let cash = initialCash;
  let shares = 0;
  const points: SimBarPoint[] = [];
  const trades: SimTrade[] = [];

  for (let i = start; i < bars.length; i++) {
    const bar = bars[i];
    const px = bar.close;
    const sig = signalFn(bars, i);

    if (sig === 1 && shares === 0) {
      const maxSpend = cash * (1 - fee);
      const q = Math.floor(maxSpend / px);
      if (q > 0) {
        const cost = q * px * (1 + fee);
        cash -= cost;
        shares = q;
        trades.push({
          barTime: bar.date,
          side: "buy",
          price: px,
          shares: q,
          cashAfter: cash + shares * px,
          note: `市价买入 ${q} 股（含手续费约 ${(fee * q * px).toFixed(2)}）`,
        });
      }
    } else if (sig === -1 && shares > 0) {
      const gross = shares * px;
      const net = gross * (1 - fee);
      cash += net;
      trades.push({
        barTime: bar.date,
        side: "sell",
        price: px,
        shares,
        cashAfter: cash,
        note: `平仓 ${shares} 股（含手续费约 ${(fee * gross).toFixed(2)}）`,
      });
      shares = 0;
    }

    const equity = cash + shares * px;
    points.push({
      time: bar.date,
      close: px,
      signal: sig,
      equity,
      positionShares: shares,
    });
  }

  const lastEq = points.length ? points[points.length - 1].equity : initialCash;
  const totalReturnPct = ((lastEq - initialCash) / initialCash) * 100;
  let winBars = 0;
  for (let j = 1; j < points.length; j++) {
    if (points[j].equity > points[j - 1].equity) winBars += 1;
  }

  return {
    strategyId,
    windowBars,
    initialCash,
    feeBps,
    points,
    trades,
    finalEquity: lastEq,
    totalReturnPct,
    winBars,
  };
}

export type DualMaAtrTrailOpts = {
  initialCash?: number;
  feeBps?: number;
  fast?: number;
  slow?: number;
  atrPeriod?: number;
  atrMult?: number;
};

/**
 * 双均线开仓 + ATR 吊灯止损（峰值回撤 ATR×mult）与死叉平仓；撮合逻辑与 simulateLastWindow 一致。
 */
export function simulateDualMaAtrTrail(
  bars: HkCandle[],
  windowBars: number,
  strategyId: string,
  opts?: DualMaAtrTrailOpts,
): WindowSimResult {
  const initialCash = opts?.initialCash ?? 1_000_000;
  const feeBps = opts?.feeBps ?? 5;
  const fee = feeBps / 10_000;
  const fast = opts?.fast ?? 5;
  const slow = opts?.slow ?? 20;
  const atrPeriod = opts?.atrPeriod ?? 14;
  const atrMult = opts?.atrMult ?? 2;

  if (bars.length === 0 || windowBars < 1) {
    return {
      strategyId,
      windowBars,
      initialCash,
      feeBps,
      points: [],
      trades: [],
      finalEquity: initialCash,
      totalReturnPct: 0,
      winBars: 0,
    };
  }

  const start = Math.max(0, bars.length - windowBars);
  let cash = initialCash;
  let shares = 0;
  let peakSinceBuy = 0;
  const points: SimBarPoint[] = [];
  const trades: SimTrade[] = [];

  for (let i = start; i < bars.length; i++) {
    const bar = bars[i];
    const px = bar.close;
    const dm = computeDualMaSignal(bars, i, fast, slow);
    let sig: StrategySignal = 0;

    if (shares > 0) {
      peakSinceBuy = Math.max(peakSinceBuy, px);
      const atr = atrSimple(bars, atrPeriod, i);
      const stopPx = atr !== undefined ? peakSinceBuy - atrMult * atr : -Infinity;
      const stopHit = atr !== undefined && px < stopPx;
      if (stopHit || dm === -1) sig = -1;
    } else if (dm === 1) {
      sig = 1;
    }

    if (sig === 1 && shares === 0) {
      const maxSpend = cash * (1 - fee);
      const q = Math.floor(maxSpend / px);
      if (q > 0) {
        const cost = q * px * (1 + fee);
        cash -= cost;
        shares = q;
        peakSinceBuy = px;
        trades.push({
          barTime: bar.date,
          side: "buy",
          price: px,
          shares: q,
          cashAfter: cash + shares * px,
          note: `市价买入 ${q} 股（含手续费约 ${(fee * q * px).toFixed(2)}）`,
        });
      }
    } else if (sig === -1 && shares > 0) {
      const gross = shares * px;
      const net = gross * (1 - fee);
      cash += net;
      trades.push({
        barTime: bar.date,
        side: "sell",
        price: px,
        shares,
        cashAfter: cash,
        note: `平仓 ${shares} 股（含手续费约 ${(fee * gross).toFixed(2)}）`,
      });
      shares = 0;
      peakSinceBuy = 0;
    }

    const equity = cash + shares * px;
    points.push({
      time: bar.date,
      close: px,
      signal: sig,
      equity,
      positionShares: shares,
    });
  }

  const lastEq = points.length ? points[points.length - 1].equity : initialCash;
  const totalReturnPct = ((lastEq - initialCash) / initialCash) * 100;
  let winBars = 0;
  for (let j = 1; j < points.length; j++) {
    if (points[j].equity > points[j - 1].equity) winBars += 1;
  }

  return {
    strategyId,
    windowBars,
    initialCash,
    feeBps,
    points,
    trades,
    finalEquity: lastEq,
    totalReturnPct,
    winBars,
  };
}
