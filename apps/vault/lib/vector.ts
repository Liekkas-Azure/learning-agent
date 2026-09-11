export const VECTOR_DIM = 192;

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function hashToken(token: string) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function embedTextLocal(text: string): number[] {
  const vec = new Array<number>(VECTOR_DIM).fill(0);
  const tokens = tokenize(text).slice(0, 3000);
  if (tokens.length === 0) return vec;
  for (const t of tokens) {
    const h = hashToken(t);
    const idx = h % VECTOR_DIM;
    vec[idx] += 1 + (t.length % 3) * 0.2;
  }
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm <= 1e-12) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 1e-12 || nb <= 1e-12) return 0;
  return dot / Math.sqrt(na * nb);
}

export function parseEmbedding(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const v = input.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0));
  if (v.length < 8) return null;
  return v;
}
