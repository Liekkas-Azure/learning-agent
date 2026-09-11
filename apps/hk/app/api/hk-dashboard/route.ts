import { NextResponse } from "next/server";
import { computeDashboardSnapshot } from "@/lib/hk/dashboardSnapshot";
import { fetchHkIntradayKlines, fetchHkKlines, fetchHkQuote } from "@/lib/hk/eastmoney";
import { fetchNewsForHkStock } from "@/lib/hk/news";
import { normalizeHkSymbol } from "@/lib/hk/normalizeSymbol";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("symbol") ?? "";
  const norm = normalizeHkSymbol(raw);
  if (!norm) {
    return NextResponse.json(
      { error: "invalid_symbol", message: "请输入 1–5 位港股代码，例如 700 或 00700" },
      { status: 400 },
    );
  }

  try {
    const [quote, candles, bars5m] = await Promise.all([
      fetchHkQuote(norm.secid),
      fetchHkKlines(norm.secid, 140),
      fetchHkIntradayKlines(norm.secid, "5m", 72).catch(() => []),
    ]);
    const news = await fetchNewsForHkStock(quote.name, norm.code5);
    const snapshot = computeDashboardSnapshot(candles, bars5m);

    return NextResponse.json({
      symbol: norm.code5,
      secid: norm.secid,
      quote,
      candles,
      snapshot: snapshot ?? null,
      news: news.items,
      newsErrors: news.errors,
      newsRawCount: news.rawCount,
      newsScoredCount: news.scoredCount,
      newsDisplayMax: news.displayMax,
      newsLlmUsed: news.llmUsed,
      newsLlmNote: news.llmNote,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { error: "upstream_failed", message: msg },
      { status: 502 },
    );
  }
}
