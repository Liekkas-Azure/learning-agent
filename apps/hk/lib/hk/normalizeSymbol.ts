export type HkSymbolNormalized = { code5: string; secid: string };

/** 港股代码规范为 5 位数字（如 00700），用于东方财富 secid=116.xxx */
export function normalizeHkSymbol(input: string): HkSymbolNormalized | null {
  const raw = input.trim().replace(/\s+/g, "").replace(/\.hk$/i, "");
  if (!/^\d{1,5}$/.test(raw)) return null;
  const code5 = raw.padStart(5, "0");
  if (code5 === "00000") return null;
  return { code5, secid: `116.${code5}` };
}
