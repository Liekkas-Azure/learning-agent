"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import FeynmanSession from "@/components/feynman/FeynmanSession";

export default function FeynmanPageClient() {
  const params = useSearchParams();
  const raw = params.get("card");
  const cardId = raw ? parseInt(raw, 10) : NaN;
  const initialCardId = Number.isFinite(cardId) && cardId > 0 ? cardId : null;

  return (
    <main className="page feynman-page">
      <header className="page-head feynman-page__head">
        <div className="page-head__main">
          <p className="page-head__eyebrow">深度理解</p>
          <h1 className="page-head__title">费曼讲解</h1>
          <p className="page-head__sub">
            用自己的话讲出来 · AI 帮你找理解缺口 · 讲清楚再记入掌握
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/review" className="btn btn-secondary btn-sm">
            间隔复习
          </Link>
        </div>
      </header>

      <FeynmanSession initialCardId={initialCardId} />
    </main>
  );
}
