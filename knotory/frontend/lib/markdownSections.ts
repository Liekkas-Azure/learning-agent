export type MarkdownSection = {
  id: string;
  title: string;
  level: number;
  markdown: string;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

function slugPart(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "sec"
  );
}

/** 与拆卡章节 id 规则一致，供阅读区锚点跳转 */
export function headingToSectionId(title: string): string {
  return `wiki-sec-${slugPart(title)}`;
}

/** 按行扫描，忽略 ``` 围栏内的行，避免误切代码块里的 # */
export function splitMarkdownIntoSections(markdown: string): MarkdownSection[] {
  const raw = (markdown || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) {
    return [{ id: "wiki-sec-intro", title: "全文", level: 1, markdown: "" }];
  }

  const lines = raw.split("\n");
  const chunks: string[][] = [];
  let fence = false;
  let cur: string[] = [];

  const flush = () => {
    if (cur.length) {
      chunks.push(cur);
      cur = [];
    }
  };

  for (const line of lines) {
    const t = line.trimStart();
    if (t.startsWith("```")) {
      fence = !fence;
      cur.push(line);
      continue;
    }
    if (!fence) {
      const m = line.match(HEADING_RE);
      if (m && m[1].length <= 6) {
        flush();
        cur.push(line);
        continue;
      }
    }
    if (cur.length === 0 && chunks.length === 0 && line.trim() === "") {
      continue;
    }
    cur.push(line);
  }
  flush();

  if (chunks.length === 0) {
    return [{ id: "wiki-sec-intro", title: "全文", level: 1, markdown: raw.trim() }];
  }

  const used = new Set<string>();
  const out: MarkdownSection[] = [];
  chunks.forEach((chunkLines, idx) => {
    const block = chunkLines.join("\n").trim();
    if (!block) return;
    const first = chunkLines[0]?.match(HEADING_RE);
    let title = `第 ${idx + 1} 节`;
    let level = 2;
    if (first) {
      level = first[1].length;
      title = first[2].trim() || title;
    } else if (idx === 0) {
      title = "开头";
      level = 1;
    }
    let id = `wiki-sec-${slugPart(title)}`;
    if (used.has(id)) id = `${id}-${idx}`;
    used.add(id);
    out.push({ id, title, level, markdown: block });
  });
  return out.length ? out : [{ id: "wiki-sec-intro", title: "全文", level: 1, markdown: raw.trim() }];
}
