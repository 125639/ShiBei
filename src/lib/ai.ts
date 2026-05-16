import type { ResearchDepth } from "./research";
import type { SourceType } from "@prisma/client";
import { contentModeLabel, normalizeContentMode, type ContentMode } from "./content-style";
import { decryptSecret } from "./crypto";
import { prisma } from "./prisma";

let cachedPrefix: { value: string; ts: number } | null = null;
const PREFIX_TTL_MS = 30_000;

async function loadGlobalPromptPrefix(): Promise<string> {
  const now = Date.now();
  if (cachedPrefix && now - cachedPrefix.ts < PREFIX_TTL_MS) return cachedPrefix.value;
  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
    const prefix = (settings as { globalPromptPrefix?: string } | null)?.globalPromptPrefix?.trim() || "";
    cachedPrefix = { value: prefix, ts: now };
    return prefix;
  } catch {
    return "";
  }
}

function isReasoningModel(model: string): boolean {
  const m = (model || "").toLowerCase();
  return (
    m.includes("kimi-k2") ||
    m.includes("deepseek-r1") ||
    m.includes("deepseek-reasoner") ||
    m.includes("/o1") ||
    m.includes("/o3") ||
    m.includes("/o4") ||
    m.includes("reasoning")
  );
}

/**
 * Pick a per-request HTTP timeout for the model call. Reasoning models
 * (Kimi-k2.6, DeepSeek-R1, OpenAI o*) often spend several minutes on
 * chain-of-thought before emitting any visible content.
 *
 * Heuristic: name/model substring match. The bound also respects an env
 * override (`AI_REQUEST_TIMEOUT_MS`) so admins can extend it without code
 * changes.
 */
function pickTimeoutMs(modelConfig: { model: string }): number {
  const envOverride = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;
  return isReasoningModel(modelConfig.model) ? 600_000 : 240_000; // 10min vs 4min
}

/**
 * Reasoning 模型(Kimi-K2.6 / DeepSeek-R1 / o1/o3/o4 ...)在产出最终 content
 * 之前会先把多条思考链塞进 reasoning_content,而思考链同样计入 max_tokens
 * 配额。如果 admin 在后台把 maxTokens 设得偏保守(例如 2000),思考阶段就把
 * 预算耗光,响应里 content 为 null 且 finish_reason=length,worker 拿不到正
 * 文,只能落 fallback 草稿——这正是 ai.ts 早期 reasoning_content 兜底逻辑
 * 出现的根本诱因(见 requestChatCompletionWithKey 内的注释)。
 *
 * 这里给 reasoning 模型抬一个下限,默认 8000(够覆盖思考+一篇长报道);admin
 * 可通过 AI_REASONING_MIN_TOKENS env 调整。普通模型保持 admin 配的原值。
 */
function computeMaxTokens(modelConfig: { model: string; maxTokens: number }): number {
  const configured = modelConfig.maxTokens;
  if (!isReasoningModel(modelConfig.model)) return configured;
  const envFloor = Number(process.env.AI_REASONING_MIN_TOKENS);
  const floor = Number.isFinite(envFloor) && envFloor > 0 ? envFloor : 8000;
  return Math.max(configured, floor);
}

// ── 共享类型 ──────────────────────────────────────────────

export type ChatModelConfig = {
  baseUrl: string;
  model: string;
  apiKeyEnc: string;
  temperature: number;
  maxTokens: number;
};

export type StyleConfig = {
  contentMode: string;
  tone: string;
  length: string;
  focus: string;
  outputStructure: string;
  customInstructions: string;
};

export type EvidenceItem = {
  title: string;
  url: string;
  sourceName: string;
  summary: string;
  publishedAt?: Date | null;
};

type GenerateSummaryInput = {
  modelConfig: ChatModelConfig;
  style: StyleConfig;
  item: {
    title: string;
    url: string;
    markdown: string;
  };
};

type GenerateContentArticleInput = {
  modelConfig: ChatModelConfig;
  style: StyleConfig;
  keyword: string;
  scopeLabel: string;
  articleIndex: number;
  articleCount: number;
  depth: ResearchDepth;
  evidence: EvidenceItem[];
};

