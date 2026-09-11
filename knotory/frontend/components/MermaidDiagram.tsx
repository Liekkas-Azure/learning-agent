"use client";

import { useEffect, useId, useRef } from "react";
import {
  formatMermaidError,
  isLikelyMermaidChart,
  prepareMermaidChart,
} from "@/lib/mermaidChart";

export default function MermaidDiagram({
  chart,
  className = "wiki-mermaid-host",
  onFailed,
}: {
  chart: string;
  className?: string;
  onFailed?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const runId = useId().replace(/:/g, "");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const showFallback = () => {
      if (cancelled) return;
      host.replaceChildren();
      const hint = document.createElement("p");
      hint.className = "wiki-mermaid-fallback";
      hint.textContent = "示意图暂不可用";
      host.appendChild(hint);
      onFailedRef.current?.();
    };

    const prepared = prepareMermaidChart(chart);
    if (!prepared || !isLikelyMermaidChart(prepared)) {
      showFallback();
      return () => {
        cancelled = true;
        host.replaceChildren();
      };
    }

    void (async () => {
      const mermaid = (await import("mermaid")).default;
      if (cancelled) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        suppressErrorRendering: true,
        fontFamily:
          'var(--font-sans), ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
      });

      host.replaceChildren();
      const renderId = `mermaid-${runId}-${Math.random().toString(36).slice(2, 9)}`;

      try {
        const valid = await mermaid.parse(prepared, { suppressErrors: true });
        if (!valid) {
          throw new Error("Mermaid 语法无效");
        }
        const { svg, bindFunctions } = await mermaid.render(renderId, prepared);
        if (cancelled) return;
        const wrap = document.createElement("div");
        wrap.className = "wiki-mermaid-svg";
        wrap.innerHTML = svg;
        host.appendChild(wrap);
        bindFunctions?.(wrap);
      } catch (e) {
        console.warn("Mermaid render failed:", formatMermaidError(e), e);
        showFallback();
      }
    })();

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [chart, runId]);

  return <div ref={hostRef} className={className} role="img" aria-label="示意图" />;
}
