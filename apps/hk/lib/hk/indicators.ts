/** 简单技术指标（用于分钟级回测，非券商级行情引擎） */

export function smaAt(values: number[], period: number, i: number): number | undefined {
  if (period <= 0 || i < period - 1 || i >= values.length) return undefined;
  let s = 0;
  for (let k = 0; k < period; k++) s += values[i - k];
  return s / period;
}

/** 总体标准差（与中轨同窗口，用于布林带） */
export function populationStdAt(values: number[], period: number, i: number): number | undefined {
  const m = smaAt(values, period, i);
  if (m === undefined) return undefined;
  let s = 0;
  for (let k = 0; k < period; k++) {
    const d = values[i - k] - m;
    s += d * d;
  }
  return Math.sqrt(s / period);
}

export type BollingerBand = { mid: number; upper: number; lower: number };

export function bollingerAt(
  closes: number[],
  period: number,
  mult: number,
  i: number,
): BollingerBand | undefined {
  const mid = smaAt(closes, period, i);
  const sd = populationStdAt(closes, period, i);
  if (mid === undefined || sd === undefined) return undefined;
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd };
}

/** 简单 TR 均值 ATR（与 Wilder 略有差异，便于教学实现） */
export function atrSimple(
  bars: { high: number; low: number; close: number }[],
  period: number,
  i: number,
): number | undefined {
  if (i < period || period <= 0) return undefined;
  let s = 0;
  for (let k = 0; k < period; k++) {
    const j = i - k;
    const h = bars[j].high;
    const l = bars[j].low;
    const pc = j > 0 ? bars[j - 1].close : bars[j].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    s += tr;
  }
  return s / period;
}

/** Wilder 平滑 RSI，period 典型 6/14 */
export function rsiAt(closes: number[], period: number, i: number): number | undefined {
  if (i < period || period <= 0) return undefined;
  let gain = 0;
  let loss = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const ch = closes[k] - closes[k - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  const avgG = gain / period;
  const avgL = loss / period;
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}
