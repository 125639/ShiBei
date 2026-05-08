import type { ResearchDepth } from "./research";
import type { SourceType } from "@prisma/client";
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

type GenerateSummaryInput = {
  modelConfig: {
    baseUrl: string;
    model: string;
    apiKeyEnc: string;
    temperature: number;
    maxTokens: number;
  };
  style: {
    tone: string;
    length: string;
    focus: string;
    outputStructure: string;
    promptTemplate: string;
  };
  item: {
    title: string;
    url: string;
    markdown: string;
  };
};

export type ChatModelConfig = GenerateSummaryInput["modelConfig"];

type GenerateNewsArticleInput = {
  modelConfig: GenerateSummaryInput["modelConfig"];
  style: GenerateSummaryInput["style"];
  keyword: string;
  scopeLabel: string;
  articleIndex: number;
  articleCount: number;
  depth: ResearchDepth;
  evidence: Array<{
    title: string;
    url: string;
    sourceName: string;
    summary: string;
    publishedAt?: Date | null;
  }>;
};

type GenerateDigestInput = {
  modelConfig: GenerateSummaryInput["modelConfig"];
  style: GenerateSummaryInput["style"];
  topicName: string;
  scopeLabel: string;
  windowLabel: string;
  digestKind: "DAILY_DIGEST" | "WEEKLY_ROUNDUP";
  evidence: GenerateNewsArticleInput["evidence"];
};

export async function generateSummary(input: GenerateSummaryInput) {
  const prompt = [
    input.style.promptTemplate,
    `语气：${input.style.tone}`,
    `长度：${input.style.length}`,
    `关注重点：${input.style.focus}`,
    `输出结构：${input.style.outputStructure}`,
    "不得编造输入材料之外的事实。没有视频资源就写无明确视频资源。",
    "请输出 Markdown。",
    "",
    `来源标题：${input.item.title}`,
    `来源链接：${input.item.url}`,
    "原始内容：",
    input.item.markdown.slice(0, 24000)
  ].join("\n");

  return requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是 拾贝 风格的信息整理助手，负责把来源材料整理成可审核发布的中文博客草稿。"
  );
}

export async function generateNewsArticle(input: GenerateNewsArticleInput) {
  const depthConfig = getDepthConfig(input.depth);
  const evidenceText = input.evidence
    .map((item, index) => [
      `资料 ${index + 1}`,
      `来源：${item.sourceName}`,
      `标题：${item.title}`,
      `链接：${item.url}`,
      item.publishedAt ? `时间：${item.publishedAt.toISOString()}` : null,
      `摘录：${item.summary.slice(0, 1000)}`
    ].filter(Boolean).join("\n"))
    .join("\n\n");

  const prompt = [
    `选题关键词：${input.keyword}`,
    `报道范围：${input.scopeLabel}`,
    `本次任务计划生成 ${input.articleCount} 篇，这是第 ${input.articleIndex} 篇。`,
    `报道长度：${depthConfig.label}，目标正文约 ${depthConfig.words} 个中文字符。`,
    `语气：${input.style.tone}`,
    `长度：${input.style.length}`,
    `关注重点：${input.style.focus}`,
    `输出结构偏好：${input.style.outputStructure}`,
    "",
    "请基于下面多条来源资料，写一篇可作为博客草稿发布的中文报道，而不是逐条摘要。",
    "要求：",
    "1. 标题要像正式新闻报道标题，不要写“总结”“摘要”“资料整理”。",
    "2. 开头必须是导语，用一段话写清楚最新事实、主体、时间、地点、影响和为什么重要。",
    "3. 正文采用报道结构：导语、核心事实、背景脉络、多方信息、影响分析、仍待确认的问题。",
    "4. 至少使用 4 个二级标题组织正文；每个章节必须是连续段落，不要只写 bullet。",
    "5. 只能使用资料中出现的信息；资料不足时明确写出“不足以确认”。",
    "6. 涉及不同来源说法不一致时，要标出分歧，不要替来源下结论。",
    "7. 如果同一任务生成多篇，请让本篇选择一个独立角度，避免和其他篇完全重复。",
    "8. 文末必须列出“参考来源”，用 Markdown 链接列出用到的来源。",
    `9. 输出 Markdown；正文不要短于 ${depthConfig.minWords} 个中文字符。`,
    "",
    "来源资料：",
    evidenceText.slice(0, 12000)
  ].join("\n");

  return requestChatCompletion(input.modelConfig, prompt, "你是一名严谨的中文新闻编辑，负责把多来源资料整合成有事实依据、可审核发布的新闻稿。不要编造，不要写成摘要列表。");
}

