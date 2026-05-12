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

// ── 共享类型 ──────────────────────────────────────────────

export type ChatModelConfig = {
  baseUrl: string;
  model: string;
  apiKeyEnc: string;
  temperature: number;
  maxTokens: number;
};

export type StyleConfig = {
  tone: string;
  length: string;
  focus: string;
  outputStructure: string;
  promptTemplate: string;
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

type GenerateNewsArticleInput = {
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

/** 拼装管理员配置的风格参数，作为 prompt 的 metadata 段落 */
function formatStyleBlock(style: StyleConfig): string {
  return [
    "【风格设定】",
    style.promptTemplate,
    `- 语气风格：${style.tone}`,
    `- 目标篇幅：${style.length}`,
    `- 侧重方向：${style.focus}`,
    `- 期望结构：${style.outputStructure}`
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
 * generateSummary 用；generateNewsArticle 有自己的 depthConfig。
 */
function lengthGuide(length: string): string {
  switch (length) {
    case "短": return "约 600-800 字";
    case "长": return "约 1800-2500 字";
    default:  return "约 1000-1500 字";
  }
}


export async function generateSummary(input: GenerateSummaryInput) {
  const prompt = [
    formatStyleBlock(input.style),
    "",
    "\u3010\u4efb\u52a1\u3011",
    "\u8bf7\u57fa\u4e8e\u4e0b\u9762\u7684\u6765\u6e90\u6750\u6599\uff0c\u5199\u4e00\u7bc7\u53ef\u4ee5\u76f4\u63a5\u4f5c\u4e3a\u535a\u5ba2\u6587\u7ae0\u53d1\u5e03\u7684\u4e2d\u6587\u6df1\u5ea6\u62a5\u9053\u6216\u89e3\u8bfb\u6587\u7ae0\u3002",
    "",
    "\u3010\u5199\u4f5c\u89c4\u8303\u3011",
    "1. \u6807\u9898\uff1a\u50cf\u6b63\u5f0f\u5a92\u4f53\u6807\u9898\uff0c\u4f53\u73b0\u6838\u5fc3\u4e8b\u4ef6\u6216\u89c2\u70b9\uff0c\u7981\u6b62\u51fa\u73b0\u300c\u603b\u7ed3\u300d\u300c\u6458\u8981\u300d\u300c\u8981\u70b9\u6574\u7406\u300d\u300c\u76d8\u70b9\u300d\u7b49\u5b57\u773c\u3002",
    "2. \u5bfc\u8bed\uff08\u7b2c\u4e00\u6bb5\uff09\uff1a\u7528 2-3 \u53e5\u8bdd\u4ea4\u4ee3\u6700\u6838\u5fc3\u7684\u4e8b\u5b9e\u2014\u2014\u8c01\u505a\u4e86\u4ec0\u4e48\u3001\u4e3a\u4ec0\u4e48\u503c\u5f97\u5173\u6ce8\u3001\u5bf9\u8bfb\u8005\u6709\u4ec0\u4e48\u5f71\u54cd\u3002",
    "3. \u6b63\u6587\u7ed3\u6784\uff1a",
    "   - \u81f3\u5c11\u4f7f\u7528 3 \u4e2a ## \u4e8c\u7ea7\u6807\u9898\u5212\u5206\u7ae0\u8282",
    "   - \u6bcf\u4e2a\u7ae0\u8282\u5fc5\u987b\u662f\u8fde\u8d2f\u7684\u53d9\u8ff0\u6bb5\u843d\uff083-5 \u53e5\uff09\uff0c\u4e0d\u8981\u9000\u5316\u4e3a bullet \u5217\u8868",
    "   - \u7ae0\u8282\u4e4b\u95f4\u8981\u6709\u8fc7\u6e21\u53e5\uff0c\u8ba9\u5168\u6587\u8bfb\u8d77\u6765\u50cf\u4e00\u7bc7\u5b8c\u6574\u6587\u7ae0\u800c\u4e0d\u662f\u62fc\u51d1\u7684\u7247\u6bb5",
    `4. \u76ee\u6807\u7bc7\u5e45\uff1a${lengthGuide(input.style.length)}\u3002\u5373\u4f7f\u7bc7\u5e45\u504f\u77ed\u4e5f\u5fc5\u987b\u4fdd\u6301\u5b8c\u6574\u7684\u53d9\u8ff0\u7ed3\u6784\u3002`,
    "5. \u4e8b\u5b9e\u7eaa\u5f8b\uff1a",
    "   - \u53ea\u80fd\u4f7f\u7528\u6765\u6e90\u6750\u6599\u4e2d\u660e\u786e\u51fa\u73b0\u7684\u4fe1\u606f",
    "   - \u6765\u6e90\u4e0d\u8db3\u4ee5\u786e\u8ba4\u7684\u5185\u5bb9\uff0c\u5199\u300c\u6765\u6e90\u672a\u63d0\u53ca\u300d\u6216\u300c\u5c1a\u5f85\u8fdb\u4e00\u6b65\u786e\u8ba4\u300d",
    "   - \u4e0d\u8981\u7f16\u9020\u6570\u636e\u3001\u5f15\u8a00\u3001\u65f6\u95f4\u7ebf\u6216\u56e0\u679c\u5173\u7cfb",
    "6. \u6587\u672b\u5217\u51fa\u300c## \u53c2\u8003\u6765\u6e90\u300d\u7ae0\u8282\uff0c\u7528 Markdown \u94fe\u63a5\u683c\u5f0f\u6807\u6ce8\u3002",
    "7. \u5168\u6587\u8f93\u51fa Markdown \u683c\u5f0f\uff0c\u6807\u9898\u7528 #\uff0c\u6b63\u6587\u7ae0\u8282\u7528 ##\u3002",
    "",
    "\u3010\u6765\u6e90\u6750\u6599\u3011",
    `\u6807\u9898\uff1a${input.item.title}`,
    `\u94fe\u63a5\uff1a${input.item.url}`,
    "\u6b63\u6587\u5185\u5bb9\uff1a",
    input.item.markdown.slice(0, 24000)
  ].join("\n");

  const system = [
    "\u4f60\u662f\u300c\u62fe\u8d1d\u300d\u535a\u5ba2\u5e73\u53f0\u7684\u8d44\u6df1\u4e2d\u6587\u7f16\u8f91\u3002",
    "\u4f60\u7684\u804c\u8d23\u662f\u628a\u6765\u6e90\u6750\u6599\u6539\u5199\u6210\u4e00\u7bc7\u7ed3\u6784\u5b8c\u6574\u3001\u4e8b\u5b9e\u51c6\u786e\u3001\u9002\u5408\u76f4\u63a5\u53d1\u5e03\u7684\u535a\u5ba2\u6587\u7ae0\u3002",
    "\u4e25\u683c\u7981\u6b62\uff1a\u7f16\u9020\u4e8b\u5b9e\u3001\u5199\u6210\u6458\u8981\u6216\u8981\u70b9\u5217\u8868\u3001\u590d\u5236\u7c98\u8d34\u539f\u6587\u3001\u5728\u6807\u9898\u4e2d\u4f7f\u7528\u300c\u603b\u7ed3\u300d\u7b49\u8bcd\u3002",
    "\u4f60\u5fc5\u987b\u7528\u81ea\u5df1\u7684\u8bed\u8a00\u91cd\u65b0\u7ec4\u7ec7\u4fe1\u606f\uff0c\u50cf\u8bb0\u8005\u5199\u7a3f\u4e00\u6837\u53d9\u8ff0\u4e8b\u5b9e\u3002"
  ].join("\n");

  return requestChatCompletion(input.modelConfig, prompt, system);
}

export async function generateNewsArticle(input: GenerateNewsArticleInput) {
  const depthConfig = getDepthConfig(input.depth);

  const prompt = [
    formatStyleBlock(input.style),
    "",
    "\u3010\u4efb\u52a1\u4fe1\u606f\u3011",
    `\u9009\u9898\u5173\u952e\u8bcd\uff1a${input.keyword}`,
    `\u62a5\u9053\u8303\u56f4\uff1a${input.scopeLabel}`,
    `\u672c\u6b21\u4efb\u52a1\u8ba1\u5212\u751f\u6210 ${input.articleCount} \u7bc7\uff0c\u8fd9\u662f\u7b2c ${input.articleIndex} \u7bc7\u3002`,
    `\u62a5\u9053\u957f\u5ea6\uff1a${depthConfig.label}\uff0c\u76ee\u6807\u6b63\u6587\u7ea6 ${depthConfig.words} \u4e2a\u4e2d\u6587\u5b57\u7b26\u3002`,
    "",
    "\u3010\u5199\u4f5c\u89c4\u8303\u3011",
    "\u8bf7\u57fa\u4e8e\u4e0b\u9762\u591a\u6761\u6765\u6e90\u8d44\u6599\uff0c\u5199\u4e00\u7bc7\u53ef\u4f5c\u4e3a\u535a\u5ba2\u8349\u7a3f\u53d1\u5e03\u7684\u4e2d\u6587\u62a5\u9053\u3002\u8981\u6c42\u5982\u4e0b\uff1a",
    "1. \u6807\u9898\uff1a\u50cf\u6b63\u5f0f\u65b0\u95fb\u62a5\u9053\u6807\u9898\uff0c\u7981\u6b62\u51fa\u73b0\u300c\u603b\u7ed3\u300d\u300c\u6458\u8981\u300d\u300c\u8d44\u6599\u6574\u7406\u300d\u7b49\u5b57\u773c\u3002",
    "2. \u5bfc\u8bed\uff1a\u7528\u4e00\u6bb5\u8bdd\u5199\u6e05\u695a\u6700\u65b0\u4e8b\u5b9e\u3001\u4e3b\u4f53\u3001\u65f6\u95f4\u3001\u5730\u70b9\u3001\u5f71\u54cd\u548c\u4e3a\u4ec0\u4e48\u91cd\u8981\u3002",
    "3. \u6b63\u6587\u91c7\u7528\u62a5\u9053\u7ed3\u6784\uff1a\u5bfc\u8bed\u2192\u6838\u5fc3\u4e8b\u5b9e\u2192\u80cc\u666f\u8109\u7edc\u2192\u591a\u65b9\u4fe1\u606f\u2192\u5f71\u54cd\u5206\u6790\u2192\u5f85\u786e\u8ba4\u95ee\u9898\u3002",
    "4. \u81f3\u5c11\u4f7f\u7528 4 \u4e2a ## \u4e8c\u7ea7\u6807\u9898\u7ec4\u7ec7\u6b63\u6587\uff1b\u6bcf\u4e2a\u7ae0\u8282\u5fc5\u987b\u662f\u8fde\u8d2f\u53d9\u8ff0\u6bb5\u843d\uff0c\u4e0d\u8981\u53ea\u5199 bullet\u3002",
    "5. \u4e0d\u8981\u9010\u6761\u8f6c\u8ff0\u6bcf\u6761\u8d44\u6599\uff0c\u800c\u662f\u628a\u591a\u6761\u8d44\u6599\u878d\u5408\u3001\u7efc\u5408\u53d9\u8ff0\uff0c\u50cf\u8bb0\u8005\u5199\u7a3f\u4e00\u6837\u3002",
    "6. \u53ea\u80fd\u4f7f\u7528\u8d44\u6599\u4e2d\u51fa\u73b0\u7684\u4fe1\u606f\uff1b\u8d44\u6599\u4e0d\u8db3\u65f6\u660e\u786e\u5199\u51fa\u300c\u4e0d\u8db3\u4ee5\u786e\u8ba4\u300d\u3002",
    "7. \u4e0d\u540c\u6765\u6e90\u8bf4\u6cd5\u4e0d\u4e00\u81f4\u65f6\uff0c\u8981\u6807\u51fa\u5206\u6b67\uff0c\u4e0d\u8981\u66ff\u6765\u6e90\u4e0b\u7ed3\u8bba\u3002",
    "8. \u540c\u4e00\u4efb\u52a1\u591a\u7bc7\u65f6\uff0c\u8bf7\u9009\u62e9\u72ec\u7acb\u89d2\u5ea6\uff0c\u907f\u514d\u548c\u5176\u4ed6\u7bc7\u5b8c\u5168\u91cd\u590d\u3002",
    "9. \u6587\u672b\u5217\u51fa\u300c## \u53c2\u8003\u6765\u6e90\u300d\uff0c\u7528 Markdown \u94fe\u63a5\u5217\u51fa\u7528\u5230\u7684\u6765\u6e90\u3002",
    `10. \u8f93\u51fa Markdown\uff1b\u6b63\u6587\u4e0d\u8981\u77ed\u4e8e ${depthConfig.minWords} \u4e2a\u4e2d\u6587\u5b57\u7b26\u3002`,
    "",
    "\u3010\u6765\u6e90\u8d44\u6599\u3011",
    formatEvidenceText(input.evidence).slice(0, 12000)
  ].join("\n");

  const system = [
    "\u4f60\u662f\u300c\u62fe\u8d1d\u300d\u535a\u5ba2\u5e73\u53f0\u7684\u8d44\u6df1\u4e2d\u6587\u65b0\u95fb\u7f16\u8f91\u3002",
    "\u4f60\u7684\u804c\u8d23\u662f\u628a\u591a\u6765\u6e90\u8d44\u6599\u6574\u5408\u6210\u4e00\u7bc7\u6709\u4e8b\u5b9e\u4f9d\u636e\u3001\u53ef\u5ba1\u6838\u53d1\u5e03\u7684\u65b0\u95fb\u7a3f\u3002",
    "\u4e25\u683c\u7981\u6b62\uff1a\u7f16\u9020\u4e8b\u5b9e\u3001\u5199\u6210\u6458\u8981\u5217\u8868\u3001\u9010\u6761\u590d\u8ff0\u6bcf\u6761\u8d44\u6599\u3002",
    "\u4f60\u5fc5\u987b\u878d\u5408\u591a\u6765\u6e90\u4fe1\u606f\uff0c\u7528\u81ea\u5df1\u7684\u8bed\u8a00\u7f16\u7ec7\u53d9\u8ff0\u3002"
  ].join("\n");

  const generated = await requestChatCompletion(input.modelConfig, prompt, system);
  return expandNewsArticleIfTooShort(input, generated, depthConfig);
}

function getDepthConfig(depth: ResearchDepth) {
  if (depth === "standard") return { label: "标准报道", words: 1200, minWords: 1100 };
  if (depth === "deep") return { label: "深度报道", words: 3200, minWords: 3000 };
  return { label: "长报道", words: 2000, minWords: 1900 };
}

async function expandNewsArticleIfTooShort(
  input: GenerateNewsArticleInput,
  generated: string,
  depthConfig: ReturnType<typeof getDepthConfig>
) {
  const currentChars = countArticleBodyChars(generated);
  if (currentChars >= depthConfig.minWords) return generated;

  const prompt = [
    "下面是一篇已经生成的中文新闻草稿，但它没有达到后台选择的报道长度要求。",
    "",
    "【硬性长度要求】",
    `- 当前正文有效字符数约 ${currentChars}。`,
    `- 必须扩写到不少于 ${depthConfig.minWords} 个中文正文字符，目标约 ${depthConfig.words} 个中文正文字符。`,
    "- 正文字符不包含标题、参考来源列表、Markdown 标记和链接 URL。",
    "",
    "【扩写规则】",
    "1. 保留原有 Markdown 结构和参考来源章节。",
    "2. 只能基于来源资料和原草稿已经出现的事实扩写，不得新增来源资料之外的事实、日期、数字或引用。",
    "3. 优先扩写背景脉络、影响分析、竞争格局、待确认问题和来源分歧。",
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
    "你是严格的中文新闻编辑。你的任务是把短稿扩写到指定字数，同时保持事实边界，不编造任何来源资料之外的信息。"
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
  const formatLabel = isWeekly ? "\u5468\u62a5\u7efc\u8ff0" : "\u6bcf\u65e5\u8981\u95fb";
  const wordTarget = isWeekly ? "2200" : "1500";
  const minWords = isWeekly ? "1700" : "1100";

  const prompt = [
    formatStyleBlock(input.style),
    "",
    "\u3010\u4efb\u52a1\u4fe1\u606f\u3011",
    `\u4e3b\u9898\uff1a${input.topicName}`,
    `\u62a5\u9053\u8303\u56f4\uff1a${input.scopeLabel}`,
    `\u65f6\u95f4\u7a97\u53e3\uff1a${input.windowLabel}`,
    `\u4ea7\u51fa\u5f62\u5f0f\uff1a${formatLabel}`,
    "",
    "\u3010\u5199\u4f5c\u89c4\u8303\u3011",
    `\u8bf7\u57fa\u4e8e\u4e0b\u9762\u591a\u6761\u540c\u4e3b\u9898\u3001\u540c\u65f6\u95f4\u7a97\u53e3\u7684\u6765\u6e90\u8d44\u6599\uff0c\u5199\u4e00\u7bc7\u53ef\u4f5c\u4e3a\u535a\u5ba2\u53d1\u5e03\u7684\u4e2d\u6587 ${formatLabel}\u3002`,
    `1. \u8fd9\u662f ${formatLabel}\uff0c\u4e0d\u662f\u9010\u6761\u65b0\u95fb\u603b\u7ed3\uff0c\u4e5f\u4e0d\u662f\u5355\u4e00\u4e8b\u4ef6\u62a5\u9053\u3002`,
    `2. \u6807\u9898\u5e94\u50cf${isWeekly ? "\u5468\u62a5" : "\u65e5\u62a5"}\u6807\u9898\uff08\u4f8b\u5982\u300c\u672c\u5468\u79d1\u6280\u8981\u95fb\uff1a\u2026\u2026\u300d\u3001\u300c\u4eca\u65e5\u7ecf\u6d4e\u89c2\u5bdf\uff1a\u2026\u2026\u300d\uff09\uff0c\u7981\u6b62\u7528\u300c\u6458\u8981\u300d\u300c\u8d44\u6599\u6574\u7406\u300d\u3002`,
    "3. \u5f00\u5934\u5199\u4e00\u6bb5\u5f15\u8a00\uff0c\u6982\u62ec\u672c\u671f\u8986\u76d6\u7684\u4e3b\u8981\u4e8b\u4ef6\u548c\u5171\u540c\u8d8b\u52bf\u3002",
    "4. \u6b63\u6587\u6309\u4e3b\u9898/\u4e8b\u4ef6\u5206\u5757\u7ec4\u7ec7\uff0c\u6bcf\u4e2a\u4e8b\u4ef6\u7528 ## \u4e8c\u7ea7\u6807\u9898\uff0c\u4e0b\u9762 1-2 \u6bb5\u53d9\u8ff0\uff08\u5fc5\u987b\u662f\u8fde\u7eed\u6bb5\u843d\uff0c\u4e0d\u8981 bullet\uff09\u3002",
    "5. \u4e8b\u4ef6\u4e4b\u95f4\u53ef\u4ee5\u505a\u5bf9\u6bd4\u3001\u4e32\u8054\u6216\u8d8b\u52bf\u5206\u6790\uff1b\u53ea\u80fd\u57fa\u4e8e\u8d44\u6599\u4e2d\u7684\u4fe1\u606f\uff0c\u4e0d\u5f97\u51ed\u7a7a\u53d1\u6325\u3002",
    "6. \u8d44\u6599\u4e0d\u8db3\u4ee5\u786e\u8ba4\u65f6\uff0c\u660e\u786e\u5199\u51fa\u300c\u8d44\u6599\u4e2d\u672a\u63d0\u53ca\u300d\u3002",
    "7. \u6587\u672b\u5217\u51fa\u300c## \u53c2\u8003\u6765\u6e90\u300d\uff0c\u7528 Markdown \u94fe\u63a5\u5217\u51fa\u672c\u671f\u7528\u5230\u7684\u6765\u6e90\u3002",
    `8. \u8f93\u51fa Markdown\uff1b\u6b63\u6587\u4e0d\u5c11\u4e8e ${minWords} \u4e2a\u4e2d\u6587\u5b57\u7b26\uff0c\u76ee\u6807\u7ea6 ${wordTarget} \u4e2a\u3002`,
    "",
    "\u3010\u6765\u6e90\u8d44\u6599\u3011",
    formatEvidenceText(input.evidence, 800).slice(0, 14000)
  ].join("\n");

  const system = [
    `\u4f60\u662f\u300c\u62fe\u8d1d\u300d\u535a\u5ba2\u5e73\u53f0\u7684\u8d44\u6df1\u4e2d\u6587\u65b0\u95fb\u7f16\u8f91\uff0c\u8d1f\u8d23\u628a\u540c\u4e00\u4e3b\u9898\u3001\u540c\u4e00\u65f6\u95f4\u7a97\u53e3\u7684\u591a\u6761\u6765\u6e90\u6574\u5408\u6210\u4e00\u4efd${formatLabel}\u3002`,
    "\u8981\u6c42\u4e8b\u5b9e\u6709\u4f9d\u636e\u3001\u53ef\u5ba1\u6838\u53d1\u5e03\u3002\u4e0d\u8981\u5199\u6210 bullet \u6458\u8981\uff0c\u4e0d\u8981\u9010\u6761\u590d\u8ff0\u8d44\u6599\u3002"
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
    "Translate the following Chinese blog/news post into natural, publication-quality English.",
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
    "You are a professional bilingual news translator (Chinese \u2192 English). Produce natural, publication-ready English while preserving meaning, names, numbers, citations, and Markdown structure. Output strict JSON only."
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
    "- 解释当前页面的新闻内容、背景和影响",
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
