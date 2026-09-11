export type NewsImpactLevel = "high" | "medium" | "low";
export type NewsSentiment = "positive" | "negative" | "neutral";

/** 新闻资讯分组：个股 / 所属行业 / 宏观 */
export type NewsBucket = "stock" | "industry" | "macro" | "general";

export type NewsScores = {
  relevance: number;
  relevanceLabel: string;
  impactLevel: NewsImpactLevel;
  impactLabel: string;
  sentiment: NewsSentiment;
  sentimentLabel: string;
  /** 无 LLM 时由规则推断；有 LLM 时以模型为准（noise→general） */
  newsBucket?: NewsBucket;
  /** 大模型给出的 0–100 相关度；未调用 LLM 时不存在 */
  llmScore?: number;
};

export type ScoreContext = {
  /** RSS 来源，用于对「已按关键词检索」的条目给予合理加成 */
  source?: string;
};

const HIGH_IMPACT_RE =
  /停牌|复牌|并购|收购|重组|私有化|配股|供股|减持|增持|回购|监管|调查|诉讼|破产|制裁|禁售|盈利预警|业绩|财报|派息|拆股|合股|供股权/;
const POS_RE =
  /利好|超预期|增长|盈利|扭亏|上调|增持|回购|突破|创新高|股息|分红|beat|upgrade|growth|profit|buyback/i;
const NEG_RE =
  /利空|亏损|不及预期|下调|减持|调查|诉讼|停牌|裁员|债务|违约|miss|downgrade|lawsuit|probe|loss/i;

/** 宏观与市场整体语境（不要求出现「证券」字样），用于召回对港股有背景意义的政策与外盘新闻 */
const MACRO_CONTEXT_RE =
  /货币政策|量化宽松|缩表|降准|降息|加息|基点|美联储|FOMC|欧央行|英国央行|日本央行|非农|就业数据|失业率|CPI|PPI|GDP|PMI|通胀|通缩|滞胀|衰退|复苏|软着陆|硬着陆|避险情绪|风险偏好|流动性|信用利差|国债收益率|美债|收益率曲线|倒挂|美元指数|中间价|在岸人民币|离岸人民币|汇率|外汇储备|地缘政治|地缘冲突|关税|贸易战|制裁|大宗商品|原油价格|布伦特|WTI|黄金|铜价|铁矿石|OPEC|中东局势|俄乌|中美关系|欧盟峰会|G7|G20|系统性风险|金融危机|黑天鹅|灰犀牛/i;

/**
 * 常见港股：代码 → 行业/赛道关键词（标题命中且不优先判为个股直连时，归入「行业」）
 * 未覆盖的股票将尝试从公司简称推断（银行/保险/地产/能源等）。
 */
const HK_INDUSTRY_BY_CODE: Record<string, RegExp> = {
  "00700":
    /游戏|手游|电竞|社交|微信|WeChat|QQ|元宇宙|视频号|TME|腾讯音乐|广告|营销|腾讯云|云计算|SaaS|PaaS|IaaS|混元|大模型|AIGC|金融科技|支付|理财|企业服务|视频|直播|内容|IP|动漫|王者|和平精英|互联网|数字化|算力|平台经济|短视频|信息流/i,
  "09988":
    /电商|零售|淘宝|天猫|菜鸟|阿里云|云计算|1688|跨境|消费|本地生活|闪购|盒马|闲鱼|钉钉|飞猪|高德|优酷/i,
  "03690": /外卖|到店|本地生活|配送|团购|闪购|骑手|酒店|旅游|优选/i,
  "01810": /手机|智能手机|IoT|生态链|澎湃|汽车|造车|小爱|可穿戴/i,
  "09618": /电商|物流|供应链|京东|零售|618|双11/i,
  "00941": /5G|运营商|通信|宽带|移动网络|算力网络/i,
  "01299": /保险|寿险|财险|代理人|NBV|内含价值/i,
  "02318": /保险|银行|综合金融|寿险|财险|陆金所/i,
  "01398": /银行|信贷|息差|不良|拨备|存款|贷款|网点/i,
  "03988": /银行|信贷|息差|不良|拨备|存款|贷款/i,
  "00939": /银行|信贷|息差|不良|拨备|存款|贷款/i,
  "00005": /银行|汇丰|环球|财富管理|息差|信贷/i,
  "00388": /港交所|上市|IPO|港股通|交易|结算|衍生品|MSCI|恒生指数/i,
  "01024": /短视频|直播|电商|广告|快手/i,
  "09888": /搜索|AI|大模型|文心|智能云|自动驾驶|Apollo/i,
  "09866": /蔚来|造车|新能源|换电|智能驾驶|交付/i,
  "01211": /新能源|电动车|电池|比亚迪|出海|交付/i,
  "02269": /家电|智能家居|ToB|工业技术/i,
  "02382": /光学|镜头|模组|手机供应链|车载|AR\/VR/i,
  "02020": /体育|服饰|品牌|安踏|FILA|零售/i,
  "06618": /医疗|健康|互联网医院|医药电商/i,
};

