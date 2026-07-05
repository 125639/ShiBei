import type { CreationDepth, CreationMode } from "@prisma/client";
import { parseJsonObject, requestChatCompletion } from "./ai";
import { getModelConfigForUse } from "./model-selection";
import { isFrontend } from "./app-mode";
import { backendFetchInitForConfig, getResolvedSyncConfig } from "./sync/config";
import {
  CREATION_DEPTHS,
  type CreationDimension,
  type InterviewEntry,
  computeWeightedScore
} from "./creation";

// ============ 共创工作室：访谈提问、成稿、评分 ============

const INTERVIEW_DONE_MARK = "【访谈完成】";

/**
 * 共创的统一 AI 出口。
 * full/backend：直接用「用户写作」模型；frontend：无本地模型，
 * 经 SYNC_TOKEN 调 backend 的 /api/public/creation/ai 桥接端点。
 */
async function creationChatCompletion(prompt: string, system: string): Promise<string> {
  if (isFrontend()) {
    const cfg = await getResolvedSyncConfig();
    if (!cfg.backendUrl) {
      throw new Error("frontend 模式但未配置 backend 地址，无法调用共创 AI。");
    }
    const init = backendFetchInitForConfig(cfg, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, system })
    });
    const response = await fetch(`${cfg.backendUrl}/api/public/creation/ai`, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`共创 AI 代理失败: ${response.status} ${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as { output?: string };
    if (!data.output) throw new Error("共创 AI 代理返回空内容");
    return data.output;
  }

  const modelConfig = await getModelConfigForUse("writing");
  if (!modelConfig) {
    throw new Error("管理员尚未配置写作模型，请先在 /admin/settings 添加模型。");
  }
  return requestChatCompletion(modelConfig, prompt, system);
}

function formatDimensionLines(dimensions: CreationDimension[]) {
  return dimensions
    .map((dim) => `- ${dim.label}（权重 ${Math.round(dim.weight * 100)}%）：${dim.hint}`)
    .join("\n");
}

function formatInterviewLines(interview: InterviewEntry[]) {
  if (interview.length === 0) return "（还没有问答）";
  return interview
    .map((entry, index) => `问 ${index + 1}：${entry.question}\n答 ${index + 1}：${entry.answer}`)
    .join("\n\n");
}

const modeInterviewFocus: Record<CreationMode, string> = {
  VOICE_FIRST:
    "本次模式是「受访者的话为主」：成文时会尽量原句引用回答。提问要引导受访者说出可以直接放进文章的句子——原话、场景、对话、第一反应。",
  AI_FIRST:
    "本次模式是「AI 整合为主」：回答会作为素材由 AI 组织成文。提问要收集扎实的事实素材——具体做法、数字、时间、例子、依据。"
};

/**
 * 生成下一个访谈问题。核心纪律：问「具体的句子」而非「抽象的意图」，
 * 这样拿到的回答是可直接复用的原始素材，成文时不必脑补。
 */
export async function generateNextInterviewQuestion(input: {
  genreName: string;
  genreDescription: string;
  dimensions: CreationDimension[];
  mode: CreationMode;
  depth: CreationDepth;
  topic: string;
  interview: InterviewEntry[];
}): Promise<{ done: true } | { done: false; question: string }> {
  const config = CREATION_DEPTHS[input.depth];
  const answered = input.interview.length;
  if (answered >= config.maxQuestions) return { done: true };

  const mayFinish = answered >= config.minQuestions;
  const prompt = [
    `【题材】${input.genreName} —— ${input.genreDescription}`,
    "",
    "【这篇文章将按以下维度评分，提问时有意识地帮受访者补齐这些方面的素材】",
    formatDimensionLines(input.dimensions),
    "",
    `【受访者想写的主题】${input.topic}`,
    "",
    `【访谈进度】已回答 ${answered} 个问题，本次访谈共约 ${config.minQuestions === config.maxQuestions ? config.minQuestions : `${config.minQuestions}-${config.maxQuestions}`} 个问题（${config.label}）。`,
    "",
    "【已有问答】",
    formatInterviewLines(input.interview),
    "",
    "【任务】",
    `请提出第 ${answered + 1} 个问题。`,
    mayFinish
      ? `如果已有回答的素材足以成文，请只输出 ${INTERVIEW_DONE_MARK} 五个字；否则输出下一个问题。`
      : "现在素材还不够，必须继续提问。",
    "只输出问题本身，不要编号、不要客套、不要解释。"
  ].join("\n");

  const system = [
    "你是「拾贝」共创工作室的访谈者，通过提问帮读者把想法变成文章。",
    "",
    "提问纪律：",
    "1. 一次只提一个问题。",
    "2. 问「具体的句子」而不是「抽象的意图」：不问「你想表达什么情绪」，要问「当时你脑子里冒出的第一句话是什么」；不问「这篇教程的重点是什么」，要问「读者最容易卡在哪一步？具体是什么报错或现象」。",
    "3. 回答将来会被直接用于成文，所以要引导受访者给出可以原样放进文章的素材：原话、场景、数字、步骤、例子。",
    "4. 紧扣上一个回答往深处追问，不重复已经问过的内容。",
    "5. " + modeInterviewFocus[input.mode],
    "6. 用受访者回答所使用的语言提问；受访者还没回答时用中文。",
    "7. 问题要短，一两句话。"
  ].join("\n");

  const raw = (await creationChatCompletion(prompt, system)).trim();
  if (mayFinish && raw.includes(INTERVIEW_DONE_MARK)) return { done: true };
  const question = raw.replace(/^[\s\d.、:：\-#*]+/, "").trim();
  if (!question) throw new Error("模型返回了空问题，请重试。");
  return { done: false, question };
}

const modeComposeRules: Record<CreationMode, string> = {
  VOICE_FIRST: [
    "本次模式是「受访者的话为主」——最大化保留创作者的原意：",
    "- 文章主体必须是受访者的原话：尽可能原句保留回答内容，可以调整顺序、拆分段落。",
    "- 你只允许做：编排素材顺序、划分段落、拟小标题、在段落之间补少量必要的连接句。",
    "- 连接句要克制，全文你补写的字数必须明显少于受访者原话的字数。",
    "- 严禁改写受访者的观点和语气，严禁添加受访者没有说过的事实、数字或例子。",
    "- 保留受访者的口语气息，不要把口语「翻译」成书面套话。"
  ].join("\n"),
  AI_FIRST: [
    "本次模式是「AI 整合为主」——受访者的回答是素材，由你组织成文：",
    "- 把素材整合成结构完整、行文流畅的文章，可以自由组织表达、补充过渡。",
    "- 严禁虚构素材中没有的事实、数字、引语；不确定的信息宁可不写。",
    "- 文章的观点必须与受访者的回答一致，不得夹带你自己的立场。"
  ].join("\n")
};

const depthComposeRules: Record<CreationDepth, string> = {
  SHORT: "产出一条 200-500 字的短评：一个凝练的标题 + 两三段正文，不需要小标题。",
  FULL: "产出一篇完整文章：标题 + 导语 + 用小标题分节的正文，正文不少于 800 字（以素材充足为前提，不要注水）。"
};

/**
 * 第一步：从访谈记录中提取结构化信息，建立问答之间的语义关联
 */
async function extractInterviewInsights(input: {
  topic: string;
  interview: InterviewEntry[];
}): Promise<{
  keyPoints: string[];
  emotionalTone: string;
  factualClaims: string[];
  narrativeFlow: string;
}> {
  const prompt = [
    `【主题】${input.topic}`,
    "",
    "【访谈记录】",
    formatInterviewLines(input.interview),
    "",
    "【任务】分析这段访谈，提取以下信息：",
    "1. keyPoints: 核心观点（3-5个短句）",
    "2. emotionalTone: 整体情感基调（如「惊叹与反思并存」「焦虑中带着兴奋」）",
    "3. factualClaims: 所有具体的事实性陈述（时间、数字、工具名称、引用来源等）",
    "4. narrativeFlow: 叙事逻辑（如「从个人体验→行业观察→未来预测」）",
    "",
    "【输出格式】",
    '严格JSON：{"keyPoints": ["...", "..."], "emotionalTone": "...", "factualClaims": ["...", "..."], "narrativeFlow": "..."}',
    "不要代码围栏，不要JSON之外的文字。"
  ].join("\n");

  const system = "你是访谈分析专家，擅长从对话中提取结构化信息。输出严格JSON。";
  const raw = await creationChatCompletion(prompt, system);
  const parsed = parseJsonObject(raw) as {
    keyPoints?: unknown;
    emotionalTone?: unknown;
    factualClaims?: unknown;
    narrativeFlow?: unknown;
  };

  return {
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((s): s is string => typeof s === "string") : [],
    emotionalTone: typeof parsed.emotionalTone === "string" ? parsed.emotionalTone : "中性",
    factualClaims: Array.isArray(parsed.factualClaims) ? parsed.factualClaims.filter((s): s is string => typeof s === "string") : [],
    narrativeFlow: typeof parsed.narrativeFlow === "string" ? parsed.narrativeFlow : ""
  };
}

/**
 * 第二步：验证事实性陈述的一致性（检查AI是否凭空添加了访谈中不存在的事实）
 */
function verifyFactualConsistency(draft: string, originalClaims: string[]): {
  isConsistent: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // 检查草稿中是否出现了访谈记录中不存在的具体数字、时间、工具名
  const draftNumbers = draft.match(/\d+[小时分钟天月年HhMm]|\d+:\d+|\d{4}[-/]\d{1,2}[-/]\d{1,2}/g) || [];
  const claimsText = originalClaims.join(" ");

  for (const num of draftNumbers) {
    if (!claimsText.includes(num)) {
      violations.push(`草稿中出现了访谈记录中不存在的具体数据：${num}`);
    }
  }

  // 检查是否添加了原访谈中没有的工具/产品名称
  const commonTools = ["Claude", "GPT", "OpenAI", "Anthropic", "codex", "opencode"];
  for (const tool of commonTools) {
    const inDraft = draft.includes(tool);
    const inClaims = claimsText.includes(tool);
    if (inDraft && !inClaims) {
      violations.push(`草稿中提到了「${tool}」，但访谈记录中未提及`);
    }
  }

  return {
    isConsistent: violations.length === 0,
    violations
  };
}

/** 根据访谈记录生成可编辑草稿（不直接存档，读者过目修改后才算数）。 */
export async function composeCreativeDraft(input: {
  genreName: string;
  mode: CreationMode;
  depth: CreationDepth;
  topic: string;
  interview: InterviewEntry[];
}): Promise<{ title: string; summary: string; content: string }> {
  // 第一步：提取访谈洞察
  const insights = await extractInterviewInsights({
    topic: input.topic,
    interview: input.interview
  });

  // 第二步：基于洞察生成草稿
  const prompt = [
    `【题材】${input.genreName}`,
    `【主题】${input.topic}`,
    "",
    "【访谈记录（唯一素材来源）】",
    formatInterviewLines(input.interview),
    "",
    "【访谈洞察（帮助你理解上下文，但不要直接搬用）】",
    `- 核心观点：${insights.keyPoints.join("；")}`,
    `- 情感基调：${insights.emotionalTone}`,
    `- 叙事逻辑：${insights.narrativeFlow}`,
    `- 必须保留的事实：${insights.factualClaims.join("；")}`,
    "",
    "【成文要求】",
    modeComposeRules[input.mode],
    "",
    depthComposeRules[input.depth],
    "",
    "【关键纪律】",
    "1. 语句通顺：每个句子都要读起来流畅，段落之间要有自然的过渡。不要生硬地拼接原话。",
    "2. 情感一致：保持统一的情感基调，不要在兴奋和冷静之间突然跳跃。",
    "3. 事实核查：只使用「必须保留的事实」中列出的具体信息（时间、数字、工具名），绝不添加访谈中没有的数据。",
    "4. 逻辑连贯：按照「叙事逻辑」组织内容，确保读者能跟上思路。",
    "5. 避免生硬引用：如果要引用原话，要用自然的方式引入（如「我当时想的是……」而不是「答：……」）。",
    "",
    "【输出格式】",
    '只输出严格 JSON：{"title": "标题", "summary": "一两句话摘要", "content": "Markdown 正文"}。',
    "不要用代码围栏包裹 JSON，不要输出 JSON 之外的任何文字。",
    "content 中不要重复标题，用受访者回答所使用的语言写作。"
  ].join("\n");

  const system =
    "你是「拾贝」共创工作室的成稿助手。你的职责是将访谈素材转化为流畅、真实、有情感的文章。你必须严格遵守事实核查纪律，同时让文字读起来像人写的，而不是机器拼接的。输出严格 JSON。";

  const raw = await creationChatCompletion(prompt, system);
  const parsed = parseJsonObject(raw) as { title?: unknown; summary?: unknown; content?: unknown };
  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 1000) : "";
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!title || !content) throw new Error("成稿结果不完整，请重试。");

  // 第三步：验证事实一致性
  const verification = verifyFactualConsistency(content, insights.factualClaims);
  if (!verification.isConsistent) {
    console.warn("AI生成的草稿包含未经验证的事实陈述：", verification.violations);
    // 注意：这里只是警告，不阻止生成，因为用户可以在编辑时修正
    // 如果需要更严格的控制，可以抛出错误或重新生成
  }

  return { title, summary, content };
}

/**
 * 按题材标尺逐维评分。评分不做冷冰冰的过/不过：每个维度都要给
 * 指向原文的具体反馈，另附可执行的修改建议，读者改完可以重新提交。
 */
export async function scoreCreativeWork(input: {
  genreName: string;
  dimensions: CreationDimension[];
  threshold: number;
  title: string;
  content: string;
}): Promise<{
  dimensionScores: Array<{ key: string; score: number; feedback: string }>;
  total: number;
  overallComment: string;
  suggestions: string[];
}> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = [
    `今天的日期是 ${today}（判断时效性时以此为准）。`,
    "",
    `【题材】${input.genreName}（公开门槛：加权总分 ≥ ${input.threshold}）`,
    "",
    "【评分维度】",
    formatDimensionLines(input.dimensions),
    "",
    "【待评文章】",
    `# ${input.title}`,
    "",
    input.content.slice(0, 30000),
    "",
    "【评分要求】",
    "1. 每个维度打 0-100 分。60 分表示勉强合格，80 分以上表示该维度表现出色。",
    "2. 每个维度的 feedback 必须具体、指向原文：引用或指明有问题的句子/段落，说清缺什么、怎么补（例如「第三段『……』这个论断没有给出依据」「结尾的细节可以再展开」）。禁止「写得不错」「还需努力」这类空话。",
    "3. suggestions 给 2-5 条按优先级排序、可直接执行的修改建议，读者按建议修改后会重新提交评分。",
    "4. 评分要诚实：好就是好，缺就是缺，不要为了鼓励而放水，也不要苛求素材之外的东西。",
    "",
    "【必须检查的质量问题】",
    "- 语句通顺性：是否有生硬拼接、逻辑跳跃、前后矛盾的地方？",
    "- 情感一致性：情感基调是否统一，还是在兴奋和冷静之间突然切换？",
    "- 过渡自然度：段落之间、观点之间是否有自然的过渡，还是生硬地罗列？",
    "- 机械痕迹：是否读起来像是问答记录的直接拼接，而不是一篇完整的文章？",
    "",
    "【输出格式】",
    "只输出严格 JSON，不要代码围栏，不要 JSON 之外的文字：",
    `{"dimensions": [${input.dimensions.map((d) => `{"key": "${d.key}", "score": 0-100, "feedback": "..."}`).join(", ")}], "overallComment": "两三句总评", "suggestions": ["...", "..."]}`
  ].join("\n");

  const system =
    "你是「拾贝」共创工作室的评审。你的职责是给出专业、具体、可执行的评分反馈，帮助创作者把文章改到能公开的水平。特别要注意识别AI生成文章的常见问题：语句生硬、逻辑断裂、情感不连贯。输出严格 JSON。";

  const raw = await creationChatCompletion(prompt, system);
  const parsed = parseJsonObject(raw) as {
    dimensions?: unknown;
    overallComment?: unknown;
    suggestions?: unknown;
  };

  const rawDims = Array.isArray(parsed.dimensions) ? parsed.dimensions : [];
  const byKey = new Map<string, { score: number; feedback: string }>();
  for (const item of rawDims) {
    if (typeof item !== "object" || item === null) continue;
    const dim = item as Record<string, unknown>;
    const key = typeof dim.key === "string" ? dim.key : "";
    const score = typeof dim.score === "number" && Number.isFinite(dim.score) ? dim.score : NaN;
    if (!key || Number.isNaN(score)) continue;
    byKey.set(key, {
      score: Math.min(100, Math.max(0, Math.round(score))),
      feedback: typeof dim.feedback === "string" ? dim.feedback.trim() : ""
    });
  }

  const dimensionScores = input.dimensions.map((dim) => {
    const found = byKey.get(dim.key);
    if (!found) throw new Error(`评分结果缺少维度「${dim.label}」，请重试。`);
    return { key: dim.key, score: found.score, feedback: found.feedback };
  });

  // 加权总分由服务端计算，不信任模型的算术。
  const total = computeWeightedScore(
    input.dimensions,
    Object.fromEntries(dimensionScores.map((d) => [d.key, d.score]))
  );

  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, 8)
    : [];

  return {
    dimensionScores,
    total,
    overallComment: typeof parsed.overallComment === "string" ? parsed.overallComment.trim() : "",
    suggestions
  };
}
