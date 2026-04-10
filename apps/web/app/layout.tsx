import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  themeColor: "#0ea5e9",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-slate-950 text-slate-100 antialiased`}>
        <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight text-sky-400">
              Learning SaaS
            </Link>
            <nav className="flex flex-wrap gap-3 text-sm text-slate-400">
              <Link href="/" className="hover:text-sky-300">
                主题
              </Link>
              <Link href="/hk" className="hover:text-sky-300">
                港股看板
              </Link>
              <Link href="/coverage" className="hover:text-sky-300">
                覆盖
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