/** 常见港股：5 位代码 → 英文名/简繁体别名（用于英文财经源匹配） */
const CODE_ALIASES: Record<string, string[]> = {
  "00700": ["Tencent", "腾讯", "騰訊"],
  "09988": ["Alibaba", "阿里", "阿里巴巴", "BABA"],
  "03690": ["Meituan", "美团"],
  "01810": ["Xiaomi", "小米"],
  "09618": ["JD.com", "京东", "JD "],
  "00941": ["China Mobile", "中国移动", "中移动"],
  "01299": ["AIA", "友邦"],
  "02318": ["Ping An", "中国平安", "平安"],
  "01398": ["ICBC", "工商银行", "工行"],
  "03988": ["Bank of China", "中国银行", "中行"],
  "00388": ["HKEX", "港交所", "香港交易所"],
  "00005": ["HSBC", "汇丰"],
  "00939": ["CCB", "建设银行", "建行"],
  "02269": ["Midea", "美的"],
  "02382": ["Sunny Optical", "舜宇"],
  "02020": ["ANTA", "安踏"],
  "01024": ["Kuaishou", "快手"],
  "06618": ["JD Health", "京东健康"],
  "09888": ["Baidu", "百度"],
  "09866": ["NIO", "蔚来"],
  "01211": ["BYD", "比亚迪"],
};

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqTerms(name: string, code5: string): { term: string; weight: number }[] {
  const padded = code5;
  const short = padded.replace(/^0+/, "") || "0";
  const core = name
    .replace(/股份有限公司|控股有限公司|有限公司|控股|集团|国际|科技|投资|发展/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const list: { term: string; weight: number }[] = [];
  const seen = new Set<string>();
  const add = (term: string, weight: number) => {
    const t = term.trim();
    if (t.length < 2) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ term: t, weight });
  };

  add(name, 26);
  if (core && core !== name) add(core, 22);
  for (const p of core.split(/[\s\u3000]+/).filter((x) => x.length >= 2)) {
    add(p, p.length <= 3 ? 14 : 18);
  }

  add(padded, 24);
  add(short, short.length >= 2 ? 20 : 12);
  add(`${short}.HK`, 18);
  add(`${padded}.HK`, 18);
  add(`hk${padded}`, 16);
  add(`HKEX:${padded}`, 16);
  add(`(${padded})`, 14);
  add(`(${short})`, 12);

  const aliases = CODE_ALIASES[padded];
  if (aliases) {
    for (const a of aliases) add(a, /[a-z]/i.test(a) ? 20 : 22);
  }

  /** 中文连续片段的二字子串（提高「腾讯」在「腾讯控股」类标题中的召回） */
  const cjkRuns = name.match(/[\u4e00-\u9fff]{3,}/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i <= run.length - 2; i++) {
      const bi = run.slice(i, i + 2);
      if (bi.length === 2) add(bi, 11);
    }
  }

  return list;
}

function countSub(haystack: string, needle: string): number {
  if (needle.length < 2) return 0;
  let n = 0;
  let i = 0;
  const step = Math.max(1, needle.length);
  while (i <= haystack.length - needle.length) {
    const j = haystack.indexOf(needle, i);
    if (j === -1) break;
    n += 1;
    i = j + step;
  }
  return n;
}

function tally(haystack: string, terms: { term: string; weight: number }[]): number {
  const raw = normalizeForMatch(haystack);
  const lower = raw.toLowerCase();
  let sum = 0;
  for (const { term, weight } of terms) {
    const latin = /[a-z]/i.test(term);
    const hay = latin ? lower : raw;
    const needle = latin ? term.toLowerCase() : term;
    const c = countSub(hay, needle);
    if (c) sum += c * weight;
  }
  return sum;
}

/** 标题/正文中出现股票代码形态（含前导零、HK 前缀等） */
function codePatternBonus(title: string, description: string, code5: string, short: string): number {
  const blob = `${title}\n${description}`;
  let bonus = 0;
  const patterns: RegExp[] = [
    new RegExp(`\\b${short}\\b`, "i"),
    new RegExp(`\\b${code5}\\b`),
    new RegExp(`HK:?\\s*0*${short}\\b`, "i"),
    new RegExp(`\\(0*${short}\\)`, "i"),
    new RegExp(`：\\s*0*${short}\\b`),
  ];
  for (const re of patterns) {
    if (re.test(blob)) {
      bonus += 14;
      break;
    }
  }
  return Math.min(28, bonus);
}

export function macroContextBoost(title: string, description: string): number {
  const t = normalizeForMatch(`${title}\n${description}`);
  if (!MACRO_CONTEXT_RE.test(t)) return 0;
  return 16;
}

