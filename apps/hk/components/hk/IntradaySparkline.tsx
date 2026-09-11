"use client";

type Props = {
  closes: number[];
  /** 如 #38bdf8 */
  strokeClass?: string;
  height?: number;
};

/** 极简日内收盘 sparkline（无坐标轴，适合表头/条带） */
export function IntradaySparkline({
  closes,
  strokeClass = "stroke-sky-400/90",
  height = 40,
}: Props) {
  const vals = closes.filter((x) => Number.isFinite(x));
  if (vals.length < 2) return null;
  const w = 200;
  const pad = 2;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const d = vals
    .map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      className="w-full max-w-[200px]"
      style={{ height }}
      aria-hidden
    >
      <path d={d} fill="none" className={strokeClass} strokeWidth="1.5" />
    </svg>
  );
}
