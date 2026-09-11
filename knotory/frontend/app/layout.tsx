import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import AuthGate from "@/components/auth/AuthGate";
import FlashcardSyncStrip from "@/components/sync/FlashcardSyncStrip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata = {
  title: {
    default: "Knotory — 你的文库，刷懂知识点",
    template: "%s",
  },
  description:
    "Knotory：从你上传的材料拆易懂闪卡；系统记住你的讲法偏好；推荐流与每日摘要让你随时随地轻量学习，并可导出笔记与闪卡。",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body className="app-body">
        <SiteHeader />
        <FlashcardSyncStrip />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}

