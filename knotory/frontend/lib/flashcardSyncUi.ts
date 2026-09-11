import type { FlashcardSyncStatus, PipelineStatus } from "@/lib/api";

export const SYNC_STAGE_LABEL: Record<string, string> = {
  parsing: "解析正文",
  summarizing: "生成摘要",
  starting: "准备拆卡",
  queued: "排队等待拆卡",
  fast: "快速模板卡",
  llm: "LLM 易懂卡",
  images: "生成配图",
  persist: "写入索引",
  done: "已完成",
  failed: "失败",
  idle: "空闲",
};

export function syncStageLabel(stage?: string): string {
  if (!stage) return "拆卡中";
  return SYNC_STAGE_LABEL[stage] ?? stage;
}

export function syncProgressPercent(sync?: Partial<FlashcardSyncStatus>): number {
  if (!sync) return 0;
  const total = sync.progress_total ?? 0;
  const current = sync.progress_current ?? 0;
  if (total <= 0) return sync.running ? 6 : 0;
  return Math.min(100, Math.round((current / total) * 100));
}

export function formatSyncProgressDetail(sync: FlashcardSyncStatus): string {
  const stage = syncStageLabel(sync.stage);
  const pct = syncProgressPercent(sync);
  const count =
    sync.progress_total && sync.progress_total > 0
      ? ` · ${sync.progress_current ?? 0}/${sync.progress_total}`
      : "";
  const wiki = sync.current_wiki ? ` · ${basenameWiki(sync.current_wiki)}` : "";
  const percent = sync.progress_total ? ` · ${pct}%` : "";
  return `${stage}${count}${percent}${wiki}`;
}

function basenameWiki(name: string): string {
  const base = name.replace(/\.md$/i, "");
  return base.length > 28 ? `${base.slice(0, 26)}…` : base;
}

export function formatSyncCompleteMessage(
  result: Record<string, unknown> | null | undefined,
  totals?: PipelineStatus["totals"],
): string {
  const created = typeof result?.created === "number" ? result.created : null;
  const active = typeof result?.active === "number" ? result.active : totals?.active_flashcards;
  const qa = typeof result?.qa_cards === "number" ? result.qa_cards : null;
  const parts: string[] = ["拆卡已完成"];
  if (created != null && created > 0) parts.push(`新增 ${created} 张`);
  if (qa != null && qa > 0) parts.push(`其中 ${qa} 张 LLM 易懂卡`);
  if (active != null) parts.push(`文库共 ${active} 张活跃闪卡`);
  return parts.join(" · ");
}

export function pipelineIsBusy(pipeline: PipelineStatus | null): boolean {
  if (!pipeline) return false;
  if ((pipeline.ingest.active_count ?? 0) > 0) return true;
  if (pipeline.flashcard_sync?.running) return true;
  if (pipeline.flashcard_sync?.queued) return true;
  if (pipeline.wiki_items?.some((item) => item.status === "processing")) return true;
  return false;
}
