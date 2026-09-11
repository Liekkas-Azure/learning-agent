/** 入库记录状态 → 用户可读文案 */
export function formatRecordStatus(status: string): string {
  const s = (status || "").trim().toLowerCase();
  if (!s || s === "ok") return "已完成";
  if (s === "pending" || s === "processing") return "处理中";
  if (s === "summarizing") return "生成摘要";
  if (s === "failed" || s === "error") return "失败";
  if (s === "cached") return "已缓存";
  return status;
}
