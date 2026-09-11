import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { PwaServiceWorkerUpdater } from "@/components/PwaServiceWorkerUpdater";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learning SaaS — 多学科学习",
  description: "聚合资料、多模态辅助、碎片化学习与持续更新",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Learning SaaS",
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

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

const vaultAppUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_VAULT_APP_URL?.trim() ?? "");
const hkAppUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_HK_APP_URL?.trim() ?? "");

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
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 shadow-glow-cyan">
                  <svg
                    className="h-5 w-5 text-cyan-200"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                    />
                  </svg>
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold tracking-tight ai-title-gradient">Learning</span>
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
                    AI Study
                  </span>
                </span>
              </Link>
              <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-black/20 p-1">
                <NavLink href="/">主题</NavLink>
                {vaultAppUrl ? (
                  <Link
                    href={vaultAppUrl}
                    className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
                    target="_blank"
                    rel="noreferrer"
                  >
                    知识库
                  </Link>
                ) : null}
                <NavLink href="/coverage">洞察</NavLink>
                {hkAppUrl ? (
                  <Link
                    href={hkAppUrl}
                    className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
                    target="_blank"
                    rel="noreferrer"
                  >
                    港股
                  </Link>
                ) : null}
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10 animate-fade-in">
            {children}
          </main>
          <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-slate-600">
            智能选源 · 结构化学习 · 碎片化复习
          </footer>
        </div>
      </body>
    </html>
  );
}
