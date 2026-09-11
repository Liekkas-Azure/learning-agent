"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VaultGraphView } from "./VaultGraphView";
import type { VaultGraphEdge, VaultGraphNode } from "./types";

export function VaultGraphPage() {
  const [nodes, setNodes] = useState<VaultGraphNode[]>([]);
  const [edges, setEdges] = useState<VaultGraphEdge[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vault/graph");
        if (!res.ok) throw new Error("加载失败");
        const data = (await res.json()) as { nodes: VaultGraphNode[]; edges: VaultGraphEdge[] };
        if (!cancelled) {
          setNodes(data.nodes);
          setEdges(data.edges);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 pb-24 sm:pb-8">
      <div>
        <Link href="/" className="text-sm font-medium text-slate-500 transition hover:text-cyan-300/90">
          ← 知识库
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          <span className="ai-title-gradient">关系草图</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          以最近更新的条目为中心，展示其与标签之间的连接。适合在手机上快速扫一眼知识结构。
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100/90">
          {err}
        </div>
      ) : null}

      <div className="mx-auto max-w-md">
        <VaultGraphView nodes={nodes} edges={edges} className="h-auto w-full drop-shadow-lg" />
      </div>

      <p className="text-center text-xs text-slate-600">
        青点：知识条目 · 紫点：标签 · 线：归属关系
      </p>
    </div>
  );
}
