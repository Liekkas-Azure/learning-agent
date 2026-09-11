"use client";

import { useMemo } from "react";
import type { VaultGraphEdge, VaultGraphNode } from "./types";

type Props = {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
  className?: string;
};

function layout(nodes: VaultGraphNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const tags = nodes.filter((n) => n.kind === "tag");
  const entries = nodes.filter((n) => n.kind === "entry");
  const w = 360;
  const h = 420;
  const cx = w / 2;
  const cy = h / 2;

  const rTag = Math.min(150, 55 + tags.length * 4);
  tags.forEach((t, i) => {
    const a = (i / Math.max(1, tags.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(t.id, { x: cx + Math.cos(a) * rTag, y: cy + Math.sin(a) * rTag });
  });

  const rEntry = Math.max(42, Math.min(95, 140 - entries.length * 1.2));
  entries.forEach((t, i) => {
    const a = (i / Math.max(1, entries.length)) * Math.PI * 2 + 0.35;
    pos.set(t.id, { x: cx + Math.cos(a) * rEntry, y: cy + Math.sin(a) * rEntry });
  });

  if (tags.length === 0 && entries.length === 1) {
    pos.set(entries[0]!.id, { x: cx, y: cy });
  }
  if (entries.length === 0 && tags.length === 1) {
    pos.set(tags[0]!.id, { x: cx, y: cy });
  }

  return pos;
}

export function VaultGraphView({ nodes, edges, className }: Props) {
  const positions = useMemo(() => layout(nodes), [nodes]);
  const w = 360;
  const h = 420;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label="知识条目与标签关系图"
    >
      <defs>
        <linearGradient id="vault-edge" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(34,211,238,0.15)" />
          <stop offset="100%" stopColor="rgba(167,139,250,0.35)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={w} height={h} rx="18" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.08)" />
      {edges.map((e, idx) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        return (
          <line
            key={`${e.source}-${e.target}-${idx}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="url(#vault-edge)"
            strokeWidth={1.25}
          />
        );
      })}
      {nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const isTag = n.kind === "tag";
        const r = isTag ? 11 : 8;
        return (
          <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
            <circle
              r={r}
              fill={isTag ? "rgba(167,139,250,0.35)" : "rgba(34,211,238,0.35)"}
              stroke={isTag ? "rgba(167,139,250,0.65)" : "rgba(34,211,238,0.65)"}
              strokeWidth={1}
            />
            <text
              y={r + 14}
              textAnchor="middle"
              fill="rgba(241,245,249,0.82)"
              fontSize={isTag ? 11 : 10}
              className="select-none"
            >
              {n.label.length > 14 && !isTag ? `${n.label.slice(0, 14)}…` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
