import type { CreationDepth, CreationMode } from "@prisma/client";
import { parseJsonObject, requestChatCompletion } from "./ai";
import { isExaConfigured, searchWithExa, type ExaResult } from "./exa";
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
    "5. 先理解，再提问：如果上一个回答里有指代不清的地方（「他/它/这个」到底指谁、哪家产品、哪件事），且会影响成文的事实准确性，下一个问题优先把指代问清楚，绝不自行假设。",
    "6. " + modeInterviewFocus[input.mode],
    "7. 用受访者回答所使用的语言提问；受访者还没回答时用中文。",
    "8. 问题要短，一两句话。"
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
 * 第一步：逐条解读访谈回答——先弄清「每句话到底在说什么」，再谈成文。
 * 重点是指代消解与偏好隔离：引语属于说话人，偏好属于受访者，二者不得互相污染。
 */
async function extractInterviewInsights(input: {
  topic: string;
  interview: InterviewEntry[];
}): Promise<{
  readings: Array<{ index: number; gist: string; referents: string[]; ambiguity: string | null }>;
  keyPoints: string[];
  emotionalTone: string;
  factualClaims: string[];
  preferences: string[];
  narrativeFlow: string;
  searchQueries: string[];
}> {
  const prompt = [
    `【主题】${input.topic}`,
    "",
    "【访谈记录】",
    formatInterviewLines(input.interview),
    "",
    "【任务】先逐条解读每个回答的真实含义，再提取全局信息：",
    "1. readings: 按回答顺序逐条输出：",
    "   - index: 第几个回答（从 1 开始）",
    "   - gist: 这条回答实际在说什么（忠实转述，不引申、不脑补）",
    "   - referents: 指代还原——回答里的引语、评价、代词分别指向谁/什么。只依据回答文本与其上下文判断，禁止用受访者的偏好来推断。",
    "   - ambiguity: 如果指代或含义无法从文本确定，写出歧义点；能确定则为 null。",
    "2. keyPoints: 核心观点（3-5 个短句）",
    "3. emotionalTone: 整体情感基调（如「惊叹与反思并存」「焦虑中带着兴奋」）",
    "4. factualClaims: 所有具体的事实性陈述（时间、数字、工具名称、谁说了什么等），每条注明出自第几答",
    "5. preferences: 受访者本人的偏好与立场（如更喜欢某个产品、支持某种观点）。这些只影响成文语气与取材，不是客观事实。",
    "6. narrativeFlow: 叙事逻辑（如「从个人体验→行业观察→未来预测」）",
    "7. searchQueries: 回答里涉及「公开可查证的事实」（公众人物的引语或表态、公司/产品的事件与时间线、公开报道过的事）时，给出 0-3 条用于网络核实的搜索查询，按重要性排序；查询要具体（含人名/公司/事件关键词），用最可能命中报道的语言书写。纯个人经历没有可查证点时输出空数组。",
    "",
    "【指代消解纪律——最重要】",
    "引语的对象以原话为准。例：受访者转述「某 CEO 说自己看到自家新模型时像看到原子弹爆炸、瘫倒在地」，这句话赞叹的是该 CEO 自家的模型；即使受访者在别的回答里说自己更喜欢另一家的产品，也绝不能把这句引语的对象改成受访者喜欢的产品。偏好属于受访者，引语属于说话人。这类涉及公开人物的引语正是 searchQueries 应该覆盖的核实点。",
    "",
    "【输出格式】",
    '严格 JSON：{"readings": [{"index": 1, "gist": "...", "referents": ["..."], "ambiguity": null}], "keyPoints": ["..."], "emotionalTone": "...", "factualClaims": ["..."], "preferences": ["..."], "narrativeFlow": "...", "searchQueries": ["..."]}',
    "不要代码围栏，不要 JSON 之外的文字。"
  ].join("\n");

  const system =
    "你是访谈分析专家，擅长忠实理解对话原意，特别注意指代关系（谁说的、说的是什么对象）。禁止过度解读，禁止用受访者的偏好改写事实归因。输出严格 JSON。";
  const raw = await creationChatCompletion(prompt, system);
  const parsed = parseJsonObject(raw) as {
    readings?: unknown;
    keyPoints?: unknown;
    emotionalTone?: unknown;
    factualClaims?: unknown;
    preferences?: unknown;
    narrativeFlow?: unknown;
    searchQueries?: unknown;
  };

  const readings = Array.isArray(parsed.readings)
    ? parsed.readings.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const r = item as Record<string, unknown>;
        const gist = typeof r.gist === "string" ? r.gist.trim() : "";
        if (!gist) return [];
        return [{
          index: typeof r.index === "number" && Number.isFinite(r.index) ? Math.round(r.index) : 0,
          gist,
          referents: strArray(r.referents),
          ambiguity: typeof r.ambiguity === "string" && r.ambiguity.trim() ? r.ambiguity.trim() : null
        }];
      })
    : [];

  return {
    readings,
    keyPoints: strArray(parsed.keyPoints),
    emotionalTone: typeof parsed.emotionalTone === "string" ? parsed.emotionalTone : "中性",
    factualClaims: strArray(parsed.factualClaims),
    preferences: strArray(parsed.preferences),
    narrativeFlow: typeof parsed.narrativeFlow === "string" ? parsed.narrativeFlow : "",
    searchQueries: strArray(parsed.searchQueries).slice(0, 3)
  };
}

