/** 官方云端试用地址（自托管未配 LLM 时引导用户） */
export function getCloudDemoUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_KNOTORY_CLOUD_DEMO_URL;
  if (typeof raw === "string" && raw.trim()) return raw.trim().replace(/\/+$/, "");
  return null;
}

/** 当前实例是否为云端试用部署 */
export function isCloudDemoInstance(): boolean {
  return process.env.NEXT_PUBLIC_KNOTORY_IS_CLOUD_DEMO === "true";
}

export function shouldOfferCloudDemo(llmConfigured: boolean | null | undefined): boolean {
  if (llmConfigured !== false) return false;
  if (isCloudDemoInstance()) return false;
  return Boolean(getCloudDemoUrl());
}