type GenerateDigestInput = {
  modelConfig: ChatModelConfig;
  style: StyleConfig;
  topicName: string;
  scopeLabel: string;
  windowLabel: string;
  digestKind: "DAILY_DIGEST" | "WEEKLY_ROUNDUP";
  evidence: EvidenceItem[];
};

// ── 共享 prompt 构建辅助 ──────────────────────────────────

/** 拼装管理员配置的体裁和风格参数，作为所有内容生成 prompt 的稳定入口。 */
export function formatStyleBlock(style: StyleConfig): string {
  const mode = normalizeContentMode(style.contentMode);
  return [
    "【风格设定】",
    `- 内容体裁：${contentModeLabel(mode)}`,
    `- 语气风格：${style.tone}`,
    `- 目标篇幅：${style.length}`,
    `- 侧重方向：${style.focus}`,
    `- 期望结构：${style.outputStructure}`,
    "",
    "【管理员自定义要求】",
    style.customInstructions || "无"
  ].join("\n");
}

export function modeInstruction(modeValue: string) {
  const mode = normalizeContentMode(modeValue);
  const map: Record<ContentMode, string[]> = {
    report: [
      "体裁目标：报道。用清晰的事实线索推进全文，优先回答发生了什么、涉及谁、为何重要。",
      "结构建议：导语 -> 核心事实 -> 背景 -> 影响 -> 未确认问题。"
    ],
    analysis: [
      "体裁目标：深度分析。不要只罗列材料，要解释背景、因果链、利益相关方和可能影响。",
      "结构建议：问题定义 -> 关键变化 -> 原因分析 -> 影响评估 -> 后续观察。"
    ],
    explainer: [
      "体裁目标：科普解读。用读者容易理解的语言拆解概念、机制和上下文。",
      "结构建议：先说明为什么值得理解，再分层解释术语、流程、例子和常见误解。"
    ],
    tutorial: [
      "体裁目标：教程指南。把来源材料转化为可执行的步骤、检查项和注意事项。",
      "结构建议：适用场景 -> 准备条件 -> 操作步骤 -> 风险提醒 -> 延伸资料。"
    ],
    opinion: [
      "体裁目标：观点评论。可以形成明确判断，但必须把事实、推论和价值判断分开。",
      "结构建议：核心观点 -> 事实依据 -> 反方或限制 -> 判断理由 -> 结论。"
    ],
    roundup: [
      "体裁目标：合集/周报。把多条材料按主题串联，提炼共同趋势，不逐条机械摘要。",
      "结构建议：总览 -> 分主题小节 -> 共同趋势 -> 值得继续关注的问题。"
    ],
    essay: [
      "体裁目标：随笔专栏。保持叙述性和可读性，但不能牺牲事实边界。",
      "结构建议：以一个清晰切入点开头，再展开背景、观察和收束性的结尾。"
    ]
  };
  return map[mode].join("\n");
}

export function sourceBoundaryRules() {
  return [
    "事实边界：",
    "- 只能使用来源材料中明确出现的信息。",
    "- 来源不足以确认时，明确写出「来源未提及」「资料不足以确认」或「仍需进一步确认」。",
    "- 不编造数据、引语、时间线、因果关系、人物态度或未给出的背景。",
    "- 不复制粘贴原文长段落，要用自己的语言重组。",
    "- 文末必须保留「## 参考来源」，用 Markdown 链接列出使用到的来源。"
  ].join("\n");
}

