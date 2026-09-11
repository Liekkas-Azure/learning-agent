"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { GraphPayload } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <div className="graph-loading">正在加载图表组件…</div>,
});

type NodeObj = { id?: string; label?: string; group?: string };
type LinkObj = { source?: string; target?: string; kind?: string };

export function GraphCanvas({ data }: { data: GraphPayload }) {
  const [highlight, setHighlight] = useState<string | null>(null);

  const graphData = useMemo(() => {
    const nodes = data.nodes.map((n) => ({ ...n }));
    const links = data.links.map((l) => ({ ...l }));
    return { nodes, links };
  }, [data]);

  const nodeColor = useCallback(
    (node: object) => {
      const n = node as NodeObj;
      if (highlight && n.id === highlight) return "#ca8a04";
      return n.group === "document" ? "#404040" : "#a3a3a3";
    },
    [highlight],
  );

  return (
    <div className="graph-canvas-inner">
      <ForceGraph2D
        graphData={graphData}
        nodeLabel={(n: object) => (n as NodeObj).label ?? (n as NodeObj).id ?? ""}
        nodeColor={nodeColor}
        nodeRelSize={5}
        linkColor={(link: object) => {
          const k = (link as LinkObj).kind;
          if (k === "SHARED_TAG") return "rgba(0, 0, 0, 0.22)";
          if (k === "SHARED_SEMANTIC") return "rgba(202, 138, 4, 0.45)";
          if (k === "SIMILAR_TAG") return "rgba(163, 163, 163, 0.55)";
          return "rgba(0, 0, 0, 0.12)";
        }}
        linkWidth={(link: object) => {
          const k = (link as LinkObj).kind;
          if (k === "SHARED_TAG") return 2.1;
          if (k === "SHARED_SEMANTIC") return 1.85;
          if (k === "SIMILAR_TAG") return 1.2;
          return 1.25;
        }}
        backgroundColor="#fafaf9"
        onNodeClick={(n: object) => {
          const id = (n as NodeObj).id ?? "";
          setHighlight(id || null);
          if (id.startsWith("doc:")) {
            const slug = id.slice(4);
            const wiki = slug.includes(".") ? slug : `${slug}.md`;
            window.location.href = `/library?wiki=${encodeURIComponent(wiki)}`;
          }
        }}
        cooldownTicks={100}
      />
    </div>
  );
}
