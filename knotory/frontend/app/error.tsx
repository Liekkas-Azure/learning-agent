"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page feed-center">
      <h1 className="feed-center__title">页面出错了</h1>
      <p className="feed-center__text feed-center__text--err">
        {error.message || "未知错误。若刚更新过代码，可尝试硬刷新或重启前端 dev。"}
      </p>
      <div className="feed-center__actions">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          重试
        </button>
        <Link href="/" className="btn btn-secondary">
          回推荐
        </Link>
        <Link href="/library" className="btn btn-ghost">
          文库
        </Link>
      </div>
    </main>
  );
}
