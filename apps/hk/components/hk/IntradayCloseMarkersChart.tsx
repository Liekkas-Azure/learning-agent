"use client";

type Bar = { time: string; close: number };
type Trade = { barTime: string; side: "buy" | "sell"; price: number };

type Props = {
  bars: Bar[];
  trades: Trade[];
  title?: string;
};

/** 收盘价折线 + 买卖成交点（按 barTime 对齐 K 线时间） */
export function IntradayCloseMarkersChart({ bars, trades, title }: Props) {
  const data = bars.filter((c) => Number.isFinite(c.close));
  if (data.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-neutral-500">
        K 线不足，无法绘制
      </div>
    );
  }

  const w = 720;
  const h = 220;
  const padX = 14;
  const padY = 22;

  const closes = data.map((d) => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;

  const idxByTime = new Map(data.map((b, i) => [b.time, i]));

  const pts = data.map((d, i) => {
    const x = padX + (i / (data.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (d.close - min) / span) * (h - padY * 2);
    return { x, y, time: d.time, close: d.close, i };
  });

  const dPath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const markers = trades
    .map((t) => {
      const i = idxByTime.get(t.barTime);
      if (i === undefined) return null;
      const p = pts[i];
      if (!p) return null;
      return { ...p, side: t.side, price: t.price };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-3">
      {title ? (
        <div className="mb-2 text-xs text-neutral-400">{title}</div>
      ) : null}
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="收盘价与买卖点">
        <path d={dPath} fill="none" className="stroke-sky-400/90" strokeWidth="1.75" />
        <g>
          {markers.map((m, k) =>
            m.side === "buy" ? (
              <g key={`b-${k}`}>
                <polygon
                  points={`${m.x},${m.y - 9} ${m.x - 7},${m.y + 5} ${m.x + 7},${m.y + 5}`}
                  className="fill-emerald-400 stroke-emerald-200/80"
                  strokeWidth="1"
                />
                <title>{`买入 ${m.time} @ ${m.price}`}</title>
              </g>
            ) : (
              <g key={`s-${k}`}>
                <polygon
                  points={`${m.x},${m.y + 9} ${m.x - 7},${m.y - 5} ${m.x + 7},${m.y - 5}`}
                  className="fill-rose-400 stroke-rose-200/80"
                  strokeWidth="1"
                />
                <title>{`卖出 ${m.time} @ ${m.price}`}</title>
              </g>
            ),
          )}
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-0 border-x-[5px] border-b-[8px] border-x-transparent border-b-emerald-400" />
          买入
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-rose-400" />
          卖出
        </span>
        <span>
          收盘区间 {min.toFixed(3)} → {max.toFixed(3)}
        </span>
      </div>
    </div>
  );
}
