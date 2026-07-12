export type ContentMode = "report" | "analysis" | "explainer" | "tutorial" | "opinion" | "roundup" | "essay";

/**
 * 内置的专业博客风格。
 *
 * 这些值同时供首次 seed、后台新建风格表单和 API fallback 使用，避免三处
 * 默认提示词各自演进，最终让线上安装仍停留在旧的“新闻摘要”模板。
 */
export const DEFAULT_BLOG_STYLE = {
  name: "专业深度博客",
  contentMode: "analysis" as ContentMode,
  tone: "克制、清晰、专业，像资深作者而不是公关稿",
  length: "中",
  focus: "可核验事实, 关键机制, 因果边界, 利益相关方, 现实影响",
  outputStructure: "精准标题 → 直接导语 → 按论证需要设置小节 → 克制收束 → 参考来源",
  customInstructions: [
    "围绕一个明确问题或判断组织全文，用具体事实推进论述。",
    "清楚区分已证实事实、来源观点与作者分析；删去模板化摘要、泛泛背景、重复结论和为凑字数的铺陈。",
    "只有内容天然适合枚举时才使用列表。单一来源没有完整正文与至少两个可核验事实，或多来源不足以共同支撑明确问题时，不要扩写成文。"
  ].join("")
} as const;

type BundledStyleSignature = {
  name: string;
  contentMode: string;
  tone: string;
  length: string;
  focus: string;
  outputStructure: string;
  customInstructions: string;
  isDefault?: boolean;
};

/** 历史版本曾随安装包写入的默认风格；只匹配完整签名，绝不覆盖用户自定义。 */
const LEGACY_BUNDLED_STYLE_SIGNATURES: BundledStyleSignature[] = [
  {
    name: "默认新闻总结",
    contentMode: "report",
    tone: "客观新闻",
    length: "中",
    focus: "事实, 影响, 技术细节, 商业价值",
    outputStructure: "标题, 摘要, 关键点, 背景, 来源",
    customInstructions: "请将输入材料整理为中文新闻总结。保持事实清晰，不编造未出现的信息。输出 Markdown，包含：标题、摘要、关键点、背景、影响、来源链接。"
  },
  {
    name: "默认博客文章",
    contentMode: "analysis",
    tone: "客观",
    length: "中",
    focus: "核心事实, 行业影响, 背景脉络, 多方观点",
    outputStructure: "标题 → 导语 → 正文分章节叙述 → 背景分析 → 参考来源",
    customInstructions: "写一篇有深度的中文博客文章，要求正式标题、导语段落、分章节连贯叙述，禁止写成摘要或要点列表。"
  }
];

export function isLegacyBundledStyle(style: BundledStyleSignature) {
  // 如果管理员已经把另一个风格设为默认，旧行也属于被用户显式调整过的配置。
  if (style.isDefault === false) return false;
  return LEGACY_BUNDLED_STYLE_SIGNATURES.some((signature) =>
    (Object.keys(signature) as Array<keyof BundledStyleSignature>)
      .every((key) => style[key] === signature[key])
  );
}

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
