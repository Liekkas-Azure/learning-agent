import "@/lib/hk/ensure-ipv4-first";

export type HkQuote = {
  code: string;
  name: string;
  last: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number;
  turnover: number;
  marketCap?: number;
  peTtm?: number;
  volumeRatio?: number;
  amplitudePct?: number;
};

export type HkCandle = {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};

const QUOTE_FIELDS =
  "f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f167,f168,f169,f170,f171";

type EmQuoteResponse = {
  data?: Record<string, number | string | null | undefined>;
};

type EmKlineResponse = {
  data?: { klines?: string[] };
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function priceFromField(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return v / 1000;
}

export async function fetchHkQuote(secid: string): Promise<HkQuote> {
  const url = `http://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(
    secid,
  )}&fields=${QUOTE_FIELDS}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`quote_http_${res.status}`);
  const json = (await res.json()) as EmQuoteResponse;
  const d = json.data;
  if (!d) throw new Error("quote_empty");

  const last = priceFromField(num(d.f43));
  const open = priceFromField(num(d.f46));
  const high = priceFromField(num(d.f44));
  const low = priceFromField(num(d.f45));
  const prevClose = priceFromField(num(d.f60));
  const change = priceFromField(num(d.f169));
  const changePct = num(d.f170);
  const volume = num(d.f47);
  const turnover = num(d.f48);
  const marketCap = num(d.f116);
  const peTtm = num(d.f167);
  const volumeRatio = num(d.f168);
  const amplitudePct = num(d.f171);

  if (
    last === undefined ||
    !d.f57 ||
    !d.f58 ||
    prevClose === undefined ||
    change === undefined ||
    changePct === undefined ||
    volume === undefined ||
    turnover === undefined
  ) {
    throw new Error("quote_incomplete");
  }

  return {
    code: String(d.f57),
    name: String(d.f58),
    last,
    open: open ?? last,
    high: high ?? last,
    low: low ?? last,
    prevClose,
    change,
    changePct: changePct / 100,
    volume,
    turnover,
    marketCap,
    peTtm,
    volumeRatio,
    amplitudePct: amplitudePct !== undefined ? amplitudePct / 100 : undefined,
  };
}

export async function fetchHkKlines(secid: string, limit = 120): Promise<HkCandle[]> {
  const url =
    `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(
      secid,
    )}` +
    `&klt=101&fqt=1&lmt=${limit}&end=20500000&iscca=1` +
    `&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`kline_http_${res.status}`);
  const json = (await res.json()) as EmKlineResponse;
  const lines = json.data?.klines;
  if (!lines?.length) throw new Error("kline_empty");

  const out: HkCandle[] = [];
  for (const row of lines) {
    const p = row.split(",");
    if (p.length < 6) continue;
    const date = p[0];
    const open = Number(p[1]);
    const close = Number(p[2]);
    const high = Number(p[3]);
    const low = Number(p[4]);
    const volume = Number(p[5]);
    if (!date || [open, close, high, low, volume].some((n) => Number.isNaN(n))) continue;
    out.push({ date, open, close, high, low, volume });
  }
  return out;
}

export type IntradayInterval = "1m" | "5m" | "15m";

/** 分钟级 K 线：1m/5m/15m 对应东方财富 klt=1/5/15 */
export async function fetchHkIntradayKlines(
  secid: string,
  interval: IntradayInterval,
  limit = 240,
): Promise<HkCandle[]> {
  const klt = interval === "1m" ? "1" : interval === "5m" ? "5" : "15";
  const url =
    `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(
      secid,
    )}` +
    `&klt=${klt}&fqt=1&lmt=${limit}&end=20500000&iscca=1` +
    `&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`intraday_kline_http_${res.status}`);
  const json = (await res.json()) as EmKlineResponse;
  const lines = json.data?.klines;
  if (!lines?.length) throw new Error("intraday_kline_empty");

  const out: HkCandle[] = [];
  for (const row of lines) {
    const p = row.split(",");
    if (p.length < 6) continue;
    const date = p[0];
    const open = Number(p[1]);
    const close = Number(p[2]);
    const high = Number(p[3]);
    const low = Number(p[4]);
    const volume = Number(p[5]);
    if (!date || [open, close, high, low, volume].some((n) => Number.isNaN(n))) continue;
    out.push({ date, open, close, high, low, volume });
  }
  return out;
}
