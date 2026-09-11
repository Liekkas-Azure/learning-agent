import { prisma } from "@learning-saas/db";

const VAULT_TOPIC_TITLE = "Personal Knowledge Vault";

export async function ensureVaultTopic(orgId: string) {
  const existing = await prisma.topic.findFirst({
    where: { orgId, title: VAULT_TOPIC_TITLE },
  });
  if (existing) return existing;
  return prisma.topic.create({
    data: {
      orgId,
      title: VAULT_TOPIC_TITLE,
      description: "自动收集的个人知识库资料索引",
      language: "zh",
      goals: { product: "vault", type: "personal-knowledge" },
    },
  });
}
