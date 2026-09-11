"use client";

import { Suspense } from "react";
import ExamPageClient from "./ExamPageClient";

export default function ExamPage() {
  return (
    <Suspense fallback={<main className="page exam-page"><p>加载测验…</p></main>}>
      <ExamPageClient />
    </Suspense>
  );
}
