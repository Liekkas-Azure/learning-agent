import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type Extracted = {
  title: string | null;
  textContent: string;
  excerpt: string | null;
};

export function extractArticle(html: string, url: string): Extracted {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title = article?.title ?? dom.window.document.title ?? null;
  const textContent = (article?.textContent ?? "").trim();
  const excerpt = article?.excerpt ?? (textContent ? textContent.slice(0, 280) : null);
  return { title, textContent, excerpt };
}
