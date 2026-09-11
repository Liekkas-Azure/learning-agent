import type { HkCandle } from "./eastmoney";
import { simulateDualMaAtrTrail, simulateLastWindow, type WindowSimResult } from "./simulate";
import { getStrategy } from "./strategies";

const DEFAULT_SIM = { initialCash: 1_000_000, feeBps: 5 as const };

export function runWindowSimulation(
  bars: HkCandle[],
  windowBars: number,
  strategyId: string,
  opts?: { initialCash?: number; feeBps?: number },
): WindowSimResult | null {
  const o = { ...DEFAULT_SIM, ...opts };
  if (strategyId === "dual_ma_atr_trail") {
    return simulateDualMaAtrTrail(bars, windowBars, strategyId, o);
  }
  const strat = getStrategy(strategyId);
  if (!strat) return null;
  return simulateLastWindow(bars, windowBars, strategyId, strat.signal, o);
}
