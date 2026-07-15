import { parseJsonObject, requestChatCompletion, type ChatModelConfig } from "./ai";
import { isResearchDepth, isResearchScope, type ResearchDepth, type ResearchScope } from "./research";

export type AdminAiPlannedTask = {
  keyword: string;
  reason: string;
  scope: ResearchScope;
  depth: ResearchDepth;
  articleCount: number;
  /** 绑定的站点主题(ContentTopic.id);null = 交给词库自动归类。 */
  topicId: string | null;
  /** 绑定的生成风格(ContentStyle.id);null = 用执行时选的默认风格。 */
  styleId: string | null;
};

/** 周期性内容动作:执行时创建 ContentTopic + AutoSchedule(cron 由服务端拼装,模型只给白名单字段)。 */
export type AdminAiRecurringPlan = {
  name: string;
  keywords: string;
  reason: string;
  cadence: "daily" | "weekly" | "weekdays";
  /** 1=周一 … 7=周日,仅 cadence=weekly 时有意义。 */
  weekday: number;
  /** 0-23 整点。 */
  hour: number;
  /** 成文模式:独立成文 / 日报汇总 / 周报汇总,对应 ContentTopic.compileKind。 */
  mode: "single" | "daily_digest" | "weekly_roundup";
  scope: ResearchScope;
  depth: ResearchDepth;
  articleCount: number;
  styleId: string | null;
};

export type AdminAiPlan = {
  summary: string;
  tasks: AdminAiPlannedTask[];
  recurring: AdminAiRecurringPlan[];
  warnings: string[];
};

export type AdminAiTopicOption = {
  id: string;
  name: string;
  keywords: string;
};

export type AdminAiStyleOption = {
  id: string;
  name: string;
};

type AdminAiPlanDefaults = {
  defaultScope: ResearchScope;
  defaultDepth: ResearchDepth;
  defaultArticleCount: number;
  /** 允许绑定的主题 id 集合;不在集合内的 topicId 一律置 null。 */
  validTopicIds?: Set<string>;
  /** 允许绑定的风格 id 集合;不在集合内的 styleId 一律置 null。 */
  validStyleIds?: Set<string>;
};

// 一次计划最多任务数/总篇数。总篇数是硬预算:每篇都要走一遍
// 联网搜集 + 模型长文生成,失控的计划会烧掉大量配额并淹没草稿箱。
// 周期动作单独设上限:它是持续消耗,更要保守。
export const MAX_PLAN_TASKS = 12;
export const MAX_PLAN_TOTAL_ARTICLES = 20;
export const MAX_PLAN_RECURRING = 3;

const CADENCES = new Set(["daily", "weekly", "weekdays"]);
const RECURRING_MODES = new Set(["single", "daily_digest", "weekly_roundup"]);

export function compileKindFromRecurringMode(mode: AdminAiRecurringPlan["mode"]): "SINGLE_ARTICLE" | "DAILY_DIGEST" | "WEEKLY_ROUNDUP" {
  if (mode === "daily_digest") return "DAILY_DIGEST";
  if (mode === "weekly_roundup") return "WEEKLY_ROUNDUP";
  return "SINGLE_ARTICLE";
}

/** cadence 白名单 → 标准 5 段 cron。模型永远不直接产出 cron 表达式。 */
export function cronFromCadence(input: { cadence: AdminAiRecurringPlan["cadence"]; weekday: number; hour: number }): string {
  const hour = clampInt(input.hour, 0, 23, 9);
  if (input.cadence === "daily") return `0 ${hour} * * *`;
  if (input.cadence === "weekdays") return `0 ${hour} * * 1-5`;
  const weekday = clampInt(input.weekday, 1, 7, 1);
  return `0 ${hour} * * ${weekday % 7}`; // cron 里 0=周日
}

export function describeCadence(input: { cadence: AdminAiRecurringPlan["cadence"]; weekday: number; hour: number }): { zh: string; en: string } {
  const hour = String(clampInt(input.hour, 0, 23, 9)).padStart(2, "0");
  if (input.cadence === "daily") return { zh: `每天 ${hour}:00`, en: `Daily ${hour}:00` };
  if (input.cadence === "weekdays") return { zh: `工作日 ${hour}:00`, en: `Weekdays ${hour}:00` };
  const zhDays = ["一", "二", "三", "四", "五", "六", "日"];
  const enDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekday = clampInt(input.weekday, 1, 7, 1);
  return { zh: `每周${zhDays[weekday - 1]} ${hour}:00`, en: `${enDays[weekday - 1]} ${hour}:00` };
}

