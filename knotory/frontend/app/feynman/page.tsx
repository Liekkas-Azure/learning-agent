import { Suspense } from "react";
import FeynmanPageClient from "./FeynmanPageClient";

export default function FeynmanPage() {
  return (
    <Suspense
      fallback={
        <main className="page feynman-page">
          <p className="page-loading">加载费曼讲解…</p>
        </main>
      }
    >
      <FeynmanPageClient />
    </Suspense>
  );
}
