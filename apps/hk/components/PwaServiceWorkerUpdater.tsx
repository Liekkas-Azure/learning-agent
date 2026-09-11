"use client";

import { useEffect } from "react";

/**
 * 生产环境下在首屏与窗口重新聚焦时检查 Service Worker 更新，
 * 避免 next-pwa 长期持有旧版 `_next/static` 资源导致样式像「回到旧版」。
 */
export function PwaServiceWorkerUpdater() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const ping = () => {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        void reg?.update();
      });
    };

    ping();
    window.addEventListener("focus", ping);
    return () => window.removeEventListener("focus", ping);
  }, []);

  return null;
}
