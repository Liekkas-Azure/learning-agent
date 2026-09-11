export type UnderstandingMode = "explain" | "analogy" | "steps" | "eli5" | "compare";

export type FlashcardUnderstanding = {
  mode: string;
  mode_label: string;
  question?: string;
  answer?: string;
  analogy?: string;
  bullets?: string[];
  one_liner?: string;
  summary?: string;
  key_points?: string[];
  why_hard?: string;
  remember_tip?: string;
  visual_mermaid?: string;
  cached?: boolean;
};

export const UNDERSTANDING_MODES: {
  id: UnderstandingMode;
  label: string;
  hint: string;
}[] = [
  { id: "explain", label: "拆解要点", hint: "补充说明，不替换原卡" },
  { id: "analogy", label: "生活类比", hint: "用熟悉事物打比方" },
  { id: "steps", label: "分步骤", hint: "按顺序讲清逻辑" },
  { id: "eli5", label: "零基础", hint: "假设从未听说过" },
  { id: "compare", label: "对比说明", hint: "和相近概念对照" },
];

export const REGENERATE_PRESETS: { label: string; direction: string }[] = [
  { label: "生活类比", direction: "用生活化类比讲解，先给一句「就像…」，再展开。" },
  { label: "更短一点", direction: "答案更短、句子更短，去掉次要细节，保留核心。" },
  { label: "零基础", direction: "假设读者零基础，避免术语，多举具体例子。" },
  { label: "多举例", direction: "多给 1～2 个具体例子或场景，帮助建立直觉。" },
  { label: "对比辨析", direction: "和容易混淆的概念对照，说明区别与边界。" },
];

export function directionForMode(mode: UnderstandingMode): string {
  const preset = UNDERSTANDING_MODES.find((m) => m.id === mode);
  if (!preset) return "用更简单易懂的方式重写。";
  if (mode === "explain") return "用更简单、好理解的方式讲解，避免照搬原文。";
  return REGENERATE_PRESETS.find((p) => p.label === preset.label)?.direction
    ?? `用「${preset.label}」的方式重写：${preset.hint}`;
}
