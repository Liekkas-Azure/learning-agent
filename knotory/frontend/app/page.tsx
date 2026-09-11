import FlashcardFeed from "@/components/feed/FlashcardFeed";
import OnboardingGate from "@/components/OnboardingGate";
import QuickStartSheet from "@/components/onboarding/QuickStartSheet";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "推荐流 — Knotory",
  description: "刷懂知识点闪卡；看不懂就重写，搞懂后保存映射。",
  robots: { index: false, follow: true },
};

export default function FeedPage() {
  return (
    <OnboardingGate>
      <main className="feed-page">
        <QuickStartSheet />
        <FlashcardFeed />
      </main>
    </OnboardingGate>
  );
}
