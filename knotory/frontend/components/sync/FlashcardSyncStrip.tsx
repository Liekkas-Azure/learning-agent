"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { syncStageLabel } from "@/lib/flashcardSyncUi";
import { useFlashcardPipelinePoll } from "@/lib/useFlashcardPipelinePoll";
import { isLoggedIn } from "@/lib/auth";
import FlashcardSyncProgress from "@/components/sync/FlashcardSyncProgress";

export default function FlashcardSyncStrip() {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, [pathname]);

  const { pipeline, completeNotice, busy, watching, clearCompleteNotice } = useFlashcardPipelinePoll(loggedIn);

  if (!loggedIn) return null;

  if (!pipeline) {
    if (!watching) return null;
    return (
      <div className="flashcard-sync-strip" role="region" aria-label="入库与拆卡进度">
        <div className="flashcard-sync-strip__inner">
          <p className="flashcard-sync-strip__stage">正在连接入库与拆卡进度…</p>
        </div>
      </div>
    );
  }

  const sync = pipeline.flashcard_sync;
  const ingestActive = (pipeline.ingest.active_count ?? 0) > 0;
  const syncRunning = Boolean(sync?.running);
  const syncQueued = Boolean(sync?.queued);
  const processingRecords = pipeline.wiki_items?.some((item) => item.status === "processing") ?? false;
  const show =
    ingestActive ||
    syncRunning ||
    syncQueued ||
    processingRecords ||
    watching ||
    Boolean(completeNotice) ||
    Boolean(sync?.error);

  if (!show) return null;

  const onLibrary = pathname === "/library" || pathname.startsWith("/library/");

  return (
    <div
      className={`flashcard-sync-strip${completeNotice ? " flashcard-sync-strip--done" : ""}${
        sync?.error ? " flashcard-sync-strip--error" : ""
      }`}
      role="region"
      aria-label="入库与拆卡进度"
    >
      <div className="flashcard-sync-strip__inner">
        {completeNotice ? (
          <div className="flashcard-sync-strip__done">
            <span>{completeNotice}</span>
            <Link href="/" className="flashcard-sync-strip__link">
              去刷推荐流
            </Link>
            <button
              type="button"
              className="flashcard-sync-strip__dismiss"
              aria-label="关闭"
              onClick={() => clearCompleteNotice()}
            >
              ×
            </button>
          </div>
        ) : null}

        {!completeNotice && ingestActive ? (
          <ul className="flashcard-sync-strip__ingest">
            {pipeline.ingest.active.map((job) => (
              <li key={job.record_id}>
                <span className="flashcard-sync-strip__file">{job.file_name}</span>
                <span className="flashcard-sync-strip__stage">{syncStageLabel(job.stage)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {!completeNotice && syncQueued && !syncRunning ? (
          <p className="flashcard-sync-strip__stage" role="status">
            拆卡任务排队中，前一批完成后将自动开始…
          </p>
        ) : null}

        {!completeNotice && syncRunning && sync ? (
          <FlashcardSyncProgress sync={sync} variant="inline" />
        ) : null}

        {!completeNotice && !syncRunning && !syncQueued && watching && !ingestActive && !processingRecords ? (
          <p className="flashcard-sync-strip__stage" role="status">
            入库与拆卡处理中，请稍候…
          </p>
        ) : null}

        {!completeNotice && !syncRunning && sync?.error ? (
          <p className="flashcard-sync-strip__error" role="alert">
            拆卡异常：{sync.error}
            {!onLibrary ? (
              <>
                {" "}
                <Link href="/library#library-pipeline">去文库重试</Link>
              </>
            ) : null}
          </p>
        ) : null}

        {!completeNotice && busy && !onLibrary ? (
          <Link href="/library#library-pipeline" className="flashcard-sync-strip__link">
            查看详情
          </Link>
        ) : null}
      </div>
    </div>
  );
}
