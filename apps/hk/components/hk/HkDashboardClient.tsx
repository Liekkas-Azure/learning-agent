"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCnLargeAmount, formatNumber, formatVolume } from "@/lib/hk/format";
import { normalizeHkSymbol } from "@/lib/hk/normalizeSymbol";
import type { HkDashboardPayload } from "./types";
import { HkQuantSnapshot } from "./HkQuantSnapshot";
import { PriceLineChart } from "./PriceLineChart";
import { StrategySimPanel } from "./StrategySimPanel";

const WATCH_LS = "hk-quant-watchlist-v1";
const WATCH_PRESETS = ["00700", "09988", "01810", "03690", "00941", "01398"];
const AUTO_REFRESH_MS = 90_000;
const TAB_LS = "hk-dashboard-active-tab-v1";

type HkDashTab = "overview" | "research" | "strategy" | "news";

/** 新闻资讯内：按个股 / 行业 / 宏观筛选（「全部」含未归入三类的条目） */
type HkNewsSubtab = "all" | "stock" | "industry" | "macro";

const NEWS_SUBTABS: { id: HkNewsSubtab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "stock", label: "个股" },
  { id: "industry", label: "行业" },
  { id: "macro", label: "宏观" },
];

const TABS: { id: HkDashTab; label: string; hint: string }[] = [
  { id: "overview", label: "行情总览", hint: "核心指标 · 自选" },
  { id: "research", label: "走势与研究", hint: "日K · 技术快照" },
  { id: "strategy", label: "策略回测", hint: "多策略 · 买卖点" },
  { id: "news", label: "新闻资讯", hint: "新浪个股 + RSS · 豆包可选" },
];

function isHkDashTab(s: string): s is HkDashTab {
  return s === "overview" || s === "research" || s === "strategy" || s === "news";
}

function badge(
  text: string,
  tone: "slate" | "emerald" | "amber" | "rose" | "violet" | "sky",
) {
  const map = {
    slate: "border-white/15 bg-white/5 text-neutral-200",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/35 bg-amber-500/10 text-amber-100",
    rose: "border-rose-500/35 bg-rose-500/10 text-rose-100",
    violet: "border-violet-500/35 bg-violet-500/10 text-violet-100",
    sky: "border-sky-500/35 bg-sky-500/10 text-sky-100",
  } as const;
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {text}
    </span>
  );
}