function industryPatternFor(code5: string, companyName: string): RegExp | null {
  const pad = code5.padStart(5, "0");
  const byCode = HK_INDUSTRY_BY_CODE[pad];
  if (byCode) return byCode;
  const n = normalizeForMatch(companyName);
  if (/银行/.test(n)) return /银行|信贷|息差|不良|拨备|存款|贷款|LPR|降准对银行/i;
  if (/保险/.test(n)) return /保险|寿险|财险|保费|偿付|代理人/i;
  if (/地产|置业|发展/.test(n)) return /地产|楼市|土拍|物业|销售面积|保交楼/i;
  if (/石油|石化|能源/.test(n)) return /原油|油价|油气|炼化|OPEC|库存|能源/i;
  if (/电力|核电|风电|光伏/.test(n)) return /电力|电价|装机|绿电|新能源发电|碳中和/i;
  if (/汽车|出行/.test(n)) return /汽车|整车|销量|新能源车|智能驾驶/i;
  if (/医药|生物|制药/.test(n)) return /医药|临床|集采|创新药|医保|CXO/i;
  if (/芯片|半导体|集成电路/.test(n)) return /芯片|半导体|晶圆|封测|EDA|国产替代/i;
  return null;
}

function inferNewsBucket(
  relevance: number,
  title: string,
  description: string,
  code5: string,
  companyName: string,
  sig: { codeBonus: number; titleHits: number },
): NewsBucket {
  const text = normalizeForMatch(`${title}\n${description}`);
  const macroHit = MACRO_CONTEXT_RE.test(text);
  const indRe = industryPatternFor(code5, companyName);
  const industryHit = indRe ? indRe.test(text) : false;

  /** 标题/代码级直连，避免泛财经稿里「二字简称」误触把宏观/行业判成个股 */
  const stockStrong =
    sig.codeBonus >= 14 || sig.titleHits >= 22 || relevance >= 32;

  if (stockStrong) return "stock";
  if (industryHit) return "industry";
  if (macroHit) return "macro";
  if (relevance >= 18) return "stock";
  if (relevance >= 8) return "stock";
  return "general";
}

function googleNewsRelevanceBoost(
  source: string | undefined,
  titleHits: number,
  descHits: number,
  titleNorm: string,
  name: string,
  code5: string,
): number {
  if (!source?.startsWith("Google News")) return 0;
  const t = titleNorm;
  const n = normalizeForMatch(name);
  const short = code5.replace(/^0+/, "") || "0";
  if (titleHits + descHits > 0) return 28;
  if (n.length >= 2 && t.includes(n)) return 24;
  if (t.includes(code5) || (short.length >= 2 && t.includes(short))) return 20;
  return 14;
}

export function scoreNewsItem(
  title: string,
  description: string,
  name: string,
  code5: string,
  ctx?: ScoreContext,
): NewsScores {
  const titleN = normalizeForMatch(title);
  const descN = normalizeForMatch(description);
  const text = `${titleN}\n${descN}`;
  const short = code5.replace(/^0+/, "") || "0";

  const terms = uniqTerms(name, code5);
  const titleHits = tally(titleN, terms);
  const descHits = tally(descN, terms);
  const codeB = codePatternBonus(titleN, descN, code5, short);
  let raw = titleHits * 1.72 + descHits * 1.05 + codeB;
  raw += googleNewsRelevanceBoost(ctx?.source, titleHits, descHits, titleN, name, code5);

  const relevance = Math.min(100, Math.round(raw));
  const newsBucket = inferNewsBucket(relevance, title, description, code5, name, {
    codeBonus: codeB,
    titleHits,
  });
  const relevanceLabel =
    relevance >= 72 ? "高" : relevance >= 45 ? "中" : relevance >= 22 ? "一般" : "低";

  const hi = HIGH_IMPACT_RE.test(text) ? 1 : 0;
  const pos = [...text.matchAll(new RegExp(POS_RE.source, "gi"))].length;
  const neg = [...text.matchAll(new RegExp(NEG_RE.source, "gi"))].length;

  let impactScore = hi * 35 + Math.min(42, relevance / 2.2);
  if (pos + neg > 0) impactScore += 15;
  impactScore = Math.min(100, Math.round(impactScore));

  const impactLevel: NewsImpactLevel =
    impactScore >= 68 ? "high" : impactScore >= 40 ? "medium" : "low";
  const impactLabel =
    impactLevel === "high" ? "高（可能显著影响波动）" : impactLevel === "medium" ? "中" : "低";

  let sentiment: NewsSentiment = "neutral";
  if (pos > neg) sentiment = "positive";
  else if (neg > pos) sentiment = "negative";

  const sentimentLabel =
    sentiment === "positive" ? "正向" : sentiment === "negative" ? "负向" : "中性";

  return {
    relevance,
    relevanceLabel,
    impactLevel,
    impactLabel,
    sentiment,
    sentimentLabel,
    newsBucket,
  };
}
