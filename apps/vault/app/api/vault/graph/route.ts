import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";

export type VaultGraphNode = {
  id: string;
  label: string;
  kind: "entry" | "tag";
  entryKind?: string;
};

export type VaultGraphEdge = { source: string; target: string };

/**
 * 返回「条目—标签」二部图，便于在客户端绘制知识关系草图。
 */
export async function GET() {
  const { orgId } = await getOrgContext();

  const entries = await prisma.knowledgeEntry.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    take: 48,
    select: {
      id: true,
      kind: true,
      title: true,
      tags: { select: { id: true, name: true } },
    },
  });

  const nodes: VaultGraphNode[] = [];
  const edges: VaultGraphEdge[] = [];
  const seenTag = new Set<string>();

  for (const e of entries) {
    const eid = `e:${e.id}`;
    const label = e.title.length > 28 ? `${e.title.slice(0, 28)}…` : e.title;
    nodes.push({ id: eid, label, kind: "entry", entryKind: e.kind });
    for (const t of e.tags) {
      const tid = `t:${t.id}`;
      if (!seenTag.has(tid)) {
        seenTag.add(tid);
        const tlabel = t.name.length > 20 ? `${t.name.slice(0, 20)}…` : t.name;
        nodes.push({ id: tid, label: tlabel, kind: "tag" });
      }
      edges.push({ source: eid, target: tid });
    }
  }

  return NextResponse.json({ nodes, edges });
}
