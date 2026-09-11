export type FeedItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string;
  summary: string | null;
};

function decodeHtml(v: string) {
  return v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getTag(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1] ? decodeHtml(m[1].trim()) : null;
}

export function parseRssItems(xml: string, source: string): FeedItem[] {
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const atomMatches = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  const blockList = [...itemMatches, ...atomMatches];

  return blockList
    .map((raw) => {
      const title = getTag(raw, "title");
      if (!title) return null;
      const linkFromTag = getTag(raw, "link");
      const atomHref = raw.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
      const link = linkFromTag ?? atomHref ?? "";
      if (!link) return null;
      const pubDate = getTag(raw, "pubDate") ?? getTag(raw, "updated");
      const summary = getTag(raw, "description") ?? getTag(raw, "summary");
      return {
        title: title.replace(/\s+/g, " ").trim(),
        link: link.trim(),
        pubDate,
        source,
        summary: summary?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null,
      } satisfies FeedItem;
    })
    .filter((v): v is FeedItem => Boolean(v));
}

export async function fetchFeed(url: string, source: string, timeoutMs = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, source);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
