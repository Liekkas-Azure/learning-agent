const PLATFORM_RULES: Array<{ re: RegExp; name: string }> = [
  { re: /mp\.weixin\.qq\.com/i, name: "微信" },
  { re: /xiaohongshu\.com|xhslink\.com/i, name: "小红书" },
  { re: /bilibili\.com|b23\.tv/i, name: "B站" },
  { re: /zhihu\.com/i, name: "知乎" },
  { re: /juejin\.cn/i, name: "掘金" },
  { re: /github\.com/i, name: "GitHub" },
];

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) return ogMatch[1].trim();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

const EN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "from",
  "your",
  "into",
  "about",
  "when",
  "where",
  "what",
  "how",
  "http",
  "https",
  "www",
  "com",
  "html",
  "index",
  "home",
  "page",
]);

const ZH_STOPWORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这些",
  "那些",
  "这个",
  "那个",
  "一个",
  "一种",
  "已经",
  "以及",
  "进行",
  "关于",
  "通过",
  "可以",
  "如果",
  "但是",
  "因为",
  "所以",
  "然后",
  "这里",
  "那里",
  "内容",
  "更多",
  "相关",
  "发布",
  "阅读",
  "作者",
  "来源",
  "页面",
]);

function cleanCandidate(raw: string) {
  return raw
    .replace(/^[\s\-–—_:：|,.!?/\\'"“”‘’()（）\[\]【】]+/g, "")
    .replace(/[\s\-–—_:：|,.!?/\\'"“”‘’()（）\[\]【】]+$/g, "")
    .trim();
}

export function pickKeywords(text: string) {
  const counter = new Map<string, number>();
  const src = text.replace(/\s+/g, " ").trim();
  if (!src) return [];

  const zhMatches = src.match(/[\p{Script=Han}]{2,8}/gu) ?? [];
  for (const raw of zhMatches) {
    const token = cleanCandidate(raw);
    if (!token || token.length < 2 || token.length > 8) continue;
    if (ZH_STOPWORDS.has(token)) continue;
    counter.set(token, (counter.get(token) ?? 0) + 1);
  }

  const enMatches = src.toLowerCase().match(/[a-z][a-z0-9+-]{1,23}/g) ?? [];
  for (const raw of enMatches) {
    const token = cleanCandidate(raw);
    if (!token || token.length < 2) continue;
    if (EN_STOPWORDS.has(token)) continue;
    counter.set(token, (counter.get(token) ?? 0) + 1);
  }

  return [...counter.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].length - b[0].length;
    })
    .slice(0, 8)
    .map(([w]) => w);
}

export function summarizePlainText(text: string, max = 320) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.slice(0, max);
}

export function inferTitleFromText(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "未命名笔记";
  const first = cleaned.split(/[。.!?\n]/g)[0]?.trim() ?? cleaned;
  return first.slice(0, 72) || "未命名笔记";
}

export function detectOriginFromUrl(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return PLATFORM_RULES.find((r) => r.re.test(hostname))?.name ?? hostname;
  } catch {
    return null;
  }
}

export type IngestResult = {
  title: string;
  origin: string | null;
  content: string;
  summary: string;
  suggestedTags: string[];
};

export async function ingestFromUrl(url: string): Promise<IngestResult> {
  const target = new URL(url);
  const origin = detectOriginFromUrl(target.toString()) ?? target.hostname;

  const res = await fetch(target.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`抓取失败: ${res.status}`);
  }

  const html = await res.text();
  const title = extractTitle(html) || target.hostname;
  const content = stripHtml(html).slice(0, 6000);
  const summary = content.slice(0, 300);
  const suggestedTags = pickKeywords(`${title}\n${summary}\n${content.slice(0, 1800)}`);

  return { title, origin, content, summary, suggestedTags };
}
