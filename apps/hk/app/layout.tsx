import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { PwaServiceWorkerUpdater } from "@/components/PwaServiceWorkerUpdater";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "港股量化看板",
  description: "行情、新闻与策略模拟",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "港股量化",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#030712",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function HkRootLayout({
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
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/20 to-emerald-500/15 shadow-glow-cyan">
                  <span className="text-lg" aria-hidden>
                    📈
                  </span>
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold tracking-tight ai-title-gradient">港股量化</span>
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
                    HK Lab
                  </span>
                </span>
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10 animate-fade-in">
            {children}
          </main>
          <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-slate-600">
            行情与新闻仅供参考，不构成投资建议
          </footer>
        </div>
      </body>
    </html>
  );
}