export async function generateAdminAiPlan(input: {
  modelConfig: ChatModelConfig;
  request: string;
  defaultScope: ResearchScope;
  defaultDepth: ResearchDepth;
  defaultArticleCount: number;
  topics?: AdminAiTopicOption[];
  styles?: AdminAiStyleOption[];
  recentTitles?: string[];
  /** 修订模式:带上一版计划与管理员修改意见,输出修订后的完整计划。 */
  revision?: {
    tasks: AdminAiPlannedTask[];
    recurring: AdminAiRecurringPlan[];
    feedback: string;
  };
}): Promise<AdminAiPlan> {
  const today = new Date().toISOString().slice(0, 10);
  const topics = (input.topics || []).slice(0, 40);
  const styles = (input.styles || []).slice(0, 20);
  const recentTitles = (input.recentTitles || []).slice(0, 30);

  const topicLines = topics.length
    ? topics.map((topic) => `- id=${topic.id} 名称=${topic.name} 关键词=${topic.keywords.slice(0, 80)}`)
    : ["（站点暂无主题分类，全部 topicId 填 null）"];
  const styleLines = styles.length
    ? styles.map((style) => `- id=${style.id} 名称=${style.name}`)
    : ["（站点暂无生成风格，全部 styleId 填 null）"];
  const recentLines = recentTitles.length
    ? recentTitles.map((title) => `- ${title.slice(0, 120)}`)
    : ["（暂无近期文章）"];

  const revisionSection = input.revision
    ? [
        "",
        "【当前计划（待修订）】",
        JSON.stringify({ tasks: input.revision.tasks, recurring: input.revision.recurring }),
        "",
        "【管理员修改意见】",
        input.revision.feedback.slice(0, 2000),
        "",
        "【修订要求】",
        "按修改意见调整当前计划并输出修订后的完整计划（不是增量）。没被意见涉及的任务保持原样；意见与原需求冲突时以修改意见为准。"
      ]
    : [];

  const prompt = [
    `【当前日期】${today}`,
    "如果管理员要求「最新」「近期」而没有指定年份，keyword 不得擅自写入旧年份；用具体主题和机构生成检索任务，研究阶段会按当前日期寻找最新资料。",
    "",
    "【管理员需求】",
    input.request.slice(0, 6000),
    ...revisionSection,
    "",
    "【默认执行参数】",
    `- 默认搜索范围：${input.defaultScope}`,
    `- 默认文章长度：${input.defaultDepth}`,
    `- 默认每个选题生成篇数：${input.defaultArticleCount}`,
    "",
    "【站点已有主题分类】",
    ...topicLines,
    "",
    "【站点可用生成风格】",
    ...styleLines,
    "",
    "【站点近期文章（避免选题重复）】",
    ...recentLines,
    "",
    "【任务】",
    "把管理员的自然语言需求拆成可执行的博客内容生产计划：一次性任务进入关键词研究队列（联网搜资料→生成草稿→管理员审核），周期性意图转成自动生产主题（按节奏定时生成）。",
    "",
    "【拆解规则】",
    "1. 只规划和内容生产有关的任务，不执行系统设置、删除、发布、登录、同步等危险操作。",
    "2. 篇数必须忠实：管理员给了明确数字（如「4 篇財经」「其中 1 篇与日本有关」）时，任务的 articleCount 总和必须与要求精确一致；「几篇」「一些」等模糊数量由你决定具体拆分（总和仍要符合上下文，比如「8 篇中几篇讲 A、几篇讲 B」意味着两部分之和恰好是 8），并在 summary 里说明你定的数字。",
    "3. 优先一篇一个任务：每篇文章给一个独立任务（articleCount=1）、各自有不同的具体角度，避免同一 keyword 生成多篇雷同稿；只有管理员明确要同一选题出多篇时才用 articleCount>1。",
    "4. 每个任务的 keyword 必须像真实搜索查询一样具体，包含主题、对象或角度。例如「欧洲央行 利率路径 银行 债券 影响」优于「欧洲财经」。选题不要与【站点近期文章】重复或高度相似。",
    "   keyword 要具体但不要堆砌：通常 4-10 个检索概念足够。不要把多个备选机构、年份和写作要求全部塞进一个查询；这些细节放 reason。",
    "5. topicId：从主题分类里给每个任务选最贴切的一个；没有贴切的就填 null（系统会自动归类）。styleId 同理：管理员表达了风格倾向（如「严肃一点」「轻快一点」）就从风格列表选，否则 null 用默认。都不要编造列表之外的 id。",
    "6. recurring 只用于管理员明确表达的持续/定期意图（「每天」「每周」「以后定期」）；一次性需求一律用 tasks。每个 recurring 给 name（主题名）、keywords（逗号分隔的 2-5 组搜索词）、cadence（daily/weekly/weekdays）、weekday（1=周一…7=周日，仅 weekly 用）、hour（0-23，默认 9）、mode（single=每次独立成文 / daily_digest=日报式汇总 / weekly_roundup=周报式汇总，「周报」「日报」「汇总」类意图选对应 digest 模式）。",
    `7. 上限：tasks 最多 ${MAX_PLAN_TASKS} 个且 articleCount 总和 ≤ ${MAX_PLAN_TOTAL_ARTICLES}；recurring 最多 ${MAX_PLAN_RECURRING} 个。`,
    "8. scope 只能是 all/domestic/international；depth 只能是 standard/long/deep。与地域相关的选题把 scope 选对（如日本、欧洲相关用 international）。",
    "9. 对高时效或事实敏感选题，在 reason 里说明需要交叉验证；不要把未验证事实写进任务本身。",
    "10. 如果需求含糊，仍给出保守可执行方案，并把需要管理员确认的点放进 warnings。",
    "",
    "【拆解示例】",
    "需求「生成 4 篇财经博客，其中 1 篇与日本有关，其他与欧洲相关」应拆成 4 个 articleCount=1 的任务：1 个日本财经角度 + 3 个互不重复的欧洲财经角度（如欧洲央行政策、欧元区通胀、欧洲能源市场）。",
    "需求「以后每周一给我一篇 AI 周报」应产出 1 个 recurring：{name:\"AI 周报\", cadence:\"weekly\", weekday:1, hour:9, mode:\"weekly_roundup\"}。",
    "",
    "【输出格式】",
    '严格 JSON：{"summary":"本次计划一句话概括（含你对模糊数量的决定）","tasks":[{"keyword":"...","reason":"...","scope":"all","depth":"long","articleCount":1,"topicId":null,"styleId":null}],"recurring":[{"name":"...","keywords":"...","reason":"...","cadence":"weekly","weekday":1,"hour":9,"mode":"weekly_roundup","scope":"all","depth":"long","articleCount":1,"styleId":null}],"warnings":["..."]}',
    "没有周期性意图时 recurring 给空数组。不要代码围栏，不要 JSON 之外的文字。"
  ].join("\n");

  const raw = await requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是拾贝博客后台的 AI 管理员，只负责把管理员需求拆成安全、可审核、可执行的内容生产计划。输出严格 JSON。"
  );
  const parsed = parseJsonObject(raw) as { summary?: unknown; tasks?: unknown; recurring?: unknown; warnings?: unknown };
  return normalizeAdminAiPlan(parsed, {
    defaultScope: input.defaultScope,
    defaultDepth: input.defaultDepth,
    defaultArticleCount: input.defaultArticleCount,
    validTopicIds: new Set(topics.map((topic) => topic.id)),
    validStyleIds: new Set(styles.map((style) => style.id))
  });
}

