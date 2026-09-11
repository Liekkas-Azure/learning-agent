"use client";

import type { HkCandle } from "@/lib/hk/eastmoney";

type Props = {
  candles: HkCandle[];
  accentClassName?: string;
};

export function PriceLineChart({
  candles,
  accentClassName = "stroke-emerald-400",
}: Props) {
  const data = candles.filter((c) => Number.isFinite(c.close));
  if (data.length < 2) {
    return (
      <div className="flex h-52 items-center justify-center rounded-xl border border-white/[0.08] bg-black/25 text-sm text-slate-500">
        K 线数据不足，无法绘制走势图
      </div>
    );
  }

  const w = 720;
  const h = 240;
  const padX = 12;
  const padY = 18;

  const closes = data.map((d) => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;

  const pts = data.map((d, i) => {
    const x = padX + (i / (data.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (d.close - min) / span) * (h - padY * 2);
    return { x, y, date: d.date, close: d.close };
  });

  const dPath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const last = pts[pts.length - 1];
  const first = pts[0];
  const trendUp = last.close >= first.close;

  return (
    <div className="ai-card w-full overflow-hidden !rounded-xl bg-gradient-to-b from-white/[0.05] to-transparent p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2 text-xs text-slate-500">
        <span className="font-medium">日线收盘（近 {data.length} 个交易日）</span>
        <span className={`tabular-nums ${trendUp ? "text-emerald-300" : "text-rose-300"}`}>
          {min.toFixed(3)} → {max.toFixed(3)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label="收盘价走势图"
      >
        <defs>
          <linearGradient id="hkFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={trendUp ? "rgb(52 211 153)" : "rgb(251 113 133)"}
              stopOpacity="0.25"
            />
            <stop offset="100%" stopColor="rgb(0 0 0)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${dPath} L ${last.x.toFixed(2)} ${(h - padY).toFixed(2)} L ${first.x.toFixed(
            2,
          )} ${(h - padY).toFixed(2)} Z`}
          fill="url(#hkFill)"
          className="opacity-90"
        />
        <path d={dPath} fill="none" className={accentClassName} strokeWidth="2" />
        <circle cx={last.x} cy={last.y} r="3.5" className="fill-white" />
      </svg>
    </div>
  );
}
