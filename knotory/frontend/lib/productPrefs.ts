import { markFlashcardPipelineWatch } from "@/lib/useFlashcardPipelinePoll";

const DEMO_MODE_KEY = "knotory_demo_mode";
const DAILY_GOAL_KEY = "knotory_daily_goal";
const DEMO_FIRST_SAVE_KEY = "knotory_demo_first_save";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEMO_MODE_KEY) === "1";
}

export function enableDemoMode(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEMO_MODE_KEY, "1");
}

export function disableDemoMode(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DEMO_MODE_KEY);
}

/** 用户上传文库后：退出示例模式并通知推荐流刷新。 */
export function dismissDemoAfterCorpusUpload(): void {
  disableDemoMode();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("knotory-corpus-updated"));
  markFlashcardPipelineWatch();
}

export function getDailyGoal(): number {
  if (typeof window === "undefined") return 5;
  const raw = localStorage.getItem(DAILY_GOAL_KEY);
  const n = raw ? parseInt(raw, 10) : 5;
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 5;
}

export function setDailyGoal(n: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DAILY_GOAL_KEY, String(Math.max(1, Math.min(50, n))));
  window.dispatchEvent(new Event("knotory-daily-goal-change"));
}

export function isDemoFirstSaveDone(): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(localStorage.getItem(DEMO_FIRST_SAVE_KEY));
}

export function markDemoFirstSaveDone(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEMO_FIRST_SAVE_KEY, "1");
}
