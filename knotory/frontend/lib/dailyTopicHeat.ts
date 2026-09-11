import type { CSSProperties } from "react";

export type DailyTopicHeat = {
  topic: string;
  heat: number;
  heat_pct: number;
};

/** 浏览热度越高，进度条填充色越深（暖灰 → 深石色，与全站暖白风格一致）。 */
export function dailyTopicHeatFillStyle(heatPct: number): CSSProperties {
  const t = Math.max(0, Math.min(100, heatPct)) / 100;
  const tone = Math.round(16 + t * 58);
  return {
    width: `${Math.max(12, heatPct)}%`,
    ["--heat-tone" as string]: `${tone}%`,
  };
}
