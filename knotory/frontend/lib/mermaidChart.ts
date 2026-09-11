const MERMAID_HEAD =
  /^\s*(graph\s|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap|timeline|pie\s|gitGraph)/i;

/** 清洗 LLM 返回的 Mermaid 文本，便于前端渲染。 */
export function normalizeMermaidChart(raw: string): string {
  let t = (raw || "").trim();
  if (!t) return "";
  t = t.replace(/^```(?:mermaid)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  t = t.replace(/\r\n/g, "\n");
  return t;
}

export function isLikelyMermaidChart(raw: string): boolean {
  const t = normalizeMermaidChart(raw);
  return t.length >= 12 && MERMAID_HEAD.test(t);
}

/** mindmap 子节点含中文/符号时，补引号降低解析失败率。 */
export function repairMindmapChart(raw: string): string {
  const t = normalizeMermaidChart(raw);
  if (!/^mindmap\b/i.test(t)) return t;
  const lines = t.split("\n");
  const out = [lines[0] ?? "mindmap"];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (
      trimmed.startsWith("root") ||
      trimmed.startsWith("((") ||
      trimmed.startsWith('"') ||
      trimmed.startsWith("'")
    ) {
      out.push(line);
      continue;
    }
    if (/[^\w\s\u4e00-\u9fff-]/.test(trimmed) || /[\u4e00-\u9fff]/.test(trimmed)) {
      const label = trimmed.replace(/^["']|["']$/g, "");
      out.push(`${indent}("${label.replace(/"/g, "'")}")`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function prepareMermaidChart(raw: string): string {
  const base = normalizeMermaidChart(raw);
  if (!base) return "";
  if (/^mindmap\b/i.test(base)) return repairMindmapChart(base);
  return base;
}

type MermaidErrorLike = {
  str?: string;
  message?: string;
  hash?: string;
  error?: unknown;
  errors?: unknown[];
};

export function formatMermaidError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as MermaidErrorLike;
    if (typeof o.str === "string" && o.str.trim()) return o.str.trim();
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (typeof o.hash === "string" && o.hash.trim()) return o.hash.trim();
    if (o.error) return formatMermaidError(o.error);
    if (Array.isArray(o.errors) && o.errors.length > 0) {
      return o.errors.map(formatMermaidError).filter(Boolean).join("；");
    }
  }
  return "语法无效或内容过于复杂";
}
