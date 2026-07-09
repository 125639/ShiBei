import { parseJsonObject, requestChatCompletion, type ChatModelConfig } from "./ai";
import { isResearchDepth, isResearchScope, type ResearchDepth, type ResearchScope } from "./research";

export type AdminAiPlannedTask = {
  keyword: string;
  reason: string;
  scope: ResearchScope;
  depth: ResearchDepth;
  articleCount: number;
};

export type AdminAiPlan = {
  summary: string;
  tasks: AdminAiPlannedTask[];
  warnings: string[];
};

type AdminAiPlanDefaults = {
  defaultScope: ResearchScope;
  defaultDepth: ResearchDepth;
  defaultArticleCount: number;
};

export async function generateAdminAiPlan(input: {
  modelConfig: ChatModelConfig;
  request: string;
  defaultScope: ResearchScope;
  defaultDepth: ResearchDepth;
  defaultArticleCount: number;
}): Promise<AdminAiPlan> {
  const prompt = [
    "【管理员需求】",
    input.request.slice(0, 6000),
    "",
    "【默认执行参数】",
    `- 默认搜索范围：${input.defaultScope}`,
    `- 默认文章长度：${input.defaultDepth}`,
    `- 默认每个选题生成篇数：${input.defaultArticleCount}`,
    "",
    "【任务】",
    "把管理员的自然语言需求拆成一组可执行的博客内容生产任务。每个任务会进入系统已有的关键词研究队列，由联网搜索资料、生成草稿、管理员审核发布。",
    "",
    "【拆解规则】",
    "1. 只规划和内容生产有关的任务，不执行系统设置、删除、发布、登录、同步等危险操作。",
    "2. 每个任务的 keyword 必须像真实搜索查询一样具体，包含主题、对象或角度。例如「AI 智能体 2026 企业落地案例」优于「AI」。",
    "3. 如果管理员要覆盖多个领域，拆成多个互补选题；不要生成重复选题。",
    "4. articleCount 每个任务 1-5；任务总数最多 6 个。",
    "5. scope 只能是 all/domestic/international；depth 只能是 standard/long/deep。",
    "6. 对高时效或事实敏感选题，在 reason 里说明需要交叉验证；不要把未验证事实写进任务本身。",
    "7. 如果需求含糊，仍给出保守可执行方案，并把需要管理员确认的点放进 warnings。",
    "",
    "【输出格式】",
    '严格 JSON：{"summary":"本次计划一句话概括","tasks":[{"keyword":"...","reason":"...","scope":"all","depth":"long","articleCount":1}],"warnings":["..."]}',
    "不要代码围栏，不要 JSON 之外的文字。"
  ].join("\n");

  const raw = await requestChatCompletion(
    input.modelConfig,
    prompt,
    "你是拾贝博客后台的 AI 管理员，只负责把管理员需求拆成安全、可审核、可执行的内容生产计划。输出严格 JSON。"
  );
  const parsed = parseJsonObject(raw) as { summary?: unknown; tasks?: unknown; warnings?: unknown };
  return normalizeAdminAiPlan(parsed, input);
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
        return [{
          keyword: keyword.slice(0, 180),
          reason: typeof rawTask.reason === "string" ? rawTask.reason.trim().slice(0, 500) : "",
          scope: isResearchScope(rawScope) ? rawScope : defaults.defaultScope,
          depth: isResearchDepth(rawDepth) ? rawDepth : defaults.defaultDepth,
          articleCount: clampArticleCount(count)
        }];
      })
    : [];
  const tasks = dedupeTasks(normalizedTasks).slice(0, 6);

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 500)
      : "已生成内容生产计划。",
    tasks,
    warnings: stringArray(parsed.warnings).slice(0, 6)
  };
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
