import { llmRankNewsForHkSymbol } from "./newsLlmRank";
import { fetchSinaHkCorpNewsItems, hkSymbolForSina } from "./newsSinaCorp";
import { macroContextBoost, scoreNewsItem } from "./scoring";

export type RawNewsItem = {
  title: string;
  link: string;
  publishedAt?: string;
  source: string;
  summary: string;
};

export type EnrichedNewsItem = RawNewsItem & ReturnType<typeof scoreNewsItem>;

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, "$1").trim() ?? "";
}

export function parseRss(xml: string, defaultSource: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = extractTag(block, "title").replace(/<[^>]+>/g, "");
    let link = extractTag(block, "link");
    if (!link) {
      const guid = extractTag(block, "guid");
      if (guid.startsWith("http")) link = guid;
    }
    const pub = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    let summary = extractTag(block, "description") || extractTag(block, "summary");
    summary = summary.replace(/<[^>]+>/g, "").slice(0, 400);
    if (!title || !link) continue;
    items.push({
      title,
      link,
      publishedAt: pub || undefined,
      source: defaultSource,
      summary,
    });
  }
  return items;
}

async function fetchText(url: string, ms: number): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HKQuantBoard/1.0; +https://example.local)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 内置公开 RSS：境内主站、标准 RSS 2.0（含 `<item>`）。
 * 侧重证券、公司、宏观与外盘；链接均经拉取校验为可解析的 RSS（停更或返回 HTML 的源未列入）。
 */
const HK_BUILTIN_NEWS_FEEDS: { url: string; source: string }[] = [
  { url: "https://www.chinanews.com/rss/finance.xml", source: "中新网·财经" },
  { url: "https://www.chinanews.com/rss/world.xml", source: "中新网·国际" },
  { url: "https://www.chinanews.com.cn/rss/finance.xml", source: "中国新闻网·财经" },
  { url: "https://www.chinanews.com.cn/rss/world.xml", source: "中国新闻网·国际" },
  { url: "https://www.chinanews.com.cn/rss/scroll-news.xml", source: "中国新闻网·滚动" },
  { url: "https://www.people.com.cn/rss/finance.xml", source: "人民网·财经" },
  { url: "https://www.people.com.cn/rss/world.xml", source: "人民网·国际" },
  { url: "https://www.people.com.cn/rss/politics.xml", source: "人民网·时政" },
  { url: "https://www.people.com.cn/rss/opinion.xml", source: "人民网·观点" },
  { url: "https://www.people.com.cn/rss/haixia.xml", source: "人民网·港澳台" },
  { url: "https://www.xinhuanet.com/fortune/news_fortune.xml", source: "新华网·财经" },
  { url: "https://www.xinhuanet.com/world/news_world.xml", source: "新华网·国际" },
  { url: "https://www.eeo.com.cn/rss.xml", source: "经济观察报" },
  { url: "https://rss.eastmoney.com/rss_partener.xml", source: "东方财富·RSS快讯" },
];

type Row = EnrichedNewsItem & { __eff: number };

function hkMarketBoost(text: string): number {
  if (
    /恒生|港股|Hong\s*Kong|HKEX|港交所|H\s*股|中概|ADR|离岸人民币|美联储|加息|降息|欧央行|日本央行/i.test(
      text,
    )
  ) {
    return 18;
  }
  if (
    /A股|沪深|沪指|深成指|创业板|科创板|证监会|交易所|上市公司|信披|信息披露|停牌|复牌|增持|减持|回购|解禁|限售|分红|送转|配股|增发|转债|IPO|发审|港股通|南向|北向|大宗|龙虎榜|财报|业绩快报|扭亏|预增|预减|券商|公募|私募/i.test(
      text,
    )
  ) {
    return 14;
  }
  return 0;
}

function bucketSortPriority(b: EnrichedNewsItem["newsBucket"]): number {
  if (b === "stock") return 3;
  if (b === "industry") return 2;
  if (b === "macro") return 1;
  return 0;
}

function stripEff<T extends { __eff?: number }>(row: T): Omit<T, "__eff"> {
  const { __eff, ...rest } = row;
  void __eff;
  return rest;
}

