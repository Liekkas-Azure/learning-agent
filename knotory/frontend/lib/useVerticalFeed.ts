"use client";

import { useEffect, useState } from "react";

const MQ = "(max-width: 640px)";

/** 移动端竖屏 Feed：上下滑动换卡 */
export function useVerticalFeed(): boolean {
  const [vertical, setVertical] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const sync = () => setVertical(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return vertical;
}
