"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DomainChart({ data }: { data: { name: string; count: number }[] }) {
  if (data.length === 0) return null;
  return (
    <section className="ai-card h-72 p-3 sm:p-4">
      <h2 className="ai-section-label mb-1 px-1 pt-1">域名分布</h2>
      <p className="mb-2 px-1 font-mono text-[10px] text-slate-600">by_domain</p>
      <ResponsiveContainer width="100%" height="78%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              background: "rgba(7, 11, 20, 0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <defs>
            <linearGradient id="barAi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.85} />
            </linearGradient>
          </defs>
          <Bar dataKey="count" fill="url(#barAi)" radius={[6, 6, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
