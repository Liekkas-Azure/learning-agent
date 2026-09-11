export default function RootLoading() {
  return (
    <main className="page page-loading">
      <div className="app-spinner" role="status" aria-label="加载中" />
      <p className="page-loading__text">加载中…</p>
    </main>
  );
}
