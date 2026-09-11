"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GraphCanvas } from "@/components/GraphCanvas";
import { fetchGraph, type GraphPayload } from "@/lib/api";

export default function GraphPage() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setError(null);
      setLoading(true);
      const g = await fetchGraph();
      setData(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "关系图加载失败，请稍后重试。");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const nodeCount = data?.nodes?.length ?? 0;
  const linkCount = data?.links?.length ?? 0;

  return (
    <main className="shell">
      <header className="hero hero--atlas">
        <div className="hero__spark-row">
          <span className="hero__spark hero__spark--dim" aria-hidden />
          <p className="hero__eyebrow">文库 · 主题关系</p>
        </div>
        <h1 className="hero__title">篇目之间的关联</h1>
        <p className="hero__lead">
          圆点为文库篇目，连线表示标签或主题相近。<strong>仅包含你已上传的内容。</strong>
        </p>
      </header>

      <p className="graph-hint">可拖动、缩放；点击节点打开对应篇目。小屏建议横屏浏览。</p>

      <div className="graph-toolbar">
        <div className="graph-stats">
          <span className="stat-pill">
            节点 <span>{loading ? "…" : nodeCount}</span>
          </span>
          <span className="stat-pill">
            连线 <span>{loading ? "…" : linkCount}</span>
          </span>
          {data ? (
            <span className="stat-pill">
              数据源 <span>{data.source === "neo4j" ? "云端图库" : "本地索引"}</span>
            </span>
          ) : null}
        </div>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          <Link href="/" className="btn btn-ghost" style={{ display: "inline-flex" }}>
            回推荐流
          </Link>
        </div>
      </div>

      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !data ? <div className="graph-loading">正在生成布局…</div> : null}

      {data ? (
        <div className="graph-canvas-wrap graph-canvas-wrap--night">
          <GraphCanvas data={data} />
        </div>
      ) : null}

      {!loading && !data && !error ? (
        <div className="empty-state">
          <div className="empty-state__deco" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          暂无数据。请先在文库上传材料，再查看篇目关联。
        </div>
      ) : null}
    </main>
  );
}
