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

/**
 * 内置风格预设（除默认深度博客外的可选风格）。
 *
 * 目标是让不同主题的产出有明显不同的"腔调"，而不是同一模板换标题。
 * seed 按固定 id 创建缺失项，绝不覆盖已存在的行——管理员的编辑永远保留。
 * 每个预设的 customInstructions 都必须服从更高优先级的事实与发布规则。
 */
export const BUNDLED_STYLE_PRESETS: Array<{
  id: string;
  name: string;
  contentMode: ContentMode;
  tone: string;
  length: string;
  focus: string;
  outputStructure: string;
  customInstructions: string;
}> = [
  {
    id: "preset-news-brief",
    name: "新闻快报",
    contentMode: "report",
    tone: "干净利落，只把发生了什么讲清楚，不渲染不注水",
    length: "短",
    focus: "已确认事实, 时间线, 直接影响, 待确认事项",
    outputStructure: "单刀直入的标题 → 一段话讲清事件全貌 → 关键细节与数字 → 接下来值得盯什么",
    customInstructions: [
      "句子要短，信息密度要高；删掉一切空洞背景和套话。",
      "把「已确认」与「尚待确认」明确分开；没有新信息就不硬拉长度。"
    ].join("")
  },
  {
    id: "preset-explainer",
    name: "通俗科普",
    contentMode: "explainer",
    tone: "亲切耐心，像把事情讲给一个聪明但外行的朋友",
    length: "中",
    focus: "核心概念, 工作机制, 常见误解, 对普通人的现实意义",
    outputStructure: "用一个具体场景或问题开头 → 拆解原理 → 澄清常见误区 → 回到现实意义",
    customInstructions: [
      "多用类比和具体例子；每引入一个术语，立刻用大白话解释一遍。",
      "类比只帮助理解，不能替代准确表述；简化不得歪曲机制本身。"
    ].join("")
  },
  {
    id: "preset-column",
    name: "专栏评论",
    contentMode: "opinion",
    tone: "观点鲜明、笔锋利落，但讲道理、不扣帽子",
    length: "中",
    focus: "争议焦点, 论证与反驳, 各方利益格局, 判断的依据与边界",
    outputStructure: "亮明立场的标题 → 开门见山给出判断 → 层层论证并处理反对意见 → 有力收尾",
    customInstructions: [
      "必须清楚区分事实陈述与作者观点；观点要有论据支撑。",
      "至少正面处理一个最强的反对意见，而不是挑软柿子。"
    ].join("")
  },
  {
    id: "preset-feature",
    name: "特写叙事",
    contentMode: "essay",
    tone: "有画面感和节奏，像一篇杂志特写",
    length: "长",
    focus: "人物与场景, 冲突与转折, 具体细节, 事件在大背景中的位置",
    outputStructure: "从一个场景或细节切入 → 沿时间线或冲突推进 → 拉远到大图景 → 留有余味地收束",
    customInstructions: [
      "用具体细节替代形容词堆砌；叙事顺序服务于理解。",
      "所有场景与细节都必须来自证据材料，绝不虚构、不合成人物。"
    ].join("")
  },
  {
    id: "preset-casual",
    name: "轻松杂谈",
    contentMode: "roundup",
    tone: "轻快、幽默、口语化，但不油腻不刻薄",
    length: "中",
    focus: "有趣的点, 反差与冷知识, 与读者日常生活的连接",
    outputStructure: "抓人的开头 → 几个小节各讲透一个点 → 轻巧的收尾",
    customInstructions: [
      "幽默来自事实本身的反差与巧合，不靠贬损任何人；事实必须准确。",
      "口语化不等于啰嗦，每个小节仍要有真信息量。"
    ].join("")
  },
  {
    id: "preset-howto",
    name: "实操指南",
    contentMode: "tutorial",
    tone: "可靠的老手带新手，直接给可执行的建议",
    length: "中",
    focus: "步骤, 前提条件, 常见的坑, 如何验证做对了",
    outputStructure: "目标与前提 → 分步操作 → 常见问题与排查 → 完成检查清单",
    customInstructions: [
      "每个关键步骤都给出「怎么确认这一步成功了」。",
      "明确适用范围与不适用的情况，不过度承诺。"
    ].join("")
  }
];

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