export function HkDashboardClient() {
  const [input, setInput] = useState("00700");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HkDashboardPayload | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(WATCH_PRESETS);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState<HkDashTab>("overview");
  const [newsSubtab, setNewsSubtab] = useState<HkNewsSubtab>("all");

  const load = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/hk-dashboard?symbol=${encodeURIComponent(symbol.trim())}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as HkDashboardPayload & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setData(null);
        setError(json.message ?? json.error ?? "请求失败");
        return;
      }
      setData(json);
    } catch {
      setData(null);
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCH_LS);
      if (!raw) return;
      const p = JSON.parse(raw) as unknown;
      if (!Array.isArray(p)) return;
      const next = p
        .filter((x): x is string => typeof x === "string")
        .map((c) => c.replace(/\D/g, "").padStart(5, "0"))
        .filter((c) => c !== "00000" && /^0\d{4}$/.test(c))
        .slice(0, 14);
      if (next.length) setWatchlist(next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WATCH_LS, JSON.stringify(watchlist));
    } catch {
      /* ignore */
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TAB_LS);
      if (raw && isHkDashTab(raw)) setActiveTab(raw);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_LS, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load(input.trim());
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, input, load]);

  useEffect(() => {
    setNewsSubtab("all");
  }, [data?.symbol]);

  const selectSymbol = useCallback(
    (code: string) => {
      setInput(code);
      void load(code);
    },
    [load],
  );

  const addCurrentToWatchlist = useCallback(() => {
    const n = normalizeHkSymbol(input);
    if (!n) return;
    setWatchlist((prev) => {
      if (prev.includes(n.code5)) return prev;
      return [n.code5, ...prev].slice(0, 14);
    });
  }, [input]);

  const removeWatch = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((c) => c !== code));
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void load(input);
    },
    [input, load],
  );

  const q = data?.quote;
  const up = q ? q.change >= 0 : false;

  const metrics = useMemo(() => {
    if (!q) return [];
    const rows: { label: string; value: string; hint?: string }[] = [
      { label: "最新价", value: `${formatNumber(q.last, 3)}` },
      {
        label: "涨跌 / 涨跌幅",
        value: `${up ? "+" : ""}${formatNumber(q.change, 3)} / ${up ? "+" : ""}${formatNumber(q.changePct, 2)}%`,
      },
      { label: "今开", value: formatNumber(q.open, 3) },
      { label: "最高", value: formatNumber(q.high, 3) },
      { label: "最低", value: formatNumber(q.low, 3) },
      { label: "昨收", value: formatNumber(q.prevClose, 3) },
      { label: "成交量", value: formatVolume(q.volume) },
      { label: "成交额", value: `${formatCnLargeAmount(q.turnover)} 元` },
    ];
    if (q.marketCap !== undefined) {
      rows.push({
        label: "总市值",
        value: formatCnLargeAmount(q.marketCap),
        hint: "口径与行情源字段一致，用于横向对比而非精确会计值",
      });
    }
    if (q.peTtm !== undefined) {
      rows.push({
        label: "市盈率（TTM，源字段）",
        value: formatNumber(q.peTtm, 2),
        hint: "不同数据源算法可能不同，仅作快速参考",
      });
    }
    if (q.volumeRatio !== undefined) {
      rows.push({ label: "量比（源字段）", value: formatNumber(q.volumeRatio, 2) });
    }
    if (q.amplitudePct !== undefined) {
      rows.push({ label: "振幅", value: `${formatNumber(q.amplitudePct, 2)}%` });
    }
    return rows;
  }, [q, up]);

  const { newsFiltered, newsCounts } = useMemo(() => {
    const list = data?.news ?? [];
    const counts = {
      all: list.length,
      stock: list.filter((n) => n.newsBucket === "stock").length,
      industry: list.filter((n) => n.newsBucket === "industry").length,
      macro: list.filter((n) => n.newsBucket === "macro").length,
    };
    if (newsSubtab === "all") return { newsFiltered: list, newsCounts: counts };
    return {
      newsFiltered: list.filter((n) => n.newsBucket === newsSubtab),
      newsCounts: counts,
    };
  }, [data?.news, newsSubtab]);

  return (
    <div className="mx-auto max-w-6xl text-slate-100">
      <header className="mb-8 space-y-3">
        <p className="ai-section-label">Quant · Hong Kong</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl ai-title-gradient">
          港股量化看板
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          输入港交所股票代码（如{" "}
          <span className="text-slate-200">700</span> 或{" "}
          <span className="text-slate-200">00700</span>
          ），下方按主题分 Tab：行情总览、走势与研究、策略回测、新闻资讯；不构成投资建议。
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="ai-card mb-8 flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium text-slate-500">股票代码</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如 00700"
            className="ai-input text-base"
            autoComplete="off"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="submit" disabled={loading} className="ai-btn-primary px-5 disabled:opacity-55">
            {loading ? "加载中…" : "刷新数据"}
          </button>
          <button type="button" onClick={() => void load(input)} className="ai-btn-secondary">
            仅重试
          </button>
          <button type="button" onClick={addCurrentToWatchlist} className="ai-btn-secondary border-violet-400/25 text-violet-100 hover:border-violet-400/40 hover:bg-violet-500/10">
            加入自选
          </button>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-1 py-1 text-xs text-slate-400 hover:text-slate-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="ai-checkbox accent-cyan-500"
            />
            自动刷新（{AUTO_REFRESH_MS / 1000}s，仅前台页签）
          </label>
        </div>
      </form>

      {loading && !q && !error ? (
        <div
          className="ai-card mb-8 flex min-h-[180px] flex-col items-center justify-center gap-4 p-10"
          aria-busy="true"
        >
          <div className="ai-pulse-dot">
            <span />
            <span />
          </div>
          <p className="text-sm text-slate-500">正在拉取行情与资讯…</p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-8 rounded-xl border border-rose-400/25 bg-rose-500/[0.12] px-4 py-3.5 text-sm text-rose-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          {error}
        </div>
      ) : null}

      {q && data ? (
        <section className="space-y-5">
          <div role="tablist" aria-label="看板分区" className="ai-tab-group">
            {TABS.map((t) => {
              const selected = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  id={`hk-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="hk-dash-tabpanel"
                  onClick={() => setActiveTab(t.id)}
                  className={`ai-tab ${selected ? "ai-tab-active" : "ai-tab-inactive"}`}
                >
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{t.hint}</span>
                </button>
              );
            })}
          </div>

          <div
            id="hk-dash-tabpanel"
            role="tabpanel"
            aria-labelledby={`hk-tab-${activeTab}`}
            className="ai-card min-h-[280px] p-4 sm:p-6"
          >
            {activeTab === "overview" ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/[0.06] pb-4">
                  <div>
                    <div className="text-xs font-medium text-slate-500">标的</div>
                    <div className="mt-1 text-xl font-semibold tracking-tight text-slate-50">
                      {q.name}{" "}
                      <span className="font-mono text-base font-normal text-slate-500">
                        {data.symbol}
                      </span>
                      <span className="text-sm text-slate-600"> · {data.secid}</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    更新于 {new Date(data.fetchedAt).toLocaleString("zh-Hans-CN")}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {metrics.map((m) => (
                    <div key={m.label} className="ai-metric-tile">
                      <div className="text-xs text-slate-500">{m.label}</div>
                      <div
                        className={`mt-1 text-lg font-semibold tabular-nums text-slate-50 ${
                          m.label.startsWith("涨跌") ? (up ? "text-emerald-300" : "text-rose-300") : ""
                        }`}
                      >
                        {m.value}
                      </div>
                      {m.hint ? (
                        <div className="mt-1 text-[11px] leading-snug text-slate-500">{m.hint}</div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="ai-card rounded-xl p-4">
                  <div className="text-xs font-medium text-slate-500">自选（本地，点击切换）</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {watchlist.map((code) => (
                      <span
                        key={code}
                        className={`ai-chip ${data.symbol === code ? "ai-chip-active" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => selectSymbol(code)}
                          className="py-1 pl-1.5 font-mono text-[11px] font-medium transition hover:text-cyan-200"
                        >
                          {code}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeWatch(code)}
                          className="rounded-full px-1.5 py-1 text-slate-500 transition hover:bg-white/10 hover:text-rose-300"
                          aria-label={`移除 ${code}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                    切换代码后可在「走势与研究」「策略回测」查看同一标的。
                  </p>
                </div>
              </div>
            ) : null}

            {activeTab === "research" ? (
              <div className="space-y-6">
                {data.snapshot ? (
                  <HkQuantSnapshot snapshot={data.snapshot} symbol={data.symbol} />
                ) : (
                  <p className="rounded-lg border border-white/[0.07] bg-black/20 px-4 py-6 text-sm text-slate-500">
                    暂无可用的研究快照（日线数据不足）。
                  </p>
                )}
                <PriceLineChart candles={data.candles} />
              </div>
            ) : null}

            {activeTab === "strategy" ? <StrategySimPanel symbol={data.symbol} embedded /> : null}

            {activeTab === "news" ? (
              <div className="space-y-4">
                <div className="border-b border-white/[0.06] pb-3">
                  <h2 className="text-lg font-semibold text-slate-50">相关新闻</h2>
                  {typeof data.newsRawCount === "number" ? (
                    <p className="mt-1 text-xs text-slate-500">
                      拉取约 {data.newsRawCount} 条（新浪个股 + 多源 RSS）
                      {typeof data.newsScoredCount === "number"
                        ? ` · 去重入池 ${data.newsScoredCount} 条`
                        : null}
                      {typeof data.newsDisplayMax === "number"
                        ? ` · 本页展示 ${data.news.length} 条（上限 ${data.newsDisplayMax}，多源已参与截断前排序）`
                        : ` · 展示 ${data.news.length} 条`}
                      {newsSubtab !== "all"
                        ? ` · 当前「${NEWS_SUBTABS.find((s) => s.id === newsSubtab)?.label ?? ""}」${newsFiltered.length} 条`
                        : null}
                      {data.newsLlmUsed ? " · 已用豆包筛选排序" : null}
                    </p>
                  ) : null}
                  {data.newsLlmNote ? (
                    <p className="mt-1 text-xs text-amber-200/90">{data.newsLlmNote}</p>
                  ) : null}
                  {data.news.length > 0 ? (
                    <div
                      role="tablist"
                      aria-label="新闻分类"
                      className="mt-3 flex flex-wrap gap-1.5"
                    >
                      {NEWS_SUBTABS.map((s) => {
                        const selected = newsSubtab === s.id;
                        const c =
                          s.id === "all"
                            ? newsCounts.all
                            : s.id === "stock"
                              ? newsCounts.stock
                              : s.id === "industry"
                                ? newsCounts.industry
                                : newsCounts.macro;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            onClick={() => setNewsSubtab(s.id)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                              selected
                                ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
                                : "border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-white/15 hover:text-slate-200"
                            }`}
                          >
                            {s.label}
                            <span className="ml-1 tabular-nums text-slate-500">({c})</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                {data.newsErrors.length ? (
                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.1] px-3 py-2.5 text-xs text-amber-100">
                    部分新闻源不可用：{data.newsErrors.join("；")}
                  </div>
                ) : null}
                {data.news.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.08] bg-black/25 px-4 py-8 text-sm text-slate-400">
                    暂无满足筛选条件的新闻条目。可稍后再试；请配置{" "}
                    <code className="ai-code-inline">DOUBAO_API_KEY</code> 与{" "}
                    <code className="ai-code-inline">DOUBAO_MODEL</code>（方舟推理接入点 ID）；不需要大模型时可设{" "}
                    <code className="ai-code-inline">HK_NEWS_USE_LLM=0</code>
                    。亦可通过 <code className="ai-code-inline">HK_NEWS_RSS_URLS</code> 追加境内 RSS（逗号分隔）；展示条数上限可用{" "}
                    <code className="ai-code-inline">HK_NEWS_DISPLAY_MAX</code>（默认 48，范围 12–100）。
                  </div>
                ) : newsFiltered.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.08] bg-black/25 px-4 py-8 text-sm text-slate-400">
                    当前分类下暂无条目，可切换到「全部」或其他标签查看。
                  </div>
                ) : (
                  <ul className="max-h-[min(72vh,960px)] space-y-3 overflow-y-auto pr-1">
                    {newsFiltered.map((n) => (
                      <li
                        key={n.link}
                        className="ai-card ai-card-hover !rounded-xl p-3.5"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          {n.newsBucket === "macro" ? badge("宏观", "emerald") : null}
                          {n.newsBucket === "industry" ? badge("行业", "sky") : null}
                          {n.newsBucket === "stock" ? badge("个股", "violet") : null}
                          {typeof n.llmScore === "number" ? badge(`豆包 ${n.llmScore}`, "amber") : null}
                          {n.relevance < 24 && n.llmScore === undefined ? badge("弱相关", "slate") : null}
                          {badge(`${n.relevance}`, "violet")}
                          {badge(
                            n.sentiment === "positive"
                              ? "正向"
                              : n.sentiment === "negative"
                                ? "负向"
                                : "中性",
                            n.sentiment === "positive"
                              ? "emerald"
                              : n.sentiment === "negative"
                                ? "rose"
                                : "slate",
                          )}
                          <span className="text-[10px] text-slate-500">{n.source}</span>
                        </div>
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block text-sm font-medium leading-snug text-slate-100 transition hover:text-cyan-200"
                        >
                          {n.title}
                        </a>
                        {n.summary ? (
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-400">
                            {n.summary}
                          </p>
                        ) : null}
                        <div className="mt-2 text-[10px] text-slate-600">
                          {n.publishedAt ? `${n.publishedAt} · ` : null}
                          {n.sentimentLabel}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        !loading &&
        !error && (
          <p className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-500">
            加载成功后将在此展示行情、图表与新闻。
          </p>
        )
      )}

      <div className="ai-divider mt-14" />
      <footer className="pt-6 text-xs leading-relaxed text-slate-600">
        行情、日线 K 与 5 分钟 K 来自东方财富开放接口；研究快照为本地根据收盘价估算的技术与风险指标；新闻为第三方 RSS
        摘要聚合，默认经火山方舟豆包模型做相关度分类与排序。量化策略与回测为教学向简化模型（收盘撮合、未建模滑点/盘口），不构成投资建议；请遵守来源站点服务条款与
        robots 规则。
      </footer>
    </div>
  );
}
