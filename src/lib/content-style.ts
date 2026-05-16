export type ContentMode = "report" | "analysis" | "explainer" | "tutorial" | "opinion" | "roundup" | "essay";

export const CONTENT_MODE_OPTIONS: Array<{ value: ContentMode; label: string; description: string }> = [
  { value: "report", label: "报道", description: "以事实推进为主，适合即时事件和来源整理。" },
  { value: "analysis", label: "深度分析", description: "强调背景、趋势、原因和影响。" },
  { value: "explainer", label: "科普解读", description: "把复杂议题拆开讲清楚，降低理解门槛。" },
  { value: "tutorial", label: "教程指南", description: "按步骤、注意事项和实践建议组织内容。" },
  { value: "opinion", label: "观点评论", description: "允许清晰论点，但必须区分事实和判断。" },
  { value: "roundup", label: "周报/合集", description: "按主题串联多条材料，提炼共同线索。" },
  { value: "essay", label: "随笔专栏", description: "更重视叙述节奏和可读性，事实边界仍需明确。" }
];

const MODE_VALUES = new Set<string>(CONTENT_MODE_OPTIONS.map((option) => option.value));

export function isContentMode(value: string | null | undefined): value is ContentMode {
  return Boolean(value && MODE_VALUES.has(value));
}

export function contentModeLabel(value: string | null | undefined) {
  return CONTENT_MODE_OPTIONS.find((option) => option.value === value)?.label || "报道";
}

export function normalizeContentMode(value: string | null | undefined): ContentMode {
  return isContentMode(value) ? value : "report";
}