/**
 * 公开资料核验：把解读阶段标记的可查证事实点交给 Exa 搜索。
 * 搜索结果供成稿与审校核对「谁说的、说的是什么对象」，不作为新的素材来源。
 *
 * 三种基础设施状态严格区分，绝不混作「用户的事实有问题」：
 * - Exa 未启用 → 返回 null，调用方跳过核验（草稿附注说明未核验）；
 * - Exa 启用但搜索全部失败 → 抛错，成稿接口返回「稍后重试」；
 * - Exa 启用且搜索成功 → 返回结果。为空说明真的查无资料，
 *   调用方阻断成稿并要求用户补充来源或解释。
 */
async function gatherPublicEvidence(queries: string[]): Promise<ExaResult[] | null> {
  const trimmed = queries.map((q) => q.trim()).filter(Boolean).slice(0, 2);
  if (!trimmed.length) return [];
  if (!(await isExaConfigured())) return null;
  const settled = await Promise.allSettled(
    trimmed.map((query) => searchWithExa(query, { numResults: 3 }))
  );
  return mergePublicEvidenceSearches(settled);
}

/**
 * 合并多路搜索结果（按 URL 去重，最多 5 条）。
 * 全部失败视为基础设施故障，抛错而不是当成「查无资料」——
 * 否则一次 Exa 故障会被翻译成「请用户补充来源」，把锅甩给创作者。
 */
export function mergePublicEvidenceSearches(
  settled: PromiseSettledResult<ExaResult[]>[]
): ExaResult[] {
  const failures = settled.filter(
    (item): item is PromiseRejectedResult => item.status === "rejected"
  );
  if (settled.length && failures.length === settled.length) {
    const reason = failures[0].reason;
    throw new Error(
      `公开资料搜索失败：${reason instanceof Error ? reason.message : String(reason)}`
    );
  }
  if (failures.length) {
    console.warn("[creation-compose] 部分公开资料搜索失败，用剩余结果核验:", failures[0].reason);
  }
  const merged: ExaResult[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
      if (merged.length >= 5) return merged;
    }
  }
  return merged;
}

