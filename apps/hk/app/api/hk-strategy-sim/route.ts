import { NextResponse } from "next/server";
import type { IntradayInterval } from "@/lib/hk/eastmoney";
import { fetchHkIntradayKlines } from "@/lib/hk/eastmoney";
import { normalizeHkSymbol } from "@/lib/hk/normalizeSymbol";
import { runWindowSimulation } from "@/lib/hk/runWindowSimulation";
import { getStrategy, listStrategies } from "@/lib/hk/strategies";

export const dynamic = "force-dynamic";

const WINDOW_CHOICES = new Set([1, 5, 15]);
const MAX_SYMBOLS = 5;

function parseInterval(raw: string | null): IntradayInterval {
  if (raw === "5m" || raw === "15m") return raw;
  return "1m";
}

function defaultLookback(interval: IntradayInterval): number {
  if (interval === "1m") return 320;
  if (interval === "5m") return 220;
  return 160;
}

function parseSymbolList(symbolParam: string, symbolsParam: string | null): string[] {
  const fromSymbols = symbolsParam
    ?.split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromSymbols?.length) return fromSymbols.slice(0, MAX_SYMBOLS);
  return [symbolParam.trim()].filter(Boolean);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawSymbol = searchParams.get("symbol") ?? "";
  const symbolsParam = searchParams.get("symbols");
  const strategyId = searchParams.get("strategy") ?? "sma_cross_5_20";
  const windowNum = Number(searchParams.get("window") ?? 5);
  const windowBars = WINDOW_CHOICES.has(windowNum) ? windowNum : 5;
  const interval = parseInterval(searchParams.get("interval"));

  const codes = parseSymbolList(rawSymbol, symbolsParam);
  if (!codes.length) {
    return NextResponse.json(
      { error: "invalid_symbol", strategies: listStrategies() },
      { status: 400 },
    );
  }

  const norms = codes
    .map((c) => normalizeHkSymbol(c))
    .filter((n): n is NonNullable<typeof n> => n !== null);
  const seen = new Set<string>();
  const unique = norms.filter((n) => {
    if (seen.has(n.code5)) return false;
    seen.add(n.code5);
    return true;
  });
  if (!unique.length) {
    return NextResponse.json(
      { error: "invalid_symbol", strategies: listStrategies() },
      { status: 400 },
    );
  }

  const strat = getStrategy(strategyId);
  if (!strat) {
    return NextResponse.json(
      { error: "unknown_strategy", strategies: listStrategies() },
      { status: 400 },
    );
  }

  const defaultLb = defaultLookback(interval);
  const lookback = Math.min(600, Math.max(80, Number(searchParams.get("lookback") ?? defaultLb) || defaultLb));
  const minNeed = strat.meta.minWarmupBars + windowBars;

  type Row = {
    symbol: string;
    secid: string;
    lookbackBars: number;
    barsSample: {
      time: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[];
    sim: import("@/lib/hk/simulate").WindowSimResult;
    error?: string;
    message?: string;
  };

  const results: Row[] = [];

  for (const norm of unique) {
    try {
      const bars = await fetchHkIntradayKlines(norm.secid, interval, lookback);
      if (bars.length < minNeed) {
        results.push({
          symbol: norm.code5,
          secid: norm.secid,
          lookbackBars: bars.length,
          barsSample: [],
          sim: {
            strategyId,
            windowBars,
            initialCash: 1_000_000,
            feeBps: 5,
            points: [],
            trades: [],
            finalEquity: 1_000_000,
            totalReturnPct: 0,
            winBars: 0,
          },
          error: "insufficient_bars",
          message: `当前仅 ${bars.length} 根 K，本策略建议至少 ${minNeed} 根（可增大 lookback 或换交易时段）。`,
        });
        continue;
      }

      const simOpts = { initialCash: 1_000_000, feeBps: 5 as const };
      const sim = runWindowSimulation(bars, windowBars, strategyId, simOpts)!;

      const tail = Math.min(bars.length, Math.max(windowBars + 3, 8));
      const barsSample = bars.slice(-tail).map((b) => ({
        time: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }));

      results.push({
        symbol: norm.code5,
        secid: norm.secid,
        lookbackBars: bars.length,
        barsSample,
        sim,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      results.push({
        symbol: norm.code5,
        secid: norm.secid,
        lookbackBars: 0,
        barsSample: [],
        sim: {
          strategyId,
          windowBars,
          initialCash: 1_000_000,
          feeBps: 5,
          points: [],
          trades: [],
          finalEquity: 1_000_000,
          totalReturnPct: 0,
          winBars: 0,
        },
        error: "upstream_failed",
        message: msg,
      });
    }
  }

  const okRows = results.filter((r) => !r.error);
  const portfolioAvgReturnPct =
    okRows.length > 0 ? okRows.reduce((s, r) => s + r.sim.totalReturnPct, 0) / okRows.length : 0;

  const first = results[0];
  const intervalLabel = interval === "1m" ? "1" : interval === "5m" ? "5" : "15";

  return NextResponse.json({
    strategies: listStrategies(),
    interval,
    lookbackRequested: lookback,
    windowBars,
    strategyId,
    strategyName: strat.meta.name,
    strategySummary: strat.meta.summary,
    portfolioAvgReturnPct,
    symbolCount: results.length,
    results,
    /** 与首标的一致字段，便于旧 UI 兼容 */
    symbol: first?.symbol,
    secid: first?.secid,
    lookbackBars: first?.lookbackBars ?? 0,
    barsSample: first?.barsSample ?? [],
    sim: first?.sim,
    disclaimer: `以下为近若干根 ${intervalLabel} 分钟 K 收盘撮合的简化模拟：不含滑点、盘口、停牌与融券；多标的时为各标的独立回测，组合收益为窗口收益率的简单平均；仅供教学演示，不构成投资建议。`,
  });
}