export function normalizeAdminAiPlan(
  parsed: { summary?: unknown; tasks?: unknown; recurring?: unknown; warnings?: unknown },
  defaults: AdminAiPlanDefaults
): AdminAiPlan {
  const warnings = stringArray(parsed.warnings);

  const normalizedTasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const rawTask = item as Record<string, unknown>;
        const keyword = typeof rawTask.keyword === "string" ? rawTask.keyword.trim() : "";
        if (keyword.length < 2) return [];
        const rawScope = typeof rawTask.scope === "string" ? rawTask.scope : defaults.defaultScope;
        const rawDepth = typeof rawTask.depth === "string" ? rawTask.depth : defaults.defaultDepth;
        const count = typeof rawTask.articleCount === "number" ? rawTask.articleCount : defaults.defaultArticleCount;
        return [{
          keyword: keyword.slice(0, 180),
          reason: typeof rawTask.reason === "string" ? rawTask.reason.trim().slice(0, 500) : "",
          scope: isResearchScope(rawScope) ? rawScope : defaults.defaultScope,
          depth: isResearchDepth(rawDepth) ? rawDepth : defaults.defaultDepth,
          articleCount: clampInt(count, 1, 5, 1),
          topicId: allowedId(rawTask.topicId, defaults.validTopicIds),
          styleId: allowedId(rawTask.styleId, defaults.validStyleIds)
        }];
      })
    : [];
  const deduped = dedupeBy(normalizedTasks, (task) => task.keyword.replace(/\s+/g, " ").trim().toLocaleLowerCase())
    .slice(0, MAX_PLAN_TASKS);
  const { tasks, trimmed } = enforceArticleBudget(deduped);
  if (trimmed) {
    warnings.push(`计划超出单次 ${MAX_PLAN_TOTAL_ARTICLES} 篇的总量上限，已截去超出部分，请分批执行。`);
  }

  let droppedCadence = false;
  const normalizedRecurring = Array.isArray(parsed.recurring)
    ? parsed.recurring.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const raw = item as Record<string, unknown>;
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        if (name.length < 2) return [];
        const cadence = typeof raw.cadence === "string" ? raw.cadence : "";
        if (!CADENCES.has(cadence)) {
          droppedCadence = true;
          return [];
        }
        const rawScope = typeof raw.scope === "string" ? raw.scope : defaults.defaultScope;
        const rawDepth = typeof raw.depth === "string" ? raw.depth : defaults.defaultDepth;
        const keywords = typeof raw.keywords === "string" && raw.keywords.trim() ? raw.keywords.trim() : name;
        const mode = typeof raw.mode === "string" && RECURRING_MODES.has(raw.mode) ? raw.mode : "single";
        return [{
          name: name.slice(0, 60),
          keywords: keywords.slice(0, 300),
          reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "",
          cadence: cadence as AdminAiRecurringPlan["cadence"],
          mode: mode as AdminAiRecurringPlan["mode"],
          weekday: clampInt(typeof raw.weekday === "number" ? raw.weekday : 1, 1, 7, 1),
          hour: clampInt(typeof raw.hour === "number" ? raw.hour : 9, 0, 23, 9),
          scope: isResearchScope(rawScope) ? rawScope : defaults.defaultScope,
          depth: isResearchDepth(rawDepth) ? rawDepth : defaults.defaultDepth,
          articleCount: clampInt(typeof raw.articleCount === "number" ? raw.articleCount : 1, 1, 5, 1),
          styleId: allowedId(raw.styleId, defaults.validStyleIds)
        }];
      })
    : [];
  const recurring = dedupeBy(normalizedRecurring, (item) => item.name.toLocaleLowerCase()).slice(0, MAX_PLAN_RECURRING);
  if (droppedCadence) {
    warnings.push("部分周期任务的节奏无法识别（只支持每天/每周/工作日），已丢弃，请在需求里说明具体节奏。");
  }

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 500)
      : "已生成内容生产计划。",
    tasks,
    recurring,
    warnings: warnings.slice(0, 6)
  };
}

export function planArticleTotal(tasks: Array<{ articleCount: number }>): number {
  return tasks.reduce((sum, task) => sum + task.articleCount, 0);
}

/** 按任务顺序累计篇数，超出预算的任务被裁减或丢弃。 */
function enforceArticleBudget(tasks: AdminAiPlannedTask[]): { tasks: AdminAiPlannedTask[]; trimmed: boolean } {
  const kept: AdminAiPlannedTask[] = [];
  let total = 0;
  let trimmed = false;
  for (const task of tasks) {
    const remaining = MAX_PLAN_TOTAL_ARTICLES - total;
    if (remaining <= 0) {
      trimmed = true;
      break;
    }
    if (task.articleCount > remaining) {
      trimmed = true;
      kept.push({ ...task, articleCount: remaining });
      total = MAX_PLAN_TOTAL_ARTICLES;
    } else {
      kept.push(task);
      total += task.articleCount;
    }
  }
  return { tasks: kept, trimmed };
}

function allowedId(value: unknown, valid?: Set<string>): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return id && valid?.has(id) ? id : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
    : [];
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
