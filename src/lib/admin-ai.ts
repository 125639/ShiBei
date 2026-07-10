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
};

export type AdminAiPlan = {
  summary: string;
  tasks: AdminAiPlannedTask[];
  warnings: string[];
};

export type AdminAiTopicOption = {
  id: string;
  name: string;
  keywords: string;
};

type AdminAiPlanDefaults = {
  defaultScope: ResearchScope;
  defaultDepth: ResearchDepth;
  defaultArticleCount: number;
  /** 允许绑定的主题 id 集合;不在集合内的 topicId 一律置 null。 */
  validTopicIds?: Set<string>;
};

// 一次计划最多任务数/总篇数。总篇数是硬预算:每篇都要走一遍
// 联网搜集 + 模型长文生成,失控的计划会烧掉大量配额并淹没草稿箱。
export const MAX_PLAN_TASKS = 12;
export const MAX_PLAN_TOTAL_ARTICLES = 20;

export async function generateAdminAiPlan(input: {
  modelConfig: ChatModelConfig;
  request: string;
  defaultScope: ResearchScope;
  defaultDepth: ResearchDepth;
  defaultArticleCount: number;
  topics?: AdminAiTopicOption[];
}): Promise<AdminAiPlan> {
  const topics = (input.topics || []).slice(0, 40);
  const topicLines = topics.length
    ? topics.map((topic) => `- id=${topic.id} 名称=${topic.name} 关键词=${topic.keywords.slice(0, 80)}`)
    : ["（站点暂无主题分类，全部任务 topicId 填 null）"];

  const prompt = [
    "【管理员需求】",
    input.request.slice(0, 6000),
    "",
    "【默认执行参数】",
    `- 默认搜索范围：${input.defaultScope}`,
    `- 默认文章长度：${input.defaultDepth}`,
    `- 默认每个选题生成篇数：${input.defaultArticleCount}`,
    "",
    "【站点已有主题分类】",
    ...topicLines,
    "",
    "【任务】",
    "把管理员的自然语言需求拆成一组可执行的博客内容生产任务。每个任务会进入系统已有的关键词研究队列，由联网搜索资料、生成草稿、管理员审核发布。",
    "",
    "【拆解规则】",
    "1. 只规划和内容生产有关的任务，不执行系统设置、删除、发布、登录、同步等危险操作。",
    "2. 篇数必须忠实：管理员给了明确数字（如「4 篇財经」「其中 1 篇与日本有关」）时，任务的 articleCount 总和必须与要求精确一致；「几篇」「一些」等模糊数量由你决定具体拆分（总和仍要符合上下文，比如「8 篇中几篇讲 A、几篇讲 B」意味着两部分之和恰好是 8），并在 summary 里说明你定的数字。",
    "3. 优先一篇一个任务：每篇文章给一个独立任务（articleCount=1）、各自有不同的具体角度，避免同一 keyword 生成多篇雷同稿；只有管理员明确要同一选题出多篇时才用 articleCount>1。",
    "4. 每个任务的 keyword 必须像真实搜索查询一样具体，包含主题、对象或角度。例如「欧洲央行 2026 降息 影响」优于「欧洲财经」。",
    "5. topicId：从上面的主题分类里给每个任务选最贴切的一个；没有贴切的就填 null（系统会自动归类）。不要编造列表之外的 id。",
    `6. articleCount 每个任务 1-5；任务总数最多 ${MAX_PLAN_TASKS} 个；全部任务的 articleCount 总和不超过 ${MAX_PLAN_TOTAL_ARTICLES}。`,
    "7. scope 只能是 all/domestic/international；depth 只能是 standard/long/deep。与地域相关的选题把 scope 选对（如日本、欧洲相关用 international）。",
    "8. 对高时效或事实敏感选题，在 reason 里说明需要交叉验证；不要把未验证事实写进任务本身。",
    "9. 如果需求含糊，仍给出保守可执行方案，并把需要管理员确认的点放进 warnings。",
    "",
    "【拆解示例】",
    "需求「生成 4 篇财经博客，其中 1 篇与日本有关，其他与欧洲相关」应拆成 4 个 articleCount=1 的任务：1 个日本财经角度 + 3 个互不重复的欧洲财经角度（如欧洲央行政策、欧元区通胀、欧洲能源市场）。",
    "",
    "【输出格式】",
    '严格 JSON：{"summary":"本次计划一句话概括（含你对模糊数量的决定）","tasks":[{"keyword":"...","reason":"...","scope":"all","depth":"long","articleCount":1,"topicId":null}],"warnings":["..."]}',
    "不要代码围栏，不要 JSON 之外的文字。"
  ].join("\n");

  const raw = await requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是拾贝博客后台的 AI 管理员，只负责把管理员需求拆成安全、可审核、可执行的内容生产计划。输出严格 JSON。"
  );
  const parsed = parseJsonObject(raw) as { summary?: unknown; tasks?: unknown; warnings?: unknown };
  return normalizeAdminAiPlan(parsed, {
    defaultScope: input.defaultScope,
    defaultDepth: input.defaultDepth,
    defaultArticleCount: input.defaultArticleCount,
    validTopicIds: new Set(topics.map((topic) => topic.id))
  });
}

export function normalizeAdminAiPlan(
  parsed: { summary?: unknown; tasks?: unknown; warnings?: unknown },
  defaults: AdminAiPlanDefaults
): AdminAiPlan {
  const normalizedTasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const rawTask = item as Record<string, unknown>;
        const keyword = typeof rawTask.keyword === "string" ? rawTask.keyword.trim() : "";
        if (keyword.length < 2) return [];
        const rawScope = typeof rawTask.scope === "string" ? rawTask.scope : defaults.defaultScope;
        const rawDepth = typeof rawTask.depth === "string" ? rawTask.depth : defaults.defaultDepth;
        const count = typeof rawTask.articleCount === "number" ? rawTask.articleCount : defaults.defaultArticleCount;
        const rawTopicId = typeof rawTask.topicId === "string" ? rawTask.topicId.trim() : "";
        return [{
          keyword: keyword.slice(0, 180),
          reason: typeof rawTask.reason === "string" ? rawTask.reason.trim().slice(0, 500) : "",
          scope: isResearchScope(rawScope) ? rawScope : defaults.defaultScope,
          depth: isResearchDepth(rawDepth) ? rawDepth : defaults.defaultDepth,
          articleCount: clampArticleCount(count),
          topicId: rawTopicId && defaults.validTopicIds?.has(rawTopicId) ? rawTopicId : null
        }];
      })
    : [];
  const deduped = dedupeTasks(normalizedTasks).slice(0, MAX_PLAN_TASKS);
  const { tasks, trimmed } = enforceArticleBudget(deduped);

  const warnings = stringArray(parsed.warnings);
  if (trimmed) {
    warnings.push(`计划超出单次 ${MAX_PLAN_TOTAL_ARTICLES} 篇的总量上限，已截去超出部分，请分批执行。`);
  }

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 500)
      : "已生成内容生产计划。",
    tasks,
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

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
    : [];
}

function clampArticleCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), 5);
}

function dedupeTasks(tasks: AdminAiPlannedTask[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = task.keyword.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
