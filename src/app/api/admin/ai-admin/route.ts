import { NextResponse } from "next/server";
import type { Queue } from "bullmq";
import { z } from "zod";
import {
  compileKindFromRecurringMode,
  cronFromCadence,
  describeCadence,
  generateAdminAiPlan,
  normalizeAdminAiPlan,
  planArticleTotal,
  MAX_PLAN_RECURRING,
  MAX_PLAN_TASKS,
  type AdminAiPlan
} from "@/lib/admin-ai";
import { requireAdmin } from "@/lib/auth";
import { getModelConfigForUse } from "@/lib/model-selection";
import { prisma } from "@/lib/prisma";
import { getResearchQueue } from "@/lib/queue";
import {
  buildKeywordResearchUrl,
  isResearchDepth,
  isResearchScope,
  parseKeywordResearchUrl,
  type ResearchDepth,
  type ResearchScope
} from "@/lib/research";
import { parseJsonBody } from "@/lib/request-validation";
import { slugify } from "@/lib/slug";
import { syncSchedule } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

// 三段式：action=plan 出计划（无副作用）、action=revise 按管理员意见修订计划
// （同样无副作用）、action=execute 把确认的计划归一化 + 校验后落成批次执行。
// execute 不信任客户端字段——normalizeAdminAiPlan 是执行入口唯一的守门人；
// 周期动作的 cron 由服务端按白名单拼装，模型/客户端永远不直接提供 cron。
const TaskSchema = z.object({
  keyword: z.string().min(2).max(200),
  reason: z.string().max(600).optional().default(""),
  scope: z.enum(["all", "domestic", "international"]),
  depth: z.enum(["standard", "long", "deep"]),
  articleCount: z.coerce.number().int().min(1).max(5),
  topicId: z.string().max(120).nullable().optional().default(null),
  styleId: z.string().max(120).nullable().optional().default(null)
});

const RecurringSchema = z.object({
  name: z.string().min(2).max(80),
  keywords: z.string().max(400).optional().default(""),
  reason: z.string().max(600).optional().default(""),
  cadence: z.enum(["daily", "weekly", "weekdays"]),
  weekday: z.coerce.number().int().min(1).max(7).optional().default(1),
  hour: z.coerce.number().int().min(0).max(23).optional().default(9),
  mode: z.enum(["single", "daily_digest", "weekly_roundup"]).optional().default("single"),
  scope: z.enum(["all", "domestic", "international"]),
  depth: z.enum(["standard", "long", "deep"]),
  articleCount: z.coerce.number().int().min(1).max(5),
  styleId: z.string().max(120).nullable().optional().default(null)
});

const BodySchema = z.object({
  action: z.enum(["plan", "revise", "execute"]).default("plan"),
  request: z.string().max(6000).optional().default(""),
  feedback: z.string().max(2000).optional().default(""),
  scope: z.enum(["all", "domestic", "international"]).default("all"),
  depth: z.enum(["standard", "long", "deep"]).default("long"),
  articleCount: z.coerce.number().int().min(1).max(5).default(1),
  contentStyleId: z.string().max(120).optional().default(""),
  tasks: z.array(TaskSchema).max(MAX_PLAN_TASKS * 2).optional().default([]),
  recurring: z.array(RecurringSchema).max(MAX_PLAN_RECURRING * 2).optional().default([])
});

async function withQueue<T>(queue: Queue, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function loadPlanningContext() {
  const [topics, styles, recentPosts] = await Promise.all([
    prisma.contentTopic.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, keywords: true },
      take: 40
    }),
    prisma.contentStyle.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true, name: true },
      take: 20
    }),
    prisma.post.findMany({
      orderBy: { updatedAt: "desc" },
      select: { title: true },
      take: 30
    })
  ]);
  return { topics, styles, recentTitles: recentPosts.map((post) => post.title) };
}

