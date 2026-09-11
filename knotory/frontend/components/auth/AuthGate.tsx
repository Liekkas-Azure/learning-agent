"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authRequiredFromEnv, getAuthToken } from "@/lib/auth";
import { fetchAuthMe, fetchKnotoryHealth } from "@/lib/api";

const PUBLIC_PATHS = ["/login", "/register", "/welcome"];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

      if (!isPublic) {
        setReady(false);
      }

      if (isPublic) {
        if (!cancelled) setReady(true);
        return;
      }

      let required = authRequiredFromEnv();
      if (!required) {
        try {
          const h = await fetchKnotoryHealth();
          required = Boolean(h?.auth_required);
        } catch {
          required = true;
        }
      }

      const token = getAuthToken();
      if (required && !token) {
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }

      if (required && token) {
        const me = await fetchAuthMe();
        if (!me) {
          router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
          return;
        }
      }

      if (!cancelled) setReady(true);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="page-loading" style={{ minHeight: "40vh" }}>
        <div className="app-spinner app-spinner--sm" role="status" aria-label="加载中" />
      </div>
    );
  }

  return <>{children}</>;
}
