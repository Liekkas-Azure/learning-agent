import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import { cosineSimilarity, embedTextLocal, parseEmbedding } from "@/lib/vector";
import { ensureVaultTopic } from "@/lib/vault-topic";
import { doubaoStructured } from "@/lib/doubao";

export async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  const topic = await ensureVaultTopic(orgId);
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const take = Math.min(20, Math.max(3, Number.parseInt(searchParams.get("take") ?? "10", 10) || 10));

  const queryEmbedding = embedTextLocal(q);
  const chunks = await prisma.chunk.findMany({
    where: { document: { topicId: topic.id } },
    select: {
      id: true,
      content: true,
      embedding: true,
      position: true,
      document: {
        select: {
          id: true,
          title: true,
          canonicalUrl: true,
          url: true,
          domain: true,
          fetchedAt: true,
        },
      },
    },
    take: 600,
    orderBy: { createdAt: "desc" },
  });

  const ranked = chunks
    .map((ch) => {
      const emb = parseEmbedding(ch.embedding);
      if (!emb) return null;
      const score = cosineSimilarity(queryEmbedding, emb);
      return {
        score,
        chunkId: ch.id,
        snippet: ch.content.slice(0, 240),
        position: ch.position,
        document: ch.document,
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(take, 12));

  const ai = await doubaoStructured<{ scores: Array<{ chunkId: string; score: number }> }>({
    prompt: `你是语义检索重排器。根据用户问题给每个候选片段打0-1分，输出 JSON：{"scores":[{"chunkId":"","score":0.0}]}\n问题:${q}\n候选:${JSON.stringify(
      ranked.map((r) => ({ chunkId: r.chunkId, title: r.document.title, snippet: r.snippet })),
    )}`,
    fallback: { scores: [] },
    orgId,
    module: "semantic_rerank",
  });
  const scoreMap = new Map(ai.scores.map((v) => [v.chunkId, v.score]));
  const reranked = ranked
    .map((r) => ({ ...r, score: scoreMap.get(r.chunkId) ?? r.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take);

  return NextResponse.json({ results: reranked });
}