/**
 * 最终返回给前端的条数上限。多源 RSS 仍会全部拉取并参与去重、打分与分类，仅截取前 N 条。
 * 可调：`HK_NEWS_DISPLAY_MAX`（12–100，默认 48）。
 */
function resolveNewsDisplayMax(): number {
  const v = Number.parseInt(process.env.HK_NEWS_DISPLAY_MAX ?? "", 10);
  if (Number.isFinite(v) && v >= 12 && v <= 100) return v;
  return 48;
}

/**
 * 新浪个股条目带高额排序加成，会占满「前 48 条」导致 RSS 宏观/行业稿进不了合并结果。
 * 从全量候选中按桶配额抽样，保证最终列表里能出现宏观与行业（在确有候选时）。
 */
function pickStratifiedPool(pool: Row[], limit: number): EnrichedNewsItem[] {
  const macro = pool
    .filter((x) => x.newsBucket === "macro")
    .sort((a, b) => b.__eff - a.__eff);
  const industry = pool
    .filter((x) => x.newsBucket === "industry")
    .sort((a, b) => b.__eff - a.__eff);
  const rest = pool
    .filter((x) => x.newsBucket === "stock" || x.newsBucket === "general")
    .sort((a, b) => b.__eff - a.__eff);

  const capMacro = 10;
  const capIndustry = 10;
  const picks: Row[] = [];
  const used = new Set<string>();

  const take = (rows: Row[], cap: number) => {
    for (const x of rows) {
      if (picks.length >= limit) return;
      if (used.has(x.link)) continue;
      if (cap-- <= 0) return;
      picks.push(x);
      used.add(x.link);
    }
  };

  take(macro, capMacro);
  take(industry, capIndustry);
  for (const x of rest) {
    if (picks.length >= limit) break;
    if (used.has(x.link)) continue;
    picks.push(x);
    used.add(x.link);
  }

  return picks.slice(0, limit).map((row) => stripEff(row));
}

