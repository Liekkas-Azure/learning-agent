import { prisma } from "@learning-saas/db";
import { embedTextLocal } from "@/lib/vector";
import { ensureVaultTopic } from "@/lib/vault-topic";

function splitChunks(text: string, max = 800) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const out: string[] = [];
  for (let i = 0; i < cleaned.length; i += max) {
    out.push(cleaned.slice(i, i + max));
  }
  return out.slice(0, 24);
}

export async function upsertVaultIndexDoc(params: {
  orgId: string;
  entryId: string;
  title: string;
  body: string;
  url?: string | null;
  origin?: string | null;
}) {
  const topic = await ensureVaultTopic(params.orgId);
  const canonicalUrl = `vault://entry/${params.entryId}`;
  const url = params.url?.trim() || canonicalUrl;
  const text = `${params.title}\n${params.body}`.trim();

  const doc = await prisma.document.upsert({
    where: { topicId_canonicalUrl: { topicId: topic.id, canonicalUrl } },
    create: {
      topicId: topic.id,
      url,
      canonicalUrl,
      title: params.title,
      excerpt: params.body.slice(0, 280) || null,
      bodyText: text.slice(0, 40_000) || null,
      domain: params.origin?.trim() || "vault",
      embeddingModel: "local-hash-v1",
      embedding: embedTextLocal(text) as unknown as object,
    },
    update: {
      title: params.title,
      url,
      excerpt: params.body.slice(0, 280) || null,
      bodyText: text.slice(0, 40_000) || null,
      domain: params.origin?.trim() || "vault",
      embeddingModel: "local-hash-v1",
      embedding: embedTextLocal(text) as unknown as object,
      fetchedAt: new Date(),
    },
  });

  await prisma.chunk.deleteMany({ where: { documentId: doc.id } });
  const chunks = splitChunks(text);
  for (let i = 0; i < chunks.length; i += 1) {
    await prisma.chunk.create({
      data: {
        documentId: doc.id,
        position: i,
        content: chunks[i],
        embedding: embedTextLocal(chunks[i]) as unknown as object,
      },
    });
  }
}

export async function removeVaultIndexDoc(orgId: string, entryId: string) {
  const topic = await ensureVaultTopic(orgId);
  const canonicalUrl = `vault://entry/${entryId}`;
  await prisma.document.deleteMany({
    where: { topicId: topic.id, canonicalUrl },
  });
}
