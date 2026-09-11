"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchContradictions } from "@/lib/api";

type ContradictionItem = {
  record_id: number;
  file_name: string;
  wiki_file_name: string;
  other_record_id: number;
  other_file_name?: string;
  other_wiki_file_name?: string;
  overlap_tags: string[];
  note: string;
};

export default function TrustPage() {
  const [items, setItems] = useState<ContradictionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchContradictions(80)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="page trust-page">
      <header className="page-head trust-page__head">
        <div className="page-head__main">
          <p className="page-head__eyebrow">质量检查</p>
          <h1 className="page-head__title trust-page__title">观点对照</h1>
          <p className="page-head__sub trust-page__sub">
            文库中检测到的摘要或标签矛盾，便于你自行辨析
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/library" className="btn btn-secondary btn-sm">
            去文库
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="page-loading" style={{ minHeight: "24vh" }}>
          <div className="app-spinner app-spinner--sm" role="status" aria-label="加载中" />
          <p className="page-loading__text">加载对照列表…</p>
        </div>
      ) : null}
      {error ? <p className="feed-center__text feed-center__text--err">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="trust-page__empty">
          <p>暂未发现矛盾。上传更多材料后，系统会自动比对观点差异。</p>
        </div>
      ) : null}

      <ul className="trust-page__list">
        {items.map((it) => (
          <li key={`${it.record_id}-${it.other_record_id}`} className="trust-page__item">
            <h2 className="trust-page__item-title">
              {it.file_name}
              <span className="trust-page__item-vs"> ↔ </span>
              {it.other_file_name || `材料 #${it.other_record_id}`}
            </h2>
            <p className="trust-page__item-note">{it.note || "检测到潜在观点冲突"}</p>
            {it.overlap_tags?.length ? (
              <p className="trust-page__tags">重叠标签：{it.overlap_tags.join("、")}</p>
            ) : null}
            <div className="trust-page__actions">
              {it.wiki_file_name ? (
                <Link href={`/library?wiki=${encodeURIComponent(it.wiki_file_name)}`} className="btn btn-ghost btn-sm">
                  打开「{it.file_name}」
                </Link>
              ) : null}
              {it.other_wiki_file_name ? (
                <Link
                  href={`/library?wiki=${encodeURIComponent(it.other_wiki_file_name)}`}
                  className="btn btn-ghost btn-sm"
                >
                  打开「{it.other_file_name || "对照篇"}」
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