export async function POST(request: Request) {
  await requireAdmin();

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const modelConfig = await getModelConfigForUse("content");
  if (!modelConfig) {
    return NextResponse.json({ error: "尚未配置内容模型，请先在 设置 → 模型 中添加" }, { status: 503 });
  }

  const context = await loadPlanningContext();
  const defaults = {
    defaultScope: normalizeScope(body.scope),
    defaultDepth: normalizeDepth(body.depth),
    defaultArticleCount: body.articleCount,
    validTopicIds: new Set(context.topics.map((topic) => topic.id)),
    validStyleIds: new Set(context.styles.map((style) => style.id))
  };

  if (body.action === "plan" || body.action === "revise") {
    if (body.request.trim().length < 4) {
      return NextResponse.json({ error: "请先描述需求（至少 4 个字符）" }, { status: 400 });
    }
    let revision;
    if (body.action === "revise") {
      if (body.feedback.trim().length < 2) {
        return NextResponse.json({ error: "请填写修改意见" }, { status: 400 });
      }
      // 上一版计划先过一遍归一化再交给模型，杜绝把脏数据回灌进 prompt。
      const previous = normalizeAdminAiPlan({ tasks: body.tasks, recurring: body.recurring }, defaults);
      revision = { tasks: previous.tasks, recurring: previous.recurring, feedback: body.feedback };
    }

    let plan: AdminAiPlan;
    try {
      plan = await generateAdminAiPlan({
        modelConfig,
        request: body.request,
        defaultScope: defaults.defaultScope,
        defaultDepth: defaults.defaultDepth,
        defaultArticleCount: defaults.defaultArticleCount,
        topics: context.topics,
        styles: context.styles,
        recentTitles: context.recentTitles,
        revision
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[admin-ai] plan generation failed:", error);
      return NextResponse.json({ error: `AI 管理员规划失败：${message.slice(0, 300)}` }, { status: 502 });
    }

    if (!plan.tasks.length && !plan.recurring.length) {
      return NextResponse.json(
        { error: "AI 管理员没有拆出可执行的内容任务，请把需求写得更具体一些。", plan },
        { status: 422 }
      );
    }

    return NextResponse.json({
      summary: plan.summary,
      warnings: plan.warnings,
      tasks: plan.tasks,
      recurring: plan.recurring,
      totalArticles: planArticleTotal(plan.tasks),
      topics: context.topics.map((topic) => ({ id: topic.id, name: topic.name })),
      styles: context.styles
    });
  }

  // action === "execute"
  const confirmed = normalizeAdminAiPlan(
    { summary: body.request ? `执行：${body.request.slice(0, 200)}` : undefined, tasks: body.tasks, recurring: body.recurring },
    defaults
  );
  if (!confirmed.tasks.length && !confirmed.recurring.length) {
    return NextResponse.json({ error: "没有可执行的任务，请先生成计划。" }, { status: 422 });
  }

  const fallbackStyle = body.contentStyleId
    ? await prisma.contentStyle.findUnique({ where: { id: body.contentStyleId } })
    : (await prisma.contentStyle.findFirst({ where: { isDefault: true } })) ||
      (await prisma.contentStyle.findFirst());

  if (body.contentStyleId && !fallbackStyle) {
    return NextResponse.json({ error: "指定的生成风格不存在" }, { status: 400 });
  }

  const batch = await prisma.adminAiBatch.create({
    data: {
      request: body.request.slice(0, 6000) || "（未提供原始需求）",
      summary: confirmed.summary,
      plan: JSON.stringify({ tasks: confirmed.tasks, recurring: confirmed.recurring })
    }
  });

  // 一次性任务入队
  const queue = getResearchQueue();
  const createdTasks = await withQueue(queue, async () => {
    const rows = [];
    for (const task of confirmed.tasks) {
      const job = await prisma.fetchJob.create({
        data: {
          sourceUrl: buildKeywordResearchUrl(task.keyword, task.scope, task.articleCount, task.depth),
          sourceType: "WEB",
          modelConfigId: modelConfig.id,
          contentStyleId: task.styleId ?? fallbackStyle?.id,
          contentTopicId: task.topicId,
          adminAiBatchId: batch.id
        }
      });
      await queue.add("fetch", { fetchJobId: job.id }, { priority: 1 });
      rows.push({ ...task, jobId: job.id });
    }
    return rows;
  });

  // 周期动作:创建主题 + 定时,并即时注册到调度器
  const recurringResults: Array<{ name: string; topicId: string | null; cadence: { zh: string; en: string }; created: boolean }> = [];
  const warnings = [...confirmed.warnings];
  for (const item of confirmed.recurring) {
    const existing = await prisma.contentTopic.findUnique({ where: { name: item.name } });
    if (existing) {
      warnings.push(`主题「${item.name}」已存在，未重复创建；如需调整节奏请到「自动内容」页修改。`);
      recurringResults.push({ name: item.name, topicId: existing.id, cadence: describeCadence(item), created: false });
      continue;
    }
    const topic = await prisma.contentTopic.create({
      data: {
        name: item.name,
        slug: await uniqueTopicSlug(item.name),
        scope: item.scope,
        keywords: item.keywords,
        compileKind: compileKindFromRecurringMode(item.mode),
        depth: item.depth,
        articleCount: item.articleCount,
        styleId: item.styleId ?? fallbackStyle?.id ?? null,
        isEnabled: true,
        useExa: true
      }
    });
    const schedule = await prisma.autoSchedule.create({
      data: { topicId: topic.id, cron: cronFromCadence(item), isEnabled: true }
    });
    await syncSchedule(schedule.id);
    recurringResults.push({ name: item.name, topicId: topic.id, cadence: describeCadence(item), created: true });
  }

  await prisma.adminAiBatch.update({
    where: { id: batch.id },
    data: {
      plan: JSON.stringify({
        tasks: confirmed.tasks,
        recurring: confirmed.recurring,
        createdTopics: recurringResults
      })
    }
  });

  return NextResponse.json({
    executed: true,
    batchId: batch.id,
    tasks: createdTasks,
    recurring: recurringResults,
    totalArticles: planArticleTotal(createdTasks),
    warnings
  });
}

/** 批次列表(含任务状态聚合),供 AI 管理员页轮询刷新。 */
export async function GET() {
  await requireAdmin();
  const batches = await prisma.adminAiBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      jobs: {
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, sourceUrl: true, error: true, completedAt: true }
      }
    }
  });

  return NextResponse.json({
    batches: batches.map((batch) => {
      let recurring: unknown[] = [];
      try {
        const snapshot = JSON.parse(batch.plan) as { createdTopics?: unknown[] };
        recurring = Array.isArray(snapshot.createdTopics) ? snapshot.createdTopics : [];
      } catch {
        // 快照解析失败只影响周期动作展示,不影响任务进度
      }
      return {
        id: batch.id,
        request: batch.request.slice(0, 300),
        summary: batch.summary,
        createdAt: batch.createdAt.toISOString(),
        recurring,
        jobs: batch.jobs.map((job) => ({
          id: job.id,
          status: job.status,
          keyword: parseKeywordResearchUrl(job.sourceUrl)?.keyword || job.sourceUrl.slice(0, 80),
          error: job.error ? job.error.slice(0, 200) : null
        }))
      };
    })
  });
}

async function uniqueTopicSlug(name: string): Promise<string> {
  const base = slugify(name) || `topic-${Date.now().toString(36)}`;
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await prisma.contentTopic.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function normalizeScope(value: string): ResearchScope {
  return isResearchScope(value) ? value : "all";
}

function normalizeDepth(value: string): ResearchDepth {
  return isResearchDepth(value) ? value : "long";
}
