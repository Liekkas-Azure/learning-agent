"use client";

import { useEffect, useState } from "react";

type Props = {
  children: React.ReactNode;
};

/** 等待客户端 hydration，不再强制跳转 welcome（改由 QuickStartSheet 轻量引导）。 */
export default function OnboardingGate({ children }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="page page-loading">
        <div className="app-spinner" role="status" aria-label="加载中" />
        <p className="page-loading__text">加载中…</p>
      </main>
    );
  }

  return <>{children}</>;
}
