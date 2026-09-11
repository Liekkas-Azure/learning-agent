import { Suspense } from "react";
import { VaultApp } from "@/components/vault/VaultApp";

export default function VaultHomePage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-12 text-center text-sm text-slate-500">
          加载知识库…
        </div>
      }
    >
      <VaultApp />
    </Suspense>
  );
}
