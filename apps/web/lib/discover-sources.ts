const UA =
  "LearningSaaS/1.0 (educational aggregator; +https://github.com/learning-saas)";

/** 可选网页检索：博查 AI（国内），需 BOCHA_API_KEY */
const BOCHA_SEARCH_URL = "https://api.bochaai.com/v1/web-search";

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return (
    h.includes("facebook.com") ||
    h.includes("instagram.com") ||
    h.includes("tiktok.com") ||
    h.includes("pinterest.") ||
    h === "twitter.com" ||
    h.endsWith(".twitter.com") ||
    h === "x.com" ||
    h.endsWith(".x.com")
  );
}

/** 仅保留国内常见主站，避免境外落地页 */
function isDomesticHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h.endsWith(".cn")) return true;
  if (h.endsWith(".com.cn")) return true;
  if (h.endsWith(".gov.cn")) return true;
  if (h.endsWith(".edu.cn")) return true;
  const allow = [
    "baidu.com",
    "baike.baidu.com",
    "zhihu.com",
    "bilibili.com",
    "qq.com",
    "163.com",
    "126.com",
    "sina.com.cn",
    "sina.cn",
    "sohu.com",
    "ifeng.com",
    "people.com.cn",
    "xinhuanet.com",
    "gmw.cn",
    "cctv.com",
    "chinadaily.com.cn",
    "ce.cn",
    "stdaily.com",
    "sciencenet.cn",
    "kepuchina.cn",
    "36kr.com",
    "jiemian.com",
    "yicai.com",
    "thepaper.cn",
    "huxiu.com",
    "leiphone.com",
    "ithome.com",
    "csdn.net",
    "cnblogs.com",
    "juejin.cn",
    "oschina.net",
    "gitee.com",
  ];
  return allow.some((d) => h === d || h.endsWith(`.${d}`));
}

function normalizeKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return raw.toLowerCase().trim();
  }
}

function buildTopicQuery(title: string, description: string | null): string {
  const base = title.trim();
  const extra = description?.trim().slice(0, 160) ?? "";
  return `${base} ${extra}`.trim().slice(0, 400);
}

/**
 * 百度百科词条页（境内可访问）；标题即检索词。
 */
function baikeItemUrl(keyword: string): string {
  return `https://baike.baidu.com/item/${encodeURIComponent(keyword.trim().slice(0, 80))}`;
}

/**
 * 尝试拉取百度百科联想词，得到多个候选词条链接。
 */
