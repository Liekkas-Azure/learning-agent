export function formatNumber(n: number, digits = 2): string {
  return new Intl.NumberFormat("zh-Hans-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

/** 大数字展示（市值、成交额等，源数据多为「元」量级） */
export function formatCnLargeAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${formatNumber(n / 1e12, 2)} 万亿`;
  if (abs >= 1e8) return `${formatNumber(n / 1e8, 2)} 亿`;
  if (abs >= 1e4) return `${formatNumber(n / 1e4, 2)} 万`;
  return formatNumber(n, 0);
}

export function formatVolume(n: number): string {
  if (n >= 1e8) return `${formatNumber(n / 1e8, 2)} 亿股`;
  if (n >= 1e4) return `${formatNumber(n / 1e4, 2)} 万股`;
  return `${formatNumber(n, 0)} 股`;
}