export async function fetchNewsForHkStock(
  name: string,
  code5: string,
): Promise<{
  items: EnrichedNewsItem[];
  errors: string[];
  rawCount: number;
  /** 标题+链接去重后、通过规则门槛进入打分的条数 */
  scoredCount: number;
  /** 与 `items.length` 上限一致，供前端展示说明 */
  displayMax: number;
  llmUsed: boolean;
  llmNote?: string;
}> {
  const errors: string[] = [];
  const displayMax = resolveNewsDisplayMax();
  const urls: { url: string; source: string }[] = [...HK_BUILTIN_NEWS_FEEDS];

  const extra = process.env.HK_NEWS_RSS_URLS;
  if (extra) {
    for (const part of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      urls.push({ url: part, source: new URL(part).hostname });
    }
  }

  const raw: RawNewsItem[] = [];

  const hkSym = hkSymbolForSina(code5);
  const sinaCorp = await fetchSinaHkCorpNewsItems(code5, hkSym);
  if (sinaCorp.error) errors.push(sinaCorp.error);
  raw.push(...sinaCorp.items);

  await Promise.all(
    urls.map(async ({ url, source }) => {
      const xml = await fetchText(url, 14_000);
      if (!xml || xml.length < 80) {
        errors.push(`${source}: 拉取失败或超时`);
        return;
      }
      raw.push(...parseRss(xml, source));
    }),
  );

  const seen = new Set<string>();
  const enriched: Row[] = [];

  for (const it of raw) {
    const key = `${it.title}::${it.link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = `${it.title}\n${it.summary}`;
    const scores = scoreNewsItem(it.title, it.summary, name, code5, { source: it.source });
    const macro = macroContextBoost(it.title, it.summary);
    const hk = hkMarketBoost(text);
    /** 新浪财经个股页与代码强绑定，显著抬高排序，避免被泛财经 RSS 淹没 */
    const sinaCorpBonus = it.source.startsWith("新浪财经·港股个股") ? 48 : 0;
    const eff = scores.relevance + hk + macro + sinaCorpBonus;

    const qualifies =
      eff >= 5 ||
      scores.relevance >= 8 ||
      macro >= 16 ||
      hk >= 14 ||
      scores.newsBucket === "macro" ||
      scores.newsBucket === "stock" ||
      scores.newsBucket === "industry";

    if (!qualifies) continue;
    enriched.push({ ...it, ...scores, __eff: eff });
  }

  enriched.sort((a, b) => {
    const pick = (s: EnrichedNewsItem["sentiment"]) =>
      s === "positive" ? 6 : s === "negative" ? 3 : 0;
    const ra = a.__eff * 10 + pick(a.sentiment);
    const rb = b.__eff * 10 + pick(b.sentiment);
    return rb - ra;
  });

  const LLM_CAP = 48;
  const topForLlm = enriched.slice(0, LLM_CAP);
  let llmUsed = false;
  let llmNote: string | undefined;

  const llmResult = await llmRankNewsForHkSymbol(
    name,
    code5,
    topForLlm.map((x) => ({ title: x.title, summary: x.summary })),
  );

  let cleaned: EnrichedNewsItem[] = [];

  if (llmResult && llmResult.rows.length > 0) {
    llmUsed = true;
    const byI = new Map(llmResult.rows.map((r) => [r.i, r]));
    const merged: Row[] = [];
    const droppedLinks = new Set<string>();

    for (let j = 0; j < topForLlm.length; j++) {
      const base = topForLlm[j];
      const r = byI.get(j);
      if (r?.bucket === "noise" && r.score < 38) {
        droppedLinks.add(base.link);
        continue;
      }

      let bucket: EnrichedNewsItem["newsBucket"] = base.newsBucket;
      if (r?.bucket === "noise") {
        bucket = "general";
      } else if (r) {
        if (r.bucket === "macro" || r.bucket === "industry") {
          if (base.newsBucket === "stock" && base.relevance >= 28) bucket = "stock";
          else bucket = r.bucket;
        } else if (r.bucket === "stock") {
          if (base.newsBucket === "macro" || base.newsBucket === "industry") {
            bucket = base.newsBucket;
          } else {
            bucket = "stock";
          }
        }
      }
      if (base.source.startsWith("新浪财经·港股个股")) bucket = "stock";

      merged.push({
        ...base,
        newsBucket: bucket,
        llmScore: r?.score,
        __eff: base.__eff,
      });
    }

    merged.sort((a, b) => {
      const pa = bucketSortPriority(a.newsBucket);
      const pb = bucketSortPriority(b.newsBucket);
      if (pb !== pa) return pb - pa;
      const sa = a.llmScore ?? 0;
      const sb = b.llmScore ?? 0;
      if (sb !== sa) return sb - sa;
      return b.__eff - a.__eff;
    });

    const mergedByLink = new Map(merged.map((m) => [m.link, m]));
    const unified: Row[] = [];
    for (const r of enriched) {
      if (droppedLinks.has(r.link)) continue;
      unified.push(mergedByLink.get(r.link) ?? r);
    }
    cleaned = pickStratifiedPool(unified, displayMax);

    if (llmResult.error) llmNote = llmResult.error;
  } else {
    if (llmResult?.error) llmNote = llmResult.error;
    cleaned = pickStratifiedPool(enriched, displayMax);
  }

  if (cleaned.length < 8) {
    const supplemental = new Set(HK_BUILTIN_NEWS_FEEDS.map((f) => f.source));
    const have = new Set(cleaned.map((c) => c.link));
    for (const it of raw) {
      const allowSinaCorp = it.source.startsWith("新浪财经·港股个股");
      if (!allowSinaCorp && !supplemental.has(it.source)) continue;
      if (have.has(it.link)) continue;
      const scores = scoreNewsItem(it.title, it.summary, name, code5, { source: it.source });
      cleaned.push({ ...it, ...scores });
      have.add(it.link);
      if (cleaned.length >= 22) break;
    }
  }

  return {
    items: cleaned.slice(0, displayMax),
    errors,
    rawCount: raw.length,
    scoredCount: enriched.length,
    displayMax,
    llmUsed,
    llmNote,
  };
}