/** 将 evidence 数组格式化为编号资料块，供 prompt 引用 */
function formatEvidenceText(evidence: EvidenceItem[], summaryLimit = 1000): string {
  return evidence
    .map((item, index) => {
      const lines = [
        `--- 资料 ${index + 1} ---`,
        `来源：${item.sourceName}`,
        `标题：${item.title}`,
        `链接：${item.url}`
      ];
      if (item.publishedAt) lines.push(`发布时间：${item.publishedAt.toISOString()}`);
      lines.push(`内容摘录：${item.summary.slice(0, summaryLimit)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * 根据篇幅偏好返回对应的字数指导。
 * generateSummary 用；generateContentArticle 有自己的 depthConfig。
 */
function lengthGuide(length: string): string {
  switch (length) {
    case "短": return "约 600-800 字";
    case "长": return "约 1800-2500 字";
    default:  return "约 1000-1500 字";
  }
}


export async function generateSummary(input: GenerateSummaryInput) {
  const mode = normalizeContentMode(input.style.contentMode);
  const prompt = [
    formatStyleBlock(input.style),
    "",
    "【任务】",
    `请基于下面的来源材料，写一篇可以作为博客文章草稿发布的中文${contentModeLabel(mode)}。`,
    "",
    "【体裁要求】",
    modeInstruction(mode),
    "",
    "【写作规范】",
    "1. 标题用 #，不能出现「总结」「摘要」「资料整理」等流水账字眼。",
    "2. 第一段直接进入主题，交代读者为什么要看这篇文章。",
    "3. 正文至少使用 3 个 ## 二级标题，段落要连贯，不要退化成 bullet 列表。",
    `4. 目标篇幅：${lengthGuide(input.style.length)}。篇幅偏短时也必须保持完整结构。`,
    `5. ${sourceBoundaryRules()}`,
    "6. 全文输出 Markdown，不要解释写作过程。",
    "",
    "【来源材料】",
    `标题：${input.item.title}`,
    `链接：${input.item.url}`,
    "正文内容：",
    input.item.markdown.slice(0, 24000)
  ].join("\n");

  const system = [
    "你是「拾贝」博客平台的资深中文内容编辑。",
    `你要把来源材料改写成结构完整、事实准确、适合发布的中文${contentModeLabel(mode)}。`,
    "严格禁止编造事实、复制粘贴原文、输出写作过程或把文章写成机械摘要列表。"
  ].join("\n");

  return requestChatCompletion(input.modelConfig, prompt, system);
}

export async function generateContentArticle(input: GenerateContentArticleInput) {
  const depthConfig = getDepthConfig(input.depth);
  const mode = normalizeContentMode(input.style.contentMode);

  const prompt = [
    formatStyleBlock(input.style),
    "",
    "【任务信息】",
    `选题关键词：${input.keyword}`,
    `资料范围：${input.scopeLabel}`,
    `本次任务计划生成 ${input.articleCount} 篇，这是第 ${input.articleIndex} 篇。`,
    `内容体裁：${contentModeLabel(mode)}`,
    `文章长度：${depthConfig.label}，目标正文约 ${depthConfig.words} 个中文字符。`,
    "",
    "【体裁要求】",
    modeInstruction(mode),
    "",
    "【写作规范】",
    `请基于下面多条来源资料，写一篇可作为博客草稿发布的中文${contentModeLabel(mode)}。要求如下：`,
    "1. 标题用 #，要体现核心主题或观点，禁止出现「总结」「摘要」「资料整理」等字眼。",
    "2. 开头用一段话给出文章切入点，说明这组资料为什么值得读。",
    "3. 正文至少使用 4 个 ## 二级标题；每个章节必须是连贯段落，不要只写 bullet。",
    "4. 不要逐条转述每条资料，要融合多来源信息并组织成一篇完整文章。",
    `5. ${sourceBoundaryRules()}`,
    "6. 同一任务多篇时，请选择独立角度，避免和其他篇完全重复。",
    `7. 输出 Markdown；正文不要短于 ${depthConfig.minWords} 个中文字符。`,
    "",
    "【来源资料】",
    formatEvidenceText(input.evidence).slice(0, 12000)
  ].join("\n");

  const system = [
    "你是「拾贝」博客平台的资深中文内容编辑。",
    `你的职责是把多来源资料整合成一篇有事实依据、可审核发布的中文${contentModeLabel(mode)}。`,
    "严格禁止编造事实、写成机械摘要列表、逐条复述每条资料。"
  ].join("\n");

  const generated = await requestChatCompletion(input.modelConfig, prompt, system);
  return expandContentArticleIfTooShort(input, generated, depthConfig);
}

function getDepthConfig(depth: ResearchDepth) {
  if (depth === "standard") return { label: "标准文章", words: 1200, minWords: 1100 };
  if (depth === "deep") return { label: "深度长文", words: 3200, minWords: 3000 };
  return { label: "长文章", words: 2000, minWords: 1900 };
}

async function expandContentArticleIfTooShort(
  input: GenerateContentArticleInput,
  generated: string,
  depthConfig: ReturnType<typeof getDepthConfig>
) {
  const currentChars = countArticleBodyChars(generated);
  if (currentChars >= depthConfig.minWords) return generated;
  const mode = normalizeContentMode(input.style.contentMode);

  const prompt = [
    `下面是一篇已经生成的中文${contentModeLabel(mode)}草稿，但它没有达到后台选择的长度要求。`,
    "",
    "【硬性长度要求】",
    `- 当前正文有效字符数约 ${currentChars}。`,
    `- 必须扩写到不少于 ${depthConfig.minWords} 个中文正文字符，目标约 ${depthConfig.words} 个中文正文字符。`,
    "- 正文字符不包含标题、参考来源列表、Markdown 标记和链接 URL。",
    "",
    "【扩写规则】",
    "1. 保留原有 Markdown 结构和参考来源章节。",
    "2. 只能基于来源资料和原草稿已经出现的事实扩写，不得新增来源资料之外的事实、日期、数字或引用。",
    "3. 根据体裁优先扩写背景脉络、影响分析、操作细节、概念解释、反方限制或待确认问题。",
    "4. 输出完整 Markdown 正文，不要解释你做了什么。",
    "",
    "【原草稿】",
    generated,
    "",
    "【来源资料】",
    formatEvidenceText(input.evidence, 700).slice(0, 10000)
  ].join("\n");

  return requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是严格的中文内容编辑。你的任务是把短稿扩写到指定字数，同时保持事实边界，不编造任何来源资料之外的信息。"
  );
}

function countArticleBodyChars(markdown: string) {
  const body = markdown.split(/\n##\s*参考来源/i)[0] || markdown;
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~#\-\[\]().,，。！？!?;；:："'“”‘’、\s]/g, "")
    .length;
}

export async function generateDigest(input: GenerateDigestInput) {
  const isWeekly = input.digestKind === "WEEKLY_ROUNDUP";
  const formatLabel = isWeekly ? "周报/合集" : "每日合集";
  const wordTarget = isWeekly ? "2200" : "1500";
  const minWords = isWeekly ? "1700" : "1100";
  const mode = normalizeContentMode(input.style.contentMode || "roundup");

  const prompt = [
    formatStyleBlock(input.style),
    "",
    "【任务信息】",
    `主题：${input.topicName}`,
    `资料范围：${input.scopeLabel}`,
    `时间窗口：${input.windowLabel}`,
    `产出形式：${formatLabel}`,
    `内容体裁：${contentModeLabel(mode)}`,
    "",
    "【体裁要求】",
    modeInstruction(mode === "report" ? "roundup" : mode),
    "",
    "【写作规范】",
    `请基于下面多条同主题、同时间窗口的来源资料，写一篇可作为博客发布的中文${formatLabel}。`,
    `1. 这是 ${formatLabel}，不是逐条材料摘要，也不应写成单一事件稿。`,
    `2. 标题应体现本期主题或共同线索，禁止使用「摘要」「资料整理」。`,
    "3. 开头写一段引言，概括本期覆盖的主要材料和共同趋势。",
    "4. 正文按主题/事件/问题分块组织，每个小节用 ## 二级标题，下方必须是连续段落。",
    "5. 材料之间可以做对比、串联或趋势分析；只能基于资料中的信息，不得凭空发挥。",
    `6. ${sourceBoundaryRules()}`,
    `7. 输出 Markdown；正文不少于 ${minWords} 个中文字符，目标约 ${wordTarget} 个。`,
    "",
    "【来源资料】",
    formatEvidenceText(input.evidence, 800).slice(0, 14000)
  ].join("\n");

  const system = [
    `你是「拾贝」博客平台的资深中文内容编辑，负责把同一主题、同一时间窗口的多条来源整合成一份${formatLabel}。`,
    "要求事实有依据、可审核发布。不要写成 bullet 摘要，不要逐条复述资料。"
  ].join("\n");

  return requestChatCompletion(input.modelConfig, prompt, system);
}

type EstimateAudienceInput = {
  modelConfig: ChatModelConfig;
  sourceName: string;
  sourceUrl: string;
  sourceType: SourceType;
  rawMetrics: string;
  pageText: string;
};

export async function estimateAudience(input: EstimateAudienceInput): Promise<number> {
  const typeLabel = input.sourceType === "VIDEO" ? "视频频道" : input.sourceType === "RSS" ? "RSS源" : "网站";

  const prompt = [
    `来源名称：${input.sourceName}`,
    `来源URL：${input.sourceUrl}`,
    `来源类型：${typeLabel}`,
    "",
    "请根据以下信息，估算该来源的预估月均受众规模（月均读者/观众人数）。",
    "如果页面数据中有明确的订阅数或粉丝数，直接使用该数字。",
    "如果没有明确数字，根据以下规则推理：",
    "- 知名国际媒体（如BBC、Reuters、NYT等）：1000万-5000万",
    "- 知名国内媒体（如新华社、央视、澎湃等）：500万-3000万",
    "- 中型科技/垂直媒体：50万-500万",
    "- 中小博客/个人站：1万-30万",
    "- YouTube/Bilibili频道根据抓到的订阅数",
    "- 未知新站点：1万-10万",
    "",
    "页面抓取数据：",
    input.rawMetrics || "（无页面数据）",
    "",
    "页面文本片段：",
    (input.pageText || "（无页面文本）").slice(0, 4000),
    "",
    "请仅返回一个数字（纯整数，不含逗号、空格、单位），表示预估月均受众。"
  ].join("\n");

  const response = await requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是一个专门估算媒体来源受众规模的AI助手。请严格只输出一个整数，不要任何解释文字、标点或单位。"
  );

  const cleaned = response.trim().replace(/[,\s`'"]/g, "").replace(/[^.0-9]/g, "");
  const parsed = parseInt(cleaned, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function requestChatCompletion(
  modelConfig: ChatModelConfig,
  prompt: string,
  system: string
) {
  let apiKey: string;
  try {
    apiKey = decryptSecret(modelConfig.apiKeyEnc);
  } catch {
    throw new Error(
      "模型 API Key 无法解密：当前 ENCRYPTION_KEY/AUTH_SECRET 与保存该模型配置时不一致。请到「系统设置 > 模型」重新填写并保存该模型的 API Key。"
    );
  }
  return requestChatCompletionWithKey(modelConfig, apiKey, prompt, system);
}

export async function requestChatCompletionWithPlainKey(
  modelConfig: Omit<ChatModelConfig, "apiKeyEnc">,
  apiKey: string,
  prompt: string,
  system: string
) {
  return requestChatCompletionWithKey({ ...modelConfig, apiKeyEnc: "" }, apiKey, prompt, system);
}

async function requestChatCompletionWithKey(
  modelConfig: ChatModelConfig,
  apiKey: string,
  prompt: string,
  system: string
) {
  const baseUrl = modelConfig.baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  // Reasoning models (Kimi-k2.6, DeepSeek-R1, ...) often spend several minutes
  // on chain-of-thought before they emit content, especially for digest
  // prompts with 16+ evidence items. 180s used to abort us before the model
  // ever produced a token. 10 minutes is long enough for the worst case;
  // BullMQ's per-job lockDuration is 300s and is renewed automatically.
  const timeoutMs = pickTimeoutMs(modelConfig);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const prefix = await loadGlobalPromptPrefix();
  const finalSystem = prefix ? `${prefix}\n\n${system}` : system;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      max_tokens: computeMaxTokens(modelConfig),
      messages: [
        { role: "system", content: finalSystem },
        { role: "user", content: prompt }
      ]
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Model request failed: ${response.status} ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  // 严格只取 choices[0].message.content。Reasoning 模型(Kimi-k2.6 /
  // DeepSeek-R1 / o1 / o3 / o4) 会把思考链放进 reasoning_content；之前为
  // 了避免空内容失败而兜底到 reasoning_content,结果当模型把 prompt 复述
  // 进思考流(例如"用户要求我...让我先分析...要求：1. 选题关键词：")时,
  // 这段思考流被原样落库到 Post.content,再被详情页直接渲染给读者。content
  // 为空时让上层 worker 走 buildResearchFallbackDraft / buildDigestFallback,
  // 不要冒险拿 reasoning_content 当正文。
  const choice = data.choices?.[0]?.message;
  const rawContent = choice?.content;
  const content = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!content) {
    const finishReason = data.choices?.[0]?.finish_reason || "unknown";
    throw new Error(`Model returned empty content (finish_reason=${finishReason})`);
  }
  return content;
}

export async function translatePostToEnglish(input: {
  modelConfig: ChatModelConfig;
  title: string;
  summary: string;
  content: string;
}) {
  const prompt = [
    "Translate the following Chinese blog/posts post into natural, publication-quality English.",
    "",
    "Rules:",
    "1. Return strict JSON only with keys: title, summary, content.",
    "2. Do NOT wrap the JSON in code fences or add any text outside the JSON.",
    "3. Preserve all Markdown formatting, headings, links, and structure in content.",
    "4. Do not add, remove, or change any facts.",
    "5. Keep proper nouns (person names, company names, place names) in their commonly used English forms.",
    "6. Translate Chinese idioms into natural English equivalents, not literal translations.",
    "7. If the original uses Chinese-specific references (e.g. policy names), keep the original term in parentheses after the translation.",
    "",
    `Title: ${input.title}`,
    "",
    `Summary: ${input.summary}`,
    "",
    "Markdown content:",
    input.content.slice(0, 30000)
  ].join("\n");

  const raw = await requestChatCompletion(
    input.modelConfig,
    prompt,
    "You are a professional bilingual blog translator (Chinese \u2192 English). Produce natural, publication-ready English while preserving meaning, names, numbers, citations, and Markdown structure. Output strict JSON only."
  );
  const parsed = parseJsonObject(raw) as { title?: string; summary?: string; content?: string };
  return {
    title: String(parsed.title || input.title).slice(0, 240),
    summary: String(parsed.summary || input.summary),
    content: String(parsed.content || raw)
  };
}

export async function generateAssistantReply(input: {
  modelConfig: ChatModelConfig;
  userMessage: string;
  context: string;
  language: "zh" | "en";
}) {
  const prompt = [
    input.language === "en" ? "Reply in English." : "请用中文回答。",
    "",
    "【角色】",
    "你是「拾贝」博客的 AI 助手，嵌入在文章页面中。你可以：",
    "- 解释当前页面的文章内容、背景和影响",
    "- 回答用户关于文章的追问和对比",
    "- 给出写作建议和内容延伸",
    "",
    "【规则】",
    "- 事实判断只能基于下方提供的页面上下文",
    "- 如果上下文中没有相关信息，坦诚告知用户并建议查看原始来源",
    "- 回答要简洁实用，避免冗长",
    "- 用户只发感叹、问号、单字或语义不完整时，不要猜测其真实意图；先用一句自然的话请用户说明想问什么",
    "- 默认用自然段回答；除非用户要求列清单，否则不要使用 Markdown 加粗、标题、编号或项目符号",
    "- 不要用「看起来您……」这类套话开头；直接回答或直接澄清",
    "",
    "【当前页面上下文】",
    input.context.slice(0, 16000) || "（无页面上下文）",
    "",
    "【用户消息】",
    input.userMessage
  ].join("\n");

  return requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是「拾贝」博客的 AI 助手。回答简洁、有事实依据、语气自然。不要编造信息，不确定时要说明。默认不要用 Markdown 加粗或标题。"
  );
}

export async function generateWritingAssist(input: {
  modelConfig: ChatModelConfig;
  apiKey?: string;
  draft: string;
  instruction: string;
  language: "zh" | "en";
}) {
  const prompt = [
    input.language === "en" ? "Write in English unless the user asks otherwise." : "默认使用中文，除非用户明确要求其他语言。",
    "",
    "【角色】",
    "你是用户的写作助手。只辅助用户当前文稿，不要发布、不保存、不把内容加入博客。",
    "你可以：续写、润色、列提纲、改标题、调整结构、给修改建议。",
    "",
    "【用户要求】",
    input.instruction || "请根据当前文稿给出下一步写作建议。",
    "",
    "【当前文稿】",
    input.draft.slice(0, 30000) || "（空白文稿）"
  ].join("\n");

  const writingSystem = "你是「拾贝」博客的写作助手。专注于提升文稿质量，回答要具体、可操作。";
  if (input.apiKey) {
    return requestChatCompletionWithPlainKey(input.modelConfig, input.apiKey, prompt, writingSystem);
  }
  return requestChatCompletion(input.modelConfig, prompt, writingSystem);
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model did not return valid JSON");
  }
}
