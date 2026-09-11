import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "问答 — Knotory",
  description: "基于你的文库检索作答，附带出处引用。",
  robots: { index: false, follow: true },
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
