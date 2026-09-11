"use client";

import { useState, type ReactNode } from "react";
import { apiUsesAuth, downloadKnotoryResource } from "@/lib/api";

type Props = {
  href: string;
  filename: string;
  className?: string;
  children: ReactNode;
};

/** 启用 API Key 时用 fetch + Blob 下载；否则普通 <a download>。 */
export default function KnotoryDownloadLink({ href, filename, className, children }: Props) {
  const [busy, setBusy] = useState(false);

  if (!apiUsesAuth()) {
    return (
      <a className={className} href={href} download={filename}>
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void downloadKnotoryResource(href, filename)
          .catch((e) => {
            window.alert(e instanceof Error ? e.message : "下载失败");
          })
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "下载中…" : children}
    </button>
  );
}
