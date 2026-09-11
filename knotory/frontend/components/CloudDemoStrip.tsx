"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchKnotoryHealth } from "@/lib/api";
import { getCloudDemoUrl, isCloudDemoInstance, shouldOfferCloudDemo } from "@/lib/cloudDemo";

type Props = {
  /** 强制显示云端试用 CTA（忽略 health 检测） */
  forceOffer?: boolean;
  compact?: boolean;
};

export default function CloudDemoStrip({ forceOffer = false, compact = false }: Props) {
  const [offer, setOffer] = useState(forceOffer);
  const cloudUrl = getCloudDemoUrl();
  const isCloud = isCloudDemoInstance();

  useEffect(() => {
    if (forceOffer) {
      setOffer(true);
      return;
    }
    void fetchKnotoryHealth().then((h) => {
      setOffer(shouldOfferCloudDemo(h?.checks?.llm_configured));
    });
  }, [forceOffer]);

  if (isCloud) {
    return (
      <p className={`cloud-demo-strip cloud-demo-strip--hosted${compact ? " cloud-demo-strip--compact" : ""}`} role="status">
        云端试用 · 已配置模型，可直接上传刷读
        {!compact ? (
          <>
            {" "}
            · <Link href="/">去推荐流</Link>
          </>
        ) : null}
      </p>
    );
  }

  if (!offer || !cloudUrl) return null;

  return (
    <div className={`cloud-demo-strip cloud-demo-strip--cta${compact ? " cloud-demo-strip--compact" : ""}`} role="region" aria-label="云端试用">
      <p>
        本地未配置大模型？可先体验{" "}
        <a href={cloudUrl} target="_blank" rel="noopener noreferrer" className="cloud-demo-strip__link">
          Knotory 云端 Demo
        </a>
        ，无需 API Key。
      </p>
      {!compact ? (
        <a href={cloudUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
          打开云端试用
        </a>
      ) : null}
    </div>
  );
}