function formatPublicEvidence(evidence: ExaResult[]): string {
  return evidence
    .map((item, index) => {
      const lines = [
        `--- 公开资料 ${index + 1} ---`,
        `来源：${item.sourceName}`,
        `标题：${item.title}`,
        `链接：${item.url}`
      ];
      if (item.publishedDate) lines.push(`发布时间：${item.publishedDate.toISOString().slice(0, 10)}`);
      lines.push(`摘录：${item.text.slice(0, 600)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

export type PublicVerificationIssue = {
  claim: string;
  finding: string;
  evidence: string;
  requiredAction: string;
};

export function buildPublicEvidenceUnavailableIssues(input: {
  claims: string[];
  searchQueries: string[];
}): PublicVerificationIssue[] {
  const claims = input.claims.map((claim) => claim.trim()).filter(Boolean);
  const queries = input.searchQueries.map((query) => query.trim()).filter(Boolean);
  if (!queries.length) return [];

  const targets = claims.length ? claims : queries.map((query) => `需要核验的公开信息：${query}`);
  return targets.slice(0, 8).map((claim) => ({
    claim,
    finding: "系统已经识别到这属于公开可查事实，但本轮联网搜索没有取得可用于核验的资料。",
    evidence: queries.join("；"),
    requiredAction: "请补充可靠来源链接、准确名称/时间，或改写为个人观点/待确认信息后重新成稿。"
  }));
}

export function buildPublicEvidenceReviewFailedIssues(input: {
  claims: string[];
  evidence: ExaResult[];
}): PublicVerificationIssue[] {
  const claims = input.claims.map((claim) => claim.trim()).filter(Boolean);
  const sourceNames = [...new Set(input.evidence.map((item) => item.sourceName).filter(Boolean))];
  const targets = claims.length ? claims : ["本轮涉及公开事实的表述"];
  return targets.slice(0, 8).map((claim) => ({
    claim,
    finding: "系统已完成联网搜索，但自动核验步骤没有可靠完成，因此不能把该表述直接写入草稿。",
    evidence: sourceNames.length ? `已检索来源：${sourceNames.join("、")}` : "已检索到资料，但未能完成自动核验。",
    requiredAction: "请补充更明确的来源或改写为待确认信息后重新成稿。"
  }));
}

export class PublicVerificationRequiredError extends Error {
  issues: PublicVerificationIssue[];

  constructor(issues: PublicVerificationIssue[]) {
    super("public verification requires user clarification");
    this.name = "PublicVerificationRequiredError";
    this.issues = issues;
  }
}

async function verifyPublicClaimsAgainstEvidence(input: {
  claims: string[];
  evidence: ExaResult[];
}): Promise<PublicVerificationIssue[]> {
  const claims = input.claims.map((claim) => claim.trim()).filter(Boolean).slice(0, 12);
  if (!claims.length || !input.evidence.length) return [];

  const prompt = [
    "【待核验事实性陈述】",
    claims.map((claim, index) => `${index + 1}. ${claim}`).join("\n"),
    "",
    "【联网搜索资料】",
    formatPublicEvidence(input.evidence),
    "",
    "【任务】",
    "请在读完全部待核验陈述与全部搜索资料后，整合输出需要创作者整改或解释的问题。只列三类问题：",
    "1. 搜索资料明确反驳或明显不支持的公开事实。",
    "2. 引语、归因、对象可能错位的公开事实。",
    "3. 搜索资料不足以确认、但如果写成客观事实会误导读者的关键陈述。",
    "",
    "【判断纪律】",
    "- 个人经历、个人感受、个人观点不要核验为真假。",
    "- 不要因为搜索资料没有覆盖所有细节就机械报错；只列会影响事实准确性的关键点。",
    "- 不要改写成稿；只告诉创作者需要补充来源、修正、或解释。",
    "- 必须先综合所有资料，再输出一个合并后的问题清单。",
    "",
    "【输出格式】",
    '严格 JSON：{"issues":[{"claim":"原陈述","finding":"核验发现","evidence":"依据哪几条资料","requiredAction":"请用户如何整改或解释"}]}',
    "不要代码围栏，不要 JSON 之外的文字。"
  ].join("\n");

  const raw = await creationChatCompletion(
    prompt,
    "你是事实核验编辑。你只根据给定搜索资料判断公开可查事实是否需要创作者整改或解释。输出严格 JSON。"
  );
  const parsed = parseJsonObject(raw) as { issues?: unknown };
  if (!Array.isArray(parsed.issues)) return [];
  return parsed.issues.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const claim = typeof row.claim === "string" ? row.claim.trim() : "";
    const finding = typeof row.finding === "string" ? row.finding.trim() : "";
    if (!claim || !finding) return [];
    return [{
      claim,
      finding,
      evidence: typeof row.evidence === "string" ? row.evidence.trim() : "",
      requiredAction: typeof row.requiredAction === "string" ? row.requiredAction.trim() : "请修正表述或补充可靠来源。"
    }];
  }).slice(0, 8);
}

/**
 * 公开事实核验闸门。gather/verify 可注入以便单测覆盖每条分支；
 * 生产路径用默认实现（Exa 搜索 + AI 核验）。
 *
 * 返回值：evidence 供成稿/审校 prompt 引用；notes 附在草稿提示里。
 * 抛 PublicVerificationRequiredError = 需要创作者整改或解释（阻断成稿）；
 * 抛其他错误 = 基础设施故障，成稿接口按「稍后重试」处理。
 */
export async function runPublicVerificationGate(input: {
  searchQueries: string[];
  factualClaims: string[];
  gather?: (queries: string[]) => Promise<ExaResult[] | null>;
  verify?: (input: { claims: string[]; evidence: ExaResult[] }) => Promise<PublicVerificationIssue[]>;
}): Promise<{ evidence: ExaResult[]; notes: string[] }> {
  const gather = input.gather ?? gatherPublicEvidence;
  const verify = input.verify ?? verifyPublicClaimsAgainstEvidence;
  const queries = input.searchQueries.map((query) => query.trim()).filter(Boolean);

  const gathered = await gather(queries);
  if (gathered === null) {
    // Exa 未启用：保持「不阻塞成稿」的既有行为，但明确告知创作者本稿未经联网核验。
    return {
      evidence: [],
      notes: ["本稿包含可公开核验的表述，但站点未启用联网搜索，本次未做公开资料核验，请发布前自行确认相关事实。"]
    };
  }

  let verificationIssues: PublicVerificationIssue[] = [];
  if (queries.length && gathered.length === 0) {
    verificationIssues = buildPublicEvidenceUnavailableIssues({
      claims: input.factualClaims,
      searchQueries: queries
    });
  }
  if (gathered.length) {
    try {
      verificationIssues = await verify({ claims: input.factualClaims, evidence: gathered });
    } catch (error) {
      console.warn("[creation-compose] 公开事实核验失败，要求用户补充确认:", error);
      verificationIssues = buildPublicEvidenceReviewFailedIssues({
        claims: input.factualClaims,
        evidence: gathered
      });
    }
  }
  if (verificationIssues.length) {
    throw new PublicVerificationRequiredError(verificationIssues);
  }
  return { evidence: gathered, notes: [] };
}

function formatVerificationIssues(issues: PublicVerificationIssue[]) {
  return issues
    .map((issue, index) => [
      `${index + 1}. 陈述：${issue.claim}`,
      `   - 核验发现：${issue.finding}`,
      issue.evidence ? `   - 依据：${issue.evidence}` : null,
      `   - 需要创作者处理：${issue.requiredAction}`
    ].filter(Boolean).join("\n"))
    .join("\n");
}

export function formatVerificationClarificationQuestion(issues: PublicVerificationIssue[]) {
  return [
    "联网核验发现下面这些公开事实需要你整改或解释。请逐条回复：哪些地方要改正，哪些是你的个人表述，哪些有可靠来源可以补充。",
    "",
    formatVerificationIssues(issues),
    "",
    "请尽量补充来源链接、准确时间、人物/机构名称，或明确说明这只是你的个人经历/观点。你回复后，我会重新联网搜索并再次核验。"
  ].join("\n");
}

export function isVerificationClarificationQuestion(question: string | null | undefined) {
  return Boolean(question?.startsWith("联网核验发现下面这些公开事实需要你整改或解释。"));
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

/**
 * 第三步：AI 审校——逐句核对草稿与访谈记录的事实一致性。
 * 专查三类硬伤：归因错位（把 A 对 X 的评价写成对 Y）、凭空事实、把受访者偏好写成客观事实。
 * 有问题时返回最小修改的修订稿；审校本身失败不阻塞成稿（降级为机器预筛提示）。
 */
async function reviewDraftFaithfulness(input: {
  topic: string;
  interview: InterviewEntry[];
  draftTitle: string;
  draftContent: string;
  hints: string[];
  publicEvidence: ExaResult[];
}): Promise<{ violations: string[]; revisedContent: string | null }> {
  const prompt = [
    `【主题】${input.topic}`,
    "",
    "【访谈记录（事实的唯一依据）】",
    formatInterviewLines(input.interview),
    "",
    "【待审草稿】",
    `# ${input.draftTitle}`,
    "",
    input.draftContent.slice(0, 20000),
    "",
    ...(input.publicEvidence.length
      ? [
          "【公开资料（网络搜索所得，辅助核对涉及公开人物/事件的归因与时间线）】",
          formatPublicEvidence(input.publicEvidence),
          ""
        ]
      : []),
    ...(input.hints.length
      ? ["【机器预筛线索（重点核查；正则匹配可能有误报，以你的判断为准）】", ...input.hints.map((hint) => `- ${hint}`), ""]
      : []),
    "【审校任务】逐句核对草稿，只查以下三类硬伤：",
    "1. 归因错位：引语或评价的「说话人→对象」与访谈记录不一致。典型错误：受访者转述某 CEO 赞叹自家模型的话，草稿却写成他在赞叹受访者喜欢的另一家产品。有公开资料时用它双重核对涉及公开人物的引语归因。",
    "2. 凭空事实：草稿中出现访谈记录里没有的数字、时间、产品名、事件、引语。",
    "3. 偏好当事实：把受访者的个人喜好写成客观结论。受访者的说法与公开资料冲突时，草稿可以转述受访者的说法（如「在他看来」），但不能把它写成无争议的客观事实。",
    "语言风格、结构、详略不在审校范围内，一律不改。",
    "",
    "【输出格式】",
    '严格 JSON：{"violations": ["具体指出草稿哪句话有什么问题"], "revisedContent": "仅当 violations 非空时给出修订后的完整 Markdown 正文（最小修改，只改有问题的句子）；无问题时为 null"}',
    "不要代码围栏，不要 JSON 之外的文字。"
  ].join("\n");

  const system = "你是「拾贝」共创工作室的事实审校员。只核对事实与归因，不改风格。输出严格 JSON。";
  const raw = await creationChatCompletion(prompt, system);
  const parsed = parseJsonObject(raw) as { violations?: unknown; revisedContent?: unknown };
  return {
    violations: strArray(parsed.violations).slice(0, 8),
    revisedContent:
      typeof parsed.revisedContent === "string" && parsed.revisedContent.trim() ? parsed.revisedContent.trim() : null
  };
}

/** 根据访谈记录生成可编辑草稿（不直接存档，读者过目修改后才算数）。 */
export async function composeCreativeDraft(input: {
  genreName: string;
  mode: CreationMode;
  depth: CreationDepth;
  topic: string;
  interview: InterviewEntry[];
}): Promise<{ title: string; summary: string; content: string; notes: string[] }> {
  // 第一步：逐条解读回答（指代消解 + 偏好隔离）
  const insights = await extractInterviewInsights({
    topic: input.topic,
    interview: input.interview
  });

  // 第一步半：可查证的公开事实点交给网络搜索核验。
  // Exa 未启用时跳过核验但附注告知；启用后查无资料或核验发现问题会
  // 抛 PublicVerificationRequiredError 阻断成稿（见 runPublicVerificationGate）。
  const verification = await runPublicVerificationGate({
    searchQueries: insights.searchQueries,
    factualClaims: insights.factualClaims
  });
  const publicEvidence = verification.evidence;

  const readingLines = insights.readings.length
    ? insights.readings
        .map((reading) => {
          const parts = [`答 ${reading.index}：${reading.gist}`];
          if (reading.referents.length) parts.push(`指代：${reading.referents.join("；")}`);
          if (reading.ambiguity) parts.push(`歧义待确认：${reading.ambiguity}`);
          return `- ${parts.join(" ｜ ")}`;
        })
        .join("\n")
    : "（解读缺失，请直接以访谈原文为准）";

  // 第二步：基于解读生成草稿
  const prompt = [
    `【题材】${input.genreName}`,
    `【主题】${input.topic}`,
    "",
    "【访谈记录（唯一素材来源）】",
    formatInterviewLines(input.interview),
    "",
    "【逐条答案解读（指代已核对，理解回答时以此为准）】",
    readingLines,
    "",
    "【受访者偏好（只影响语气与取材；不是客观事实，禁止改变任何引语或评价的归因）】",
    insights.preferences.length ? insights.preferences.map((pref) => `- ${pref}`).join("\n") : "（无）",
    "",
    ...(publicEvidence.length
      ? [
          "【公开资料核对（网络搜索所得；用于核实归因与公开事实，不是受访者的素材）】",
          formatPublicEvidence(publicEvidence),
          "公开资料使用纪律：",
          "- 只用于核对「谁说的、说的是什么对象、发生在什么时候」这类公开可查的事实；公开资料证实的归因按正确归因写。",
          "- 受访者的说法与公开资料冲突时：保留受访者原话并用「受访者提到/在他看来」转述，不把有争议的说法写成客观事实，也不改写受访者的话。",
          "- 「受访者的话为主」模式下不得据公开资料添加访谈之外的新事实；「AI 整合为主」模式可少量补充公开背景，但必须注明来源（据 XX 报道）。",
          ""
        ]
      : []),
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
    "3. 事实核查：受访者素材只使用「必须保留的事实」中列出的具体信息（时间、数字、工具名），绝不添加访谈中没有的数据；补充公开背景必须以【公开资料核对】为据并注明来源。",
    "4. 归因纪律：引语和评价的「说话人→对象」关系必须与答案解读一致，有公开资料时以公开资料双重核对。代词指代不明时保留原有的模糊表述，绝不用受访者的偏好去猜测归因。",
    "5. 歧义处理：解读中标注「歧义待确认」的内容按原话保守转述，不替受访者下结论。",
    "6. 逻辑连贯：按照「叙事逻辑」组织内容，确保读者能跟上思路。",
    "7. 避免生硬引用：如果要引用原话，要用自然的方式引入（如「我当时想的是……」而不是「答：……」）。",
    "",
    "【输出格式】",
    '只输出严格 JSON：{"title": "标题", "summary": "一两句话摘要", "content": "Markdown 正文"}。',
    "不要用代码围栏包裹 JSON，不要输出 JSON 之外的任何文字。",
    "content 中不要重复标题，用受访者回答所使用的语言写作。"
  ].join("\n");

  const system =
    "你是「拾贝」共创工作室的成稿助手。你的职责是将访谈素材转化为流畅、真实、有情感的文章。你必须严格遵守事实核查与归因纪律——引语属于说话人，偏好属于受访者，二者绝不混淆——同时让文字读起来像人写的，而不是机器拼接的。输出严格 JSON。";

  const raw = await creationChatCompletion(prompt, system);
  const parsed = parseJsonObject(raw) as { title?: unknown; summary?: unknown; content?: unknown };
  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 1000) : "";
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!title || !content) throw new Error("成稿结果不完整，请重试。");

  // 第三步：正则快筛提供线索，AI 审校做最终裁决；审校失败降级为快筛提示，不阻塞成稿。
  const regexCheck = verifyFactualConsistency(content, insights.factualClaims);
  const notes: string[] = [...verification.notes];
  let finalContent = content;
  try {
    const review = await reviewDraftFaithfulness({
      topic: input.topic,
      interview: input.interview,
      draftTitle: title,
      draftContent: content,
      hints: regexCheck.violations,
      publicEvidence
    });
    if (review.violations.length) {
      if (review.revisedContent) {
        finalContent = review.revisedContent;
        notes.push(...review.violations.map((violation) => `已修正：${violation}`));
      } else {
        notes.push(...review.violations.map((violation) => `请核实：${violation}`));
      }
    }
  } catch (error) {
    console.warn("[creation-compose] 审校调用失败，降级为机器预筛提示:", error);
    notes.push(...regexCheck.violations.map((violation) => `请核实：${violation}`));
  }

  // 解读阶段发现的歧义也带给创作者确认（成文已按保守方式处理）
  for (const reading of insights.readings) {
    if (reading.ambiguity) {
      notes.push(`第 ${reading.index} 答存在歧义：${reading.ambiguity}（草稿按原话保守处理，请确认表述是否符合本意）`);
    }
  }

  // 告知创作者本次成稿参考了哪些公开资料做归因核验
  if (publicEvidence.length) {
    const sources = [...new Set(publicEvidence.map((item) => item.sourceName))].slice(0, 5).join("、");
    notes.push(`涉及公开人物/事件的表述已用网络搜索核对（参考来源：${sources}）。`);
  }

  return { title, summary, content: finalContent, notes: notes.slice(0, 10) };
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
