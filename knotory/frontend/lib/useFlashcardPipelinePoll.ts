"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPipelineStatus, type PipelineStatus } from "@/lib/api";
import { formatSyncCompleteMessage, pipelineIsBusy } from "@/lib/flashcardSyncUi";

const WATCH_MS = 45 * 60 * 1000;
const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 8000;

/** 上传/拆卡后一段时间内保持轮询，即使用户离开了文库页。 */
export function markFlashcardPipelineWatch(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("knotory_pipeline_watch_until", String(Date.now() + WATCH_MS));
  window.dispatchEvent(new Event("knotory-pipeline-watch"));
}

function shouldWatchSession(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.sessionStorage.getItem("knotory_pipeline_watch_until");
  if (!raw) return false;
  const until = parseInt(raw, 10);
  if (!Number.isFinite(until) || until < Date.now()) {
    window.sessionStorage.removeItem("knotory_pipeline_watch_until");
    return false;
  }
  return true;
}

export function useFlashcardPipelinePoll(enabled = true) {
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completeNotice, setCompleteNotice] = useState<string | null>(null);
  const [watching, setWatching] = useState(() => shouldWatchSession());
  const wasRunningRef = useRef(false);
  const wasIngestRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPipelineStatus();
      setPipeline(data);
      setError(null);

      const syncRunning = Boolean(data.flashcard_sync?.running);
      const syncQueued = Boolean(data.flashcard_sync?.queued);
      const ingestActive = (data.ingest.active_count ?? 0) > 0;
      const processingRecords = data.wiki_items?.some((item) => item.status === "processing") ?? false;
      const watch = shouldWatchSession();
      setWatching(watch);

      if (wasRunningRef.current && !syncRunning && !syncQueued && !data.flashcard_sync?.error) {
        const msg = formatSyncCompleteMessage(data.flashcard_sync?.result, data.totals);
        setCompleteNotice(msg);
        window.dispatchEvent(
          new CustomEvent("knotory-sync-complete", { detail: { message: msg, pipeline: data } }),
        );
        window.setTimeout(() => setCompleteNotice(null), 12_000);
      }
      if (wasRunningRef.current && !syncRunning && !syncQueued && data.flashcard_sync?.error) {
        setCompleteNotice(`拆卡失败：${String(data.flashcard_sync.error).slice(0, 120)}`);
        window.setTimeout(() => setCompleteNotice(null), 14_000);
      }

      wasRunningRef.current = syncRunning || syncQueued;
      wasIngestRef.current = ingestActive || processingRecords;

      if (!syncRunning && !syncQueued && !ingestActive && !processingRecords) {
        window.sessionStorage.removeItem("knotory_pipeline_watch_until");
        setWatching(false);
      }

      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "进度刷新失败");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    let cancelled = false;

    const tick = async () => {
      const data = await refresh();
      if (cancelled) return;
      const busyNow = data ? pipelineIsBusy(data) : false;
      const watch = shouldWatchSession();
      setWatching(watch);
      const delay = busyNow || watch ? POLL_BUSY_MS : POLL_IDLE_MS;
      timer = window.setTimeout(() => void tick(), delay);
    };

    const onWatch = () => {
      setWatching(true);
      void tick();
    };
    window.addEventListener("knotory-pipeline-watch", onWatch);
    window.addEventListener("knotory-corpus-updated", onWatch);

    void tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("knotory-pipeline-watch", onWatch);
      window.removeEventListener("knotory-corpus-updated", onWatch);
    };
  }, [enabled, refresh]);

  const busy = pipelineIsBusy(pipeline) || watching;

  return {
    pipeline,
    error,
    completeNotice,
    busy,
    watching,
    refresh,
    clearCompleteNotice: () => setCompleteNotice(null),
  };
}
