import iconv from "iconv-lite";

/** 与 `news.ts` 中 RawNewsItem 一致，避免循环依赖 */
export type SinaCorpNewsItem = {
  title: string;
  link: string;
  publishedAt?: string;
  source: string;
  summary: string;
};

const SINA_CORP_SOURCE = (code5: string) => `新浪财经·港股个股(${code5})`;

/**
 * 拉取新浪财经「港股个股资讯」列表页（与网页 `symbol=hk00700` 同源），
 * 条目与所输入代码强相关（标题多直接含公司名），经 GB18030 解码后解析链接。
 */
export async function fetchSinaHkCorpNewsItems(
  code5: string,
  hkLowerSymbol: string,
): Promise<{ items: SinaCorpNewsItem[]; error?: string }> {
  const url = `https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=${encodeURIComponent(
    hkLowerSymbol,
  )}&Page=1`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 14_000);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://finance.sina.com.cn/",
        Accept: "text/html,*/*",
      },
    });
    if (!res.ok) {
      return { items: [], error: `新浪财经个股: HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const html = iconv.decode(buf, "gb18030");

    const items: SinaCorpNewsItem[] = [];
    const seen = new Set<string>();

    const rowRe =
      /(\d{4}-\d{2}-\d{2})&nbsp;(\d{1,2}:\d{2})\s*&nbsp;&nbsp;<a\s+target=['"]_blank['"]\s+href=['"]([^'"]+)['"]\s*>([^<]+)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html))) {
      const [, day, hm, link, titleRaw] = m;
      const title = titleRaw.replace(/\s+/g, " ").trim();
      const linkNorm = link.trim();
      if (!title || !linkNorm.startsWith("http")) continue;
      const key = linkNorm;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title,
        link: linkNorm,
        publishedAt: `${day} ${hm}`,
        source: SINA_CORP_SOURCE(code5),
        summary: "",
      });
      if (items.length >= 50) break;
    }

    return { items };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { items: [], error: `新浪财经个股: ${msg}` };
  } finally {
    clearTimeout(t);
  }
}

export function hkSymbolForSina(code5: string): string {
  return `hk${code5}`.toLowerCase();
}
