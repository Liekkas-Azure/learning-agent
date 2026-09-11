"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { completeOnboarding, isOnboardingDone } from "@/lib/onboarding";
import { enableDemoMode } from "@/lib/productPrefs";
import { getCloudDemoUrl } from "@/lib/cloudDemo";

type Props = {
  onStartDemo?: () => void;
};

export default function QuickStartSheet({ onStartDemo }: Props) {
  const router = useRouter();
  /** 仅客户端读取 localStorage，避免 SSR/CSR 不一致导致遮罩层事件失效 */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(!isOnboardingDone());
  }, []);

  if (!open) return null;

  const finish = () => {
    completeOnboarding();
    setOpen(false);
  };

  const startDemo = () => {
    enableDemoMode();
    finish();
    onStartDemo?.();
    window.dispatchEvent(new Event("knotory-demo-start"));
  };

  const goLibrary = () => {
    finish();
    router.push("/library");
  };

  const skip = () => {
    enableDemoMode();
    finish();
    onStartDemo?.();
    window.dispatchEvent(new Event("knotory-demo-start"));
  };

  return (
    <div className="quick-start" role="dialog" aria-modal="true" aria-labelledby="quick-start-title">
      <div className="quick-start__backdrop" aria-hidden onClick={skip} />
      <div className="quick-start__sheet">
        <p className="quick-start__eyebrow">30 秒上手</p>
        <h2 id="quick-start-title" className="quick-start__title">
          把长文刷成懂的知识点
        </h2>
        <p className="quick-start__lead">
          无需先上传：可先刷示例卡感受「易懂闪卡」；上传文库后会从你的材料拆卡。
        </p>
        <ul className="quick-start__tips">
          <li>
            <strong>不懂</strong> → 换生活类比、分步骤等讲法
          </li>
          <li>
            <strong>保存</strong> → 记住你认可的那版，相关内容优先弹出
          </li>
          <li>
            <strong>每日 5 张</strong> → 小步坚持，到期会自动提醒复习
          </li>
        </ul>
        <div className="quick-start__actions">
          <button type="button" className="btn btn-primary" onClick={startDemo}>
            先刷示例卡
          </button>
          <button type="button" className="btn btn-secondary" onClick={goLibrary}>
            上传我的文库
          </button>
          <button type="button" className="btn btn-ghost btn-sm quick-start__skip" onClick={skip}>
            跳过，直接刷示例
          </button>
        </div>
        <p className="quick-start__foot">
          完整介绍见 <Link href="/welcome">首页</Link>
          {getCloudDemoUrl() ? (
            <>
              {" "}
              ·{" "}
              <a href={getCloudDemoUrl()!} target="_blank" rel="noopener noreferrer">
                云端试用
              </a>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
