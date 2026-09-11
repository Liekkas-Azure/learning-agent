"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { completeOnboarding, dismissLibraryGuide, isLibraryGuideDismissed } from "@/lib/onboarding";

const STEPS = [
  { n: "1", text: "上传你的材料（只从可信来源拆卡）" },
  { n: "2", text: "等待拆成易懂闪卡，不懂可随时换讲法" },
  { n: "3", text: "刷推荐流 / 看摘要，搞懂后保存并导出" },
] as const;

export default function LibraryOnboardingBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!isLibraryGuideDismissed());
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    dismissLibraryGuide();
    completeOnboarding();
    setVisible(false);
  };

  return (
    <section className="library-onboarding card card--desk" aria-label="新手指引">
      <div className="library-onboarding__head">
        <div>
          <p className="card__kicker">开始</p>
          <h2 className="card__title">三步：上传 → 刷懂 → 导出</h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          知道了
        </button>
      </div>
      <ol className="library-onboarding__steps">
        {STEPS.map((s) => (
          <li key={s.n} className="library-onboarding__step">
            <span className="library-onboarding__n" aria-hidden>
              {s.n}
            </span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="library-onboarding__actions">
        <Link href="/" className="btn btn-primary btn-sm" onClick={dismiss}>
          去推荐流
        </Link>
        <Link href="/digest" className="btn btn-secondary btn-sm" onClick={dismiss}>
          今日摘要
        </Link>
      </div>
    </section>
  );
}