function getDepthConfig(depth: ResearchDepth) {
  if (depth === "standard") return { label: "标准报道", words: "1200", minWords: 900 };
  if (depth === "deep") return { label: "深度报道", words: "3200", minWords: 2400 };
  return { label: "长报道", words: "2000", minWords: 1500 };
}

export async function generateDigest(input: GenerateDigestInput) {
  const evidenceText = input.evidence
    .map((item, index) => [
      `资料 ${index + 1}`,
      `来源：${item.sourceName}`,
      `标题：${item.title}`,
      `链接：${item.url}`,
      item.publishedAt ? `时间：${item.publishedAt.toISOString()}` : null,
      `摘录：${item.summary.slice(0, 800)}`
    ].filter(Boolean).join("\n"))
    .join("\n\n");

  const isWeekly = input.digestKind === "WEEKLY_ROUNDUP";
  const formatLabel = isWeekly ? "周报综述" : "每日要闻";
  const wordTarget = isWeekly ? "2200" : "1500";
  const minWords = isWeekly ? "1700" : "1100";

  const prompt = [
    `主题：${input.topicName}`,
    `报道范围：${input.scopeLabel}`,
    `时间窗口：${input.windowLabel}`,
    `产出形式：${formatLabel}`,
    `语气：${input.style.tone}`,
    `关注重点：${input.style.focus}`,
    `输出结构偏好：${input.style.outputStructure}`,
    "",
    `请基于下面多条同主题、同时间窗口的来源资料，写一篇可作为博客发布的中文 ${formatLabel}。`,
    "要求：",
    `1. 这是 ${formatLabel}，不是逐条新闻总结，也不是单一事件报道。`,
    `2. 标题应像${isWeekly ? "周报" : "日报"}标题（例如「本周科技要闻：……」、「今日经济观察：……」），不要写"摘要""资料整理"。`,
    "3. 开头先写一段引言，告诉读者本期覆盖了几条主要事件、共同主题是什么。",
    "4. 正文按主题/事件分块组织，每个事件用二级标题，下面 1-2 段叙述（必须是连续段落，不要 bullet）。",
    "5. 不同事件之间可以做对比、串联或趋势分析；只能基于资料里的信息，不得凭空发挥。",
    "6. 资料不足以确认时，明确写出「资料中未提及」。",
    "7. 文末必须列出「参考来源」，用 Markdown 链接列出本期用到的来源。",
    `8. 输出 Markdown；正文不少于 ${minWords} 个中文字符，目标约 ${wordTarget} 个。`,
    "",
    "来源资料：",
    evidenceText.slice(0, 14000)
  ].join("\n");

  return requestChatCompletion(
    input.modelConfig,
    prompt,
    `你是一名严谨的中文新闻编辑，负责把同一主题、同一时间窗口的多条来源整合成一份${formatLabel}，要求事实有依据、可审核发布。不要写成 bullet 摘要。`
  );
}

type EstimateAudienceInput = {
  modelConfig: GenerateSummaryInput["modelConfig"];
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
  const apiKey = decryptSecret(modelConfig.apiKeyEnc);
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
    "Translate the following Chinese blog/news post into natural, publication-quality English.",
    "Return strict JSON only, with keys: title, summary, content.",
    "Keep Markdown structure and links in content. Do not add facts that are not present.",
    "Do not wrap the JSON in code fences.",
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
    "You are a careful bilingual news translator. Preserve meaning, names, numbers, citations and Markdown."
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
    "你是博客首页的 AI 助手，可以和用户聊天，也可以围绕当前页面的新闻内容做解释、追问、对比和写作建议。",
    "如果用户要求事实判断，只能基于上下文或明确说明需要查看原始来源。",
    "",
    "当前页面上下文：",
    input.context.slice(0, 16000) || "（无页面上下文）",
    "",
    "用户消息：",
    input.userMessage
  ].join("\n");

  return requestChatCompletion(
    input.modelConfig,
    prompt,
    "You are a concise, helpful AI assistant embedded in a news/blog website. Be factual and avoid unsupported claims."
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
    "你是用户的写作助手。只辅助用户当前文稿，不要发布、不保存、不把内容加入博客。",
    "可以续写、润色、列提纲、改标题、改结构或给修改建议。",
    "",
    "用户要求：",
    input.instruction || "请根据当前文稿给出下一步写作建议。",
    "",
    "当前文稿：",
    input.draft.slice(0, 30000) || "（空白文稿）"
  ].join("\n");

  if (input.apiKey) {
    return requestChatCompletionWithPlainKey(input.modelConfig, input.apiKey, prompt, "You are a practical writing assistant.");
  }
  return requestChatCompletion(input.modelConfig, prompt, "You are a practical writing assistant.");
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
