import { NextResponse } from "next/server";
import type { IntradayInterval } from "@/lib/hk/eastmoney";
import { fetchHkIntradayKlines } from "@/lib/hk/eastmoney";
import { normalizeHkSymbol } from "@/lib/hk/normalizeSymbol";
import { runWindowSimulation } from "@/lib/hk/runWindowSimulation";
import { listStrategies } from "@/lib/hk/strategies";

export const dynamic = "force-dynamic";

const WINDOW_CHOICES = new Set([1, 5, 15]);

function parseInterval(raw: string | null): IntradayInterval {
  if (raw === "1m" || raw === "15m") return raw;
  return "5m";
}

function defaultLookback(interval: IntradayInterval): number {
  if (interval === "1m") return 320;
  if (interval === "5m") return 240;
  return 180;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("symbol") ?? "";
  const norm = normalizeHkSymbol(raw);
  if (!norm) {
    return NextResponse.json({ error: "invalid_symbol" }, { status: 400 });
  }

  const windowNum = Number(searchParams.get("window") ?? 5);
  const windowBars = WINDOW_CHOICES.has(windowNum) ? windowNum : 5;
  const interval = parseInterval(searchParams.get("interval"));
  const defaultLb = defaultLookback(interval);
  const lookback = Math.min(600, Math.max(80, Number(searchParams.get("lookback") ?? defaultLb) || defaultLb));

  const metas = listStrategies();
  const minBarsRequired = Math.max(...metas.map((m) => m.minWarmupBars + windowBars));

  try {
    const bars = await fetchHkIntradayKlines(norm.secid, interval, lookback);
    if (bars.length < minBarsRequired) {
      return NextResponse.json(
        {
          error: "insufficient_bars",
          message: `当前 ${bars.length} 根 K，全策略对比至少需要 ${minBarsRequired} 根（含最长预热）。`,
          barsLoaded: bars.length,
          minBarsRequired,
        },
        { status: 422 },
      );
    }

    const chartTail = Math.min(bars.length, Math.max(96, windowBars + 40));
    const barsForChart = bars.slice(-chartTail).map((b) => ({
      time: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));

    const comparisons = metas.map((meta) => {
      const need = meta.minWarmupBars + windowBars;
      if (bars.length < need) {
        return {
          strategyId: meta.id,
          strategyName: meta.name,
          strategySummary: meta.summary,
          skipped: true as const,
          skipReason: `K 线不足（需 ${need} 根）`,
          totalReturnPct: 0,
          finalEquity: 1_000_000,
          trades: [] as import("@/lib/hk/simulate").SimTrade[],
          points: [] as import("@/lib/hk/simulate").SimBarPoint[],
        };
      }
      const sim = runWindowSimulation(bars, windowBars, meta.id)!;
      return {
        strategyId: meta.id,
        strategyName: meta.name,
        strategySummary: meta.summary,
        skipped: false as const,
        totalReturnPct: sim.totalReturnPct,
        finalEquity: sim.finalEquity,
        trades: sim.trades,
        points: sim.points,
      };
    });

    comparisons.sort((a, b) => b.totalReturnPct - a.totalReturnPct);

    return NextResponse.json({
      refreshedAt: new Date().toISOString(),
      symbol: norm.code5,
      secid: norm.secid,
      interval,
      windowBars,
      lookbackBars: bars.length,
      minBarsRequired,
      barsForChart,
      comparisons,
      disclaimer:
        "多策略在同一批 K 线上独立回测最近窗口；按收盘价整手撮合，不含滑点与停牌；定时刷新仅重新拉取行情与重算，非交易所逐笔撮合。",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "upstream_failed", message: msg }, { status: 502 });
  }
}
