import type { HkDashboardSnapshot } from "@/lib/hk/dashboardSnapshot";
import type { HkCandle, HkQuote } from "@/lib/hk/eastmoney";
import type { EnrichedNewsItem } from "@/lib/hk/news";

export type HkDashboardPayload = {
  symbol: string;
  secid: string;
  quote: HkQuote;
  candles: HkCandle[];
  /** 日线 + 5 分钟衍生指标，主流量化看板常见「研究快照」 */
  snapshot?: HkDashboardSnapshot | null;
  news: EnrichedNewsItem[];
  newsErrors: string[];
  /** 新浪个股 + 各 RSS 拉取条数之和（未按标题去重） */
  newsRawCount?: number;
  /** 去重后进入规则打分池的条数 */
  newsScoredCount?: number;
  /** 本页最多展示条数（与 `news.length` 上限一致） */
  newsDisplayMax?: number;
  /** 为 true 时表示已用豆包（火山方舟）对候选新闻做分类/排序 */
  newsLlmUsed?: boolean;
  /** 例如未配置密钥或上游错误时的说明 */
  newsLlmNote?: string;
  fetchedAt: string;
};
