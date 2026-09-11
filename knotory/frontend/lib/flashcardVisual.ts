const PALETTES = ["sunset", "ocean", "forest", "grape", "sand", "rose", "sky", "slate"] as const;

const TOPIC_EMOJI: Array<[string, string]> = [
  ["因果", "🔗"],
  ["推断", "📊"],
  ["增长", "📈"],
  ["机器学习", "🤖"],
  ["大模型", "🧠"],
  ["rag", "🔍"],
  ["检索", "🔍"],
  ["agent", "🤝"],
  ["分布式", "🌐"],
  ["系统", "⚙️"],
  ["产品", "💡"],
  ["数据", "📦"],
];

export type FlashcardPalette = (typeof PALETTES)[number];

function hashTopic(topic: string): number {
  let h = 0;
  const t = topic || "未分类";
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h;
}

export function topicPalette(topic: string): FlashcardPalette {
  return PALETTES[hashTopic(topic) % PALETTES.length];
}

export function topicEmoji(topic: string): string {
  const t = (topic || "").toLowerCase();
  for (const [needle, emo] of TOPIC_EMOJI) {
    if (t.includes(needle.toLowerCase())) return emo;
  }
  return "📚";
}

/** 分享卡 / Canvas 用主题色 */
export const PALETTE_THEME: Record<
  FlashcardPalette,
  { gradient: [string, string]; accent: string; text: string }
> = {
  sunset: { gradient: ["#fff7ed", "#fed7aa"], accent: "#ea580c", text: "#431407" },
  ocean: { gradient: ["#ecfeff", "#a5f3fc"], accent: "#0891b2", text: "#164e63" },
  forest: { gradient: ["#ecfdf5", "#a7f3d0"], accent: "#059669", text: "#064e3b" },
  grape: { gradient: ["#f5f3ff", "#ddd6fe"], accent: "#7c3aed", text: "#3b0764" },
  sand: { gradient: ["#fffbeb", "#fde68a"], accent: "#d97706", text: "#451a03" },
  rose: { gradient: ["#fff1f2", "#fecdd3"], accent: "#e11d48", text: "#4c0519" },
  sky: { gradient: ["#eff6ff", "#bfdbfe"], accent: "#2563eb", text: "#1e3a8a" },
  slate: { gradient: ["#f8fafc", "#cbd5e1"], accent: "#475569", text: "#0f172a" },
};
