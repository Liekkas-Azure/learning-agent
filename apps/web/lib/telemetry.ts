/**
 * 占位：可在此接入 OpenTelemetry（请求、队列、爬取失败率）。
 * 当前将关键事件写入 AuditLog（见 worker / API）。
 */
export function logEvent(name: string, attrs?: Record<string, string | number | boolean>) {
  if (process.env.NODE_ENV === "development") {
    console.info("[telemetry]", name, attrs ?? {});
  }
}