async function fetchBaiduBaikeSeeds(search: string): Promise<{ url: string; label: string }[]> {
  const out: { url: string; label: string }[] = [];
  const q = search.trim().slice(0, 80);
  if (!q) return out;

  out.push({ url: baikeItemUrl(q), label: `百度百科：${q}` });

  try {
    const url = `https://baike.baidu.com/api/wikiui/suggest?enc=utf8&word=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: "https://baike.baidu.com/",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return dedupeSeeds(out);
    const data = (await res.json()) as Record<string, unknown>;
    const list = parseBaikeSuggestList(data);
    for (const row of list.slice(0, 5)) {
      const title = row.lemmaTitle?.trim();
      if (!title) continue;
      out.push({
        url: baikeItemUrl(title),
        label: title + (row.lemmaDesc ? ` — ${row.lemmaDesc.slice(0, 40)}` : ""),
      });
    }
  } catch {
    /* 仅用主词条 */
  }

  return dedupeSeeds(out);
}

function parseBaikeSuggestList(data: Record<string, unknown>): { lemmaTitle?: string; lemmaDesc?: string }[] {
  const rawList = data.list;
  if (Array.isArray(rawList)) {
    return rawList as { lemmaTitle?: string; lemmaDesc?: string }[];
  }
  const rawL = data.l;
  if (Array.isArray(rawL)) {
    return (rawL as { title?: string }[]).map((row) => ({
      lemmaTitle: row.title,
    }));
  }
  return [];
}

function dedupeSeeds(items: { url: string; label: string }[]): { url: string; label: string }[] {
  const seen = new Set<string>();
  const r: { url: string; label: string }[] = [];
  for (const it of items) {
    const k = normalizeKey(it.url);
    if (seen.has(k)) continue;
    seen.add(k);
    r.push(it);
  }
  return r;
}

/**
 * 博查 AI 网页搜索（国内服务）。文档：https://open.bochaai.com/
 */
async function fetchBochaWebUrls(query: string): Promise<{ url: string; label: string }[]> {
  const key = process.env.BOCHA_API_KEY?.trim();
  if (!key) return [];

  const res = await fetch(BOCHA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      freshness: "noLimit",
      summary: false,
      count: 10,
    }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as Record<string, unknown>;
  const webPages = (data.webPages ?? data.WebPages ?? (data.data as Record<string, unknown>)?.webPages) as
    | { value?: { url?: string; name?: string; snippet?: string }[] }
    | undefined;
  const pages = webPages?.value ?? [];
  const out: { url: string; label: string }[] = [];

  for (const p of pages) {
    const link = p.url;
    if (!link || !link.startsWith("http")) continue;
    if (link.toLowerCase().endsWith(".pdf")) continue;
    try {
      const u = new URL(link);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (isBlockedHost(u.hostname)) continue;
      if (!isDomesticHost(u.hostname)) continue;
    } catch {
      continue;
    }
    out.push({ url: link, label: p.name ?? link });
  }
  return out;
}

/** 国内主流媒体 / 政务 / 科技 RSS（公开地址，便于 Worker 拉取） */
const DOMESTIC_RSS_FEEDS: { url: string; label: string; provider: string }[] = [
  {
    url: "https://www.gov.cn/pushinfo/v150203/pushinfo.xml",
    label: "中国政府网-政务动态",
    provider: "gov.cn",
  },
  {
    url: "https://www.chinanews.com/rss/gn.xml",
    label: "中新网-国内新闻",
    provider: "chinanews",
  },
  {
    url: "https://rss.sina.com.cn/roll/finance/hot_roll.xml",
    label: "新浪财经-滚动",
    provider: "sina",
  },
  {
    url: "https://www.yicai.com/rss.xml",
    label: "第一财经",
    provider: "yicai",
  },
  {
    url: "https://www.jiemian.com/rss.xml",
    label: "界面新闻",
    provider: "jiemian",
  },
  {
    url: "https://news.sciencenet.cn/rss.aspx",
    label: "科学网-新闻",
    provider: "sciencenet",
  },
  {
    url: "https://36kr.com/feed",
    label: "36氪",
    provider: "36kr",
  },
  {
    url: "https://www.stcn.com/rss.xml",
    label: "证券时报",
    provider: "stcn",
  },
];

export type DiscoveredFeed = {
  type: "SEED_URL" | "RSS";
  url: string;
  provider: string;
  label?: string;
};

/**
 * 根据主题自动挑选**境内可访问**的公开来源：百度百科、国内 RSS、可选博查网页检索。
 * 不再使用维基百科、arXiv、Serper 等境外服务。
 */
export async function discoverSourcesForTopic(input: {
  title: string;
  description: string | null;
  language: string;
}): Promise<DiscoveredFeed[]> {
  void input.language;
  const title = input.title.trim();
  if (!title) return [];

  const query = buildTopicQuery(title, input.description);
  const seen = new Set<string>();
  const out: DiscoveredFeed[] = [];

  const push = (item: DiscoveredFeed) => {
    const key = normalizeKey(item.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const [baike, bocha] = await Promise.all([
    fetchBaiduBaikeSeeds(title),
    fetchBochaWebUrls(query),
  ]);

  for (const b of baike) {
    if (out.length >= 14) break;
    push({
      type: "SEED_URL",
      url: b.url,
      provider: "baike.baidu",
      label: b.label,
    });
  }

  for (const b of bocha) {
    if (out.length >= 14) break;
    push({
      type: "SEED_URL",
      url: b.url,
      provider: "bocha",
      label: b.label,
    });
  }

  for (const feed of DOMESTIC_RSS_FEEDS) {
    if (out.length >= 14) break;
    push({
      type: "RSS",
      url: feed.url,
      provider: feed.provider,
      label: feed.label,
    });
  }

  return out.slice(0, 14);
}
