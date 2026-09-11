import type { HkCandle } from "./eastmoney";
import { bollingerAt, rsiAt, smaAt } from "./indicators";

export type StrategySignal = -1 | 0 | 1;

export type StrategyMeta = {
  id: string;
  name: string;
  summary: string;
  /** 策略逻辑所需的最少 K 根数（用于提示） */
  minWarmupBars: number;
};

export type StrategyFn = (bars: HkCandle[], i: number) => StrategySignal;

export type RegisteredStrategy = { meta: StrategyMeta; signal: StrategyFn };

/** 双均线金叉/死叉：SMA(fast) 上穿 SMA(slow) 买入；下穿卖出 */
export function computeDualMaSignal(
  bars: HkCandle[],
  i: number,
  fast: number,
  slow: number,
): StrategySignal {
  if (i < slow || i < 1) return 0;
  const c = bars.map((b) => b.close);
  const f0 = smaAt(c, fast, i);
  const s0 = smaAt(c, slow, i);
  const f1 = smaAt(c, fast, i - 1);
  const s1 = smaAt(c, slow, i - 1);
  if (f0 === undefined || s0 === undefined || f1 === undefined || s1 === undefined) return 0;
  if (f1 <= s1 && f0 > s0) return 1;
  if (f1 >= s1 && f0 < s0) return -1;
  return 0;
}

function dualMa(fast: number, slow: number): StrategyFn {
  return (bars, i) => computeDualMaSignal(bars, i, fast, slow);
}

/** RSI 超卖反弹买入、超买回落卖出（边沿触发） */
function rsiReversion(period: number, lowTh: number, highTh: number): StrategyFn {
  return (bars, i) => {
    if (i < period + 1) return 0;
    const c = bars.map((b) => b.close);
    const r0 = rsiAt(c, period, i);
    const r1 = rsiAt(c, period, i - 1);
    if (r0 === undefined || r1 === undefined) return 0;
    if (r1 < lowTh && r0 >= lowTh) return 1;
    if (r1 > highTh && r0 <= highTh) return -1;
    return 0;
  };
}

/** N 根 K 收盘涨跌幅 ROC 上穿/下穿阈值（边沿触发，适合分钟动量） */
function rocMomentum(look: number, th: number): StrategyFn {
  return (bars, i) => {
    if (i < look + 1) return 0;
    const c0 = bars[i].close;
    const cL = bars[i - look].close;
    if (cL === 0) return 0;
    const r0 = (c0 - cL) / cL;
    const cP = bars[i - 1].close;
    const cPL = bars[i - 1 - look].close;
    if (cPL === 0) return 0;
    const r1 = (cP - cPL) / cPL;
    if (r1 <= th && r0 > th) return 1;
    if (r1 >= -th && r0 < -th) return -1;
    return 0;
  };
}

/** 唐奇安：前 N 根不含当根的区间高/低，收盘价上破高做多、下破低平仓（边沿） */
function donchianBreak(period: number): StrategyFn {
  return (bars, i) => {
    if (i < period + 1) return 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - period; k < i; k++) {
      hi = Math.max(hi, bars[k].high);
      lo = Math.min(lo, bars[k].low);
    }
    const px = bars[i].close;
    const prev = bars[i - 1].close;
    if (prev <= hi && px > hi) return 1;
    if (prev >= lo && px < lo) return -1;
    return 0;
  };
}

/** 布林带(20,2) 下轨反弹买入、上轨回落卖出（边沿触发，简化均值回归） */
function bollingerMeanRevert(period: number, mult: number): StrategyFn {
  return (bars, i) => {
    if (i < period + 1) return 0;
    const c = bars.map((b) => b.close);
    const b0 = bollingerAt(c, period, mult, i);
    const b1 = bollingerAt(c, period, mult, i - 1);
    if (!b0 || !b1) return 0;
    const c0 = c[i];
    const cP = c[i - 1];
    if (cP <= b1.lower && c0 > b0.lower) return 1;
    if (cP >= b1.upper && c0 < b0.upper) return -1;
    return 0;
  };
}

const STRATEGY_REGISTRY: Record<string, RegisteredStrategy> = {
  sma_cross_5_20: {
    meta: {
      id: "sma_cross_5_20",
      name: "双均线（5/20）金叉死叉",
      summary: "收盘 SMA5 与 SMA20 交叉触发：短上穿长做多，短下穿长平仓。",
      minWarmupBars: 22,
    },
    signal: dualMa(5, 20),
  },
  rsi_6_reversion: {
    meta: {
      id: "rsi_6_reversion",
      name: "RSI(6) 超卖反弹 / 超买回落",
      summary: "6 周期 RSI 自下而上穿过 30 视为反弹买入；自上而下穿过 70 视为回落减仓。",
      minWarmupBars: 12,
    },
    signal: rsiReversion(6, 30, 70),
  },
  roc_10_momentum: {
    meta: {
      id: "roc_10_momentum",
      name: "10 根动量 ROC（阈值 0.05%）",
      summary: "相对 10 根 K 前收盘的涨跌幅，上穿 +0.05% 做多，下穿 -0.05% 平仓（边沿触发）。",
      minWarmupBars: 14,
    },
    signal: rocMomentum(10, 0.0005),
  },
  donchian_15_break: {
    meta: {
      id: "donchian_15_break",
      name: "唐奇安 15 根突破",
      summary: "收盘价突破前 15 根 K 最高价做多，跌破前 15 根最低价平仓（简化单轨）。",
      minWarmupBars: 18,
    },
    signal: donchianBreak(15),
  },
  bollinger_20_2_mean_revert: {
    meta: {
      id: "bollinger_20_2_mean_revert",
      name: "布林带(20,2) 均值回归",
      summary: "收盘价自下而上收复下轨视为超卖反弹买入；自上而下跌破上轨视为回落减仓。",
      minWarmupBars: 24,
    },
    signal: bollingerMeanRevert(20, 2),
  },
  /** 信号由 simulateDualMaAtrTrail 单独计算；此处占位不参与通用 simulateLastWindow */
  dual_ma_atr_trail: {
    meta: {
      id: "dual_ma_atr_trail",
      name: "双均线 + ATR 吊灯止损",
      summary: "沿用 5/20 金叉开仓；持仓期间以「最高价 − 2×ATR(14)」为跟踪止损，死叉或触发止损平仓。",
      minWarmupBars: 36,
    },
    signal: () => 0,
  },
};

export function listStrategies(): StrategyMeta[] {
  return Object.values(STRATEGY_REGISTRY).map((s) => s.meta);
}

export function getStrategy(id: string): RegisteredStrategy | null {
  return STRATEGY_REGISTRY[id] ?? null;
}
