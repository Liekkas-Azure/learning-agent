import { NextResponse } from "next/server";
import { fetchFeed } from "@/lib/rss";

function topicFeeds(topic: string) {
  const q = encodeURIComponent(topic.trim());
  return [
    { source: "Google News", url: `https://news.google.com/rss/search?q=${q}%20when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans` },
    { source: "Bing News", url: `https://www.bing.com/news/search?q=${q}&format=rss` },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const topic = (searchParams.get("topic") ?? "").trim();
  const take = Math.min(40, Math.max(1, Number.parseInt(searchParams.get("take") ?? "16", 10) || 16));

  if (!topic) {
    return NextResponse.json({ error: "topic 必填" }, { status: 400 });
  }

  const feeds = topicFeeds(topic);
  const lists = await Promise.all(feeds.map((f) => fetchFeed(f.url, f.source)));
  const items = lists
    .flat()
    .sort((a, b) => {
      const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
      const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
      return tb - ta;
    })
    .slice(0, take);

  return NextResponse.json({ topic, items });
}
