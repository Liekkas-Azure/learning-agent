/**
 * 根分段加载态：任意 `app/` 下页面在服务端渲染未完成前展示，避免长时间白屏。
 */
export default function AppLoading() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 py-16" aria-busy="true" aria-label="加载中">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
      <p className="text-sm text-slate-500">内容加载中…</p>
    </div>
  );
}
