"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchAuthMe, fetchKnotoryHealth } from "@/lib/api";
import { authRequiredFromEnv, clearAuthSession, getAuthUser, isLoggedIn } from "@/lib/auth";

const mainNav = [
  { href: "/welcome", label: "首页" },
  { href: "/", label: "推荐" },
  { href: "/library", label: "文库" },
  { href: "/digest", label: "摘要" },
  { href: "/learning-path", label: "路径" },
  { href: "/feynman", label: "费曼" },
  { href: "/chat", label: "问答" },
];

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [runtimeLabel, setRuntimeLabel] = useState("运行中");
  const [authUser, setAuthUser] = useState(() => (typeof window !== "undefined" ? getAuthUser() : null));
  const [authRequired, setAuthRequired] = useState(authRequiredFromEnv());

  useEffect(() => {
    void fetchKnotoryHealth().then((h) => {
      if (!h) {
        setRuntimeLabel("未连接后端");
        return;
      }
      if (h.auth_required) setAuthRequired(true);
      if (h.checks?.llm_configured) {
        setRuntimeLabel("已就绪");
      } else {
        setRuntimeLabel("待配置模型");
      }
    });
    if (isLoggedIn()) {
      void fetchAuthMe().then((u) => {
        if (u) setAuthUser(u);
      });
    }
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/welcome" className="site-brand">
          <span className="site-brand__mark-wrap" aria-hidden>
            <span className="site-brand__mark" />
            <span className="site-brand__pulse" title={runtimeLabel} />
          </span>
          <div className="site-brand__stack">
            <span className="site-brand__text">Knotory</span>
            <span className="site-brand__tagline">你的文库，刷懂知识点</span>
          </div>
        </Link>
        <div className="site-header__end">
          <nav className="site-nav" aria-label="主导航">
            {mainNav.map(({ href, label }) => {
              const active = isNavActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`site-nav__link${active ? " site-nav__link--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          {authRequired ? (
            authUser ? (
              <div className="site-header__user">
                <span className="site-header__user-label" title={authUser.email}>
                  {authUser.display_name || authUser.email.split("@")[0]}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    clearAuthSession();
                    setAuthUser(null);
                    router.replace("/login");
                  }}
                >
                  退出
                </button>
              </div>
            ) : (
              <Link href="/login" className="btn btn-secondary btn-sm site-header__login">
                登录
              </Link>
            )
          ) : null}
        </div>
      </div>
    </header>
  );
}
