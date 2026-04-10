import type { Job } from "bullmq";
import type { PrismaClient } from "@learning-saas/db";
import OpenAI from "openai";
import { consumeEmbedQuota } from "../lib/quota";
import type { EmbedPayload } from "../queue";

export async function processEmbed(prisma: PrismaClient, job: Job<EmbedPayload>): Promise<void> {
  const { orgId, documentId } = job.data;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await prisma.auditLog.create({
      data: {
        orgId,
        action: "embed.skipped",
        metadata: { documentId, reason: "no OPENAI_API_KEY" },
      },
    });
    return;
  }

  const ok = await consumeEmbedQuota(prisma, orgId);
  if (!ok) {
    throw new Error("Daily embed quota exceeded");
  }

  const openai = new OpenAI({ apiKey });
  const chunks = await prisma.chunk.findMany({
    where: { documentId },
    orderBy: { position: "asc" },
  });
  const model = "text-embedding-3-small";

  for (const ch of chunks) {
    const res = await openai.embeddings.create({
      model,
      input: ch.content.slice(0, 8000),
    });
    const vector = res.data[0]?.embedding;
    if (!vector) continue;
    await prisma.chunk.update({
      where: { id: ch.id },
      data: { embedding: vector as unknown as object },
    });
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { embeddingModel: model },
  });
}
