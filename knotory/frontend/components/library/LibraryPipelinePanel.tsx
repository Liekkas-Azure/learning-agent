"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { syncFlashcardsFromCorpus, type PipelineWikiItem } from "@/lib/api";
import { formatRecordStatus } from "@/lib/recordStatus";
import { syncStageLabel } from "@/lib/flashcardSyncUi";
import { markFlashcardPipelineWatch, useFlashcardPipelinePoll } from "@/lib/useFlashcardPipelinePoll";
import FlashcardSyncProgress from "@/components/sync/FlashcardSyncProgress";

type Props = {
  onRefresh?: () => void | Promise<void>;
};

function eligibleItems(items: PipelineWikiItem[]): PipelineWikiItem[] {
  return items.filter((item) => item.status !== "processing");
}

export default function LibraryPipelinePanel({ onRefresh }: Props) {
  const { pipeline, error, completeNotice, busy, watching, refresh } = useFlashcardPipelinePoll(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<number[]>([]);
  const onRefreshRef = useRef(onRefresh);
  const prevBusyRef = useRef(false);
  const initializedRef = useRef(false);

  onRefreshRef.current = onRefresh;

  const selectableItems = useMemo(
    () => eligibleItems(pipeline?.wiki_items ?? []),
    [pipeline?.wiki_items],
  );

  useEffect(() => {
    if (!selectableItems.length) {
      initializedRef.current = false;
      setSelectedRecordIds([]);
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    setSelectedRecordIds(selectableItems.map((item) => item.record_id));
  }, [selectableItems]);

  useEffect(() => {
    const refreshLists = () => void onRefreshRef.current?.();
    window.addEventListener("knotory-sync-complete", refreshLists);
    return () => window.removeEventListener("knotory-sync-complete", refreshLists);
  }, []);

  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      void onRefreshRef.current?.();
    }
    prevBusyRef.current = busy;
  }, [busy]);

  const selectedCount = selectedRecordIds.length;
  const allSelected = selectableItems.length > 0 && selectedCount === selectableItems.length;

  function toggleRecord(recordId: number) {
    setSelectedRecordIds((prev) =>
      prev.includes(recordId) ? prev.filter((id) => id !== recordId) : [...prev, recordId],
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedRecordIds([]);
      return;
    }
    setSelectedRecordIds(selectableItems.map((item) => item.record_id));
  }

  async function runSync(opts: {
    mode?: "full" | "enrich" | "llm_only" | "fast_only";
    skipImages?: boolean;
    recordIds?: number[];
  }) {
    const recordIds = opts.recordIds ?? selectedRecordIds;
    if (!recordIds.length) {
      setLocalError("请先选择要重拆的资料");
      return;
    }

    setSyncBusy(true);
    setLocalError(null);
    try {
      await syncFlashcardsFromCorpus({
        useLlm: opts.mode !== "fast_only",
        background: true,
        skipImages: opts.skipImages,
        mode: opts.mode ?? "enrich",
        recordIds,
      });
      markFlashcardPipelineWatch();
      await refresh();
      await onRefresh?.();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "拆卡启动失败");
    } finally {
      setSyncBusy(false);
    }
  }

  if (!pipeline) {
    if (!watching) return null;
    return (
      <section className="card card--desk library-pipeline" id="library-pipeline">
        <div className="card__head card__head--compact">
          <div>
            <p className="card__kicker">进度</p>
            <h2 className="card__title">入库与拆卡</h2>
            <p className="card__sub">正在连接进度服务…</p>
          </div>
        </div>
      </section>
    );
  }

  const sync = pipeline.flashcard_sync;
  const ingestActive = (pipeline.ingest.active_count ?? 0) > 0;
  const syncRunning = Boolean(sync?.running);
  const syncQueued = Boolean(sync?.queued);
  const processingItems = pipeline.wiki_items.filter((item) => item.status === "processing");
  const showPanel =
    ingestActive ||
    syncRunning ||
    syncQueued ||
    processingItems.length > 0 ||
    watching ||
    Boolean(sync?.error) ||
    Boolean(completeNotice) ||
    pipeline.totals.records > 0;

  if (!showPanel) return null;

  const errMsg = localError || error;
  const actionsDisabled = syncBusy || syncRunning || syncQueued || selectedCount === 0;

  return (
    <section className="card card--desk library-pipeline" id="library-pipeline">
      <div className="card__head card__head--compact">
        <div>
          <p className="card__kicker">进度</p>
          <h2 className="card__title">入库与拆卡</h2>
          <p className="card__sub">
            共 {pipeline.totals.records} 篇材料 · {pipeline.totals.active_flashcards} 张活跃闪卡
          </p>
        </div>
        {pipeline.totals.active_flashcards > 0 && !syncRunning && !ingestActive ? (
          <Link href="/" className="btn btn-secondary btn-sm">
            去推荐流刷读
          </Link>
        ) : null}
      </div>

      {completeNotice ? (
        <p className="library-pipeline__done" role="status">
          ✓ {completeNotice}
        </p>
      ) : null}

      {errMsg ? (
        <p className="library-pipeline__error" role="alert">
          {errMsg}
        </p>
      ) : null}

      {pipeline.ingest.active.length ? (
        <ul className="library-pipeline__jobs">
          {pipeline.ingest.active.map((job) => (
            <li key={job.record_id} className="library-pipeline__job">
              <span className="library-pipeline__job-name">{job.file_name}</span>
              <span className="library-pipeline__job-stage">{syncStageLabel(job.stage)}</span>
            </li>
          ))}
        </ul>
      ) : processingItems.length ? (
        <ul className="library-pipeline__jobs">
          {processingItems.map((item) => (
            <li key={item.record_id} className="library-pipeline__job">
              <span className="library-pipeline__job-name">{item.file_name}</span>
              <span className="library-pipeline__job-stage">{syncStageLabel("summarizing")}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {syncQueued && !syncRunning ? (
        <p className="library-pipeline__idle-hint" role="status">
          拆卡任务排队中，前一批完成后将自动开始…
        </p>
      ) : null}

      {syncRunning && sync ? <FlashcardSyncProgress sync={sync} variant="card" /> : null}

      {!syncRunning && sync?.error ? (
        <p className="library-pipeline__error">{sync.error}</p>
      ) : null}

      {!syncRunning && !syncQueued && !ingestActive && !completeNotice && pipeline.totals.records > 0 ? (
        <p className="library-pipeline__idle-hint">
          {pipeline.totals.active_flashcards > 0
            ? "勾选下方资料后，再点击「重新拆知识点」。"
            : "摘要已入库时可勾选资料并开始拆卡。"}
        </p>
      ) : null}

      {selectableItems.length ? (
        <div className="library-pipeline__tower">
          <div className="library-pipeline__tower-head">
            <p className="library-pipeline__tower-kicker">选择要重拆的资料</p>
            <div className="library-pipeline__tower-tools">
              <span className="library-pipeline__tower-count">
                已选 {selectedCount}/{selectableItems.length}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={syncBusy || syncRunning || syncQueued}
                onClick={toggleSelectAll}
              >
                {allSelected ? "取消全选" : "全选"}
              </button>
            </div>
          </div>
          <ul className="library-pipeline__tower-list">
            {selectableItems.map((item) => {
              const checked = selectedRecordIds.includes(item.record_id);
              return (
                <li
                  key={item.record_id}
                  className={`library-pipeline__tower-item${checked ? " library-pipeline__tower-item--selected" : ""}`}
                >
                  <label className="library-pipeline__tower-select">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={syncBusy || syncRunning || syncQueued}
                      onChange={() => toggleRecord(item.record_id)}
                    />
                    <span className="library-pipeline__tower-name" title={item.file_name}>
                      {item.file_name}
                    </span>
                  </label>
                  <span className="library-pipeline__tower-meta">
                    <span>{formatRecordStatus(item.status)}</span>
                    <span>{item.flashcard_count} 卡</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm library-pipeline__tower-resync"
                      disabled={syncBusy || syncRunning || syncQueued}
                      onClick={() => void runSync({ mode: "enrich", recordIds: [item.record_id] })}
                    >
                      重拆
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="library-pipeline__actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={actionsDisabled}
          onClick={() => void runSync({ mode: "enrich" })}
        >
          重新拆知识点{selectedCount > 0 ? `（${selectedCount} 篇）` : ""}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={actionsDisabled}
          onClick={() => void runSync({ mode: "llm_only" })}
        >
          仅补 LLM 卡
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={actionsDisabled}
          onClick={() => void runSync({ mode: "enrich", skipImages: true })}
        >
          跳过配图
        </button>
      </div>
    </section>
  );
}
