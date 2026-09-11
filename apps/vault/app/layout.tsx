import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { PwaServiceWorkerUpdater } from "@/components/PwaServiceWorkerUpdater";
import { UiPreferencesControls } from "@/components/UiPreferencesControls";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "个人知识库",
  description: "跨平台摘录、标签归类、检索与关系草图",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "知识库",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#030712",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body className="min-h-dvh font-sans antialiased text-slate-100">
        <PwaServiceWorkerUpdater />
        <div className="ai-ambient" aria-hidden />
        <div className="ai-shell flex min-h-dvh flex-col">
          <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#030712]/75 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
              <Link href="/" className="group flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/20 to-cyan-500/15 shadow-glow-violet">
                  <span className="text-lg" aria-hidden>
                    ◈
                  </span>
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold tracking-tight ai-title-gradient">知识库</span>
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
                    Vault
                  </span>
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <nav className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-black/20 p-1">
                  <NavLink href="/">全部</NavLink>
                  <NavLink href="/graph">关系图</NavLink>
                  <NavLink href="/digest">Digest</NavLink>
                  <NavLink href="/observability">观测</NavLink>
                </nav>
                <UiPreferencesControls />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10 animate-fade-in">
            {children}
          </main>
          <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-slate-600">
            摘录 · 标签 · 检索 · 关系草图
          </footer>
        </div>
      </body>
    </html>
  );
}
