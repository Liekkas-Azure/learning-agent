import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "文库 — Knotory",
  description: "上传材料、深读原稿与 AI 稿，自动拆成易懂知识点闪卡。",
  robots: { index: false, follow: true },
};

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
