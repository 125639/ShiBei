import { NextResponse } from "next/server";
import type { Queue } from "bullmq";
import { z } from "zod";
import {
  generateAdminAiPlan,
  normalizeAdminAiPlan,
  planArticleTotal,
  MAX_PLAN_TASKS
} from "@/lib/admin-ai";
import { requireAdmin } from "@/lib/auth";
import { getModelConfigForUse } from "@/lib/model-selection";
import { prisma } from "@/lib/prisma";
import { getResearchQueue } from "@/lib/queue";
import {
  buildKeywordResearchUrl,
  isResearchDepth,
  isResearchScope,
  type ResearchDepth,
  type ResearchScope
} from "@/lib/research";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

// 两段式：action=plan 只让模型出计划（无副作用），管理员在界面上确认/删减后，
// action=execute 把确认的任务重新走一遍归一化 + topicId 校验再入队。
// execute 不信任客户端字段——normalizeAdminAiPlan 是唯一入队入口的守门人。
const TaskSchema = z.object({
  keyword: z.string().min(2).max(200),
  reason: z.string().max(600).optional().default(""),
  scope: z.enum(["all", "domestic", "international"]),
  depth: z.enum(["standard", "long", "deep"]),
  articleCount: z.coerce.number().int().min(1).max(5),
  topicId: z.string().max(120).nullable().optional().default(null)
});

const BodySchema = z.object({
  action: z.enum(["plan", "execute"]).default("plan"),
  request: z.string().max(6000).optional().default(""),
  scope: z.enum(["all", "domestic", "international"]).default("all"),
  depth: z.enum(["standard", "long", "deep"]).default("long"),
  articleCount: z.coerce.number().int().min(1).max(5).default(1),
  contentStyleId: z.string().max(120).optional().default(""),
  tasks: z.array(TaskSchema).max(MAX_PLAN_TASKS * 2).optional().default([])
});

async function withQueue<T>(queue: Queue, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function loadTopicOptions() {
  const topics = await prisma.contentTopic.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, keywords: true },
    take: 40
  });
  return topics;
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

  const topics = await loadTopicOptions();
  const defaults = {
    defaultScope: normalizeScope(body.scope),
    defaultDepth: normalizeDepth(body.depth),
    defaultArticleCount: body.articleCount,
    validTopicIds: new Set(topics.map((topic) => topic.id))
  };

  if (body.action === "plan") {
    if (body.request.trim().length < 4) {
      return NextResponse.json({ error: "请先描述需求（至少 4 个字符）" }, { status: 400 });
    }
    let plan;
    try {
      plan = await generateAdminAiPlan({
        modelConfig,
        request: body.request,
        defaultScope: defaults.defaultScope,
        defaultDepth: defaults.defaultDepth,
        defaultArticleCount: defaults.defaultArticleCount,
        topics
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[admin-ai] plan generation failed:", error);
      return NextResponse.json({ error: `AI 管理员规划失败：${message.slice(0, 300)}` }, { status: 502 });
    }

    if (!plan.tasks.length) {
      return NextResponse.json(
        { error: "AI 管理员没有拆出可执行的内容任务，请把需求写得更具体一些。", plan },
        { status: 422 }
      );
    }

    return NextResponse.json({
      summary: plan.summary,
      warnings: plan.warnings,
      tasks: plan.tasks,
      totalArticles: planArticleTotal(plan.tasks),
      topics: topics.map((topic) => ({ id: topic.id, name: topic.name }))
    });
  }

  // action === "execute"
  const confirmed = normalizeAdminAiPlan({ tasks: body.tasks }, defaults);
  if (!confirmed.tasks.length) {
    return NextResponse.json({ error: "没有可执行的任务，请先生成计划。" }, { status: 422 });
  }

  const style = body.contentStyleId
    ? await prisma.contentStyle.findUnique({ where: { id: body.contentStyleId } })
    : (await prisma.contentStyle.findFirst({ where: { isDefault: true } })) ||
      (await prisma.contentStyle.findFirst());

  if (body.contentStyleId && !style) {
    return NextResponse.json({ error: "指定的生成风格不存在" }, { status: 400 });
  }

  const queue = getResearchQueue();
  const created = await withQueue(queue, async () => {
    const rows = [];
    for (const task of confirmed.tasks) {
      const job = await prisma.fetchJob.create({
        data: {
          sourceUrl: buildKeywordResearchUrl(task.keyword, task.scope, task.articleCount, task.depth),
          sourceType: "WEB",
          modelConfigId: modelConfig.id,
          contentStyleId: style?.id,
          contentTopicId: task.topicId
        }
      });
      await queue.add("fetch", { fetchJobId: job.id }, { priority: 1 });
      rows.push({ ...task, jobId: job.id });
    }
    return rows;
  });

  return NextResponse.json({
    executed: true,
    tasks: created,
    totalArticles: planArticleTotal(created),
    warnings: confirmed.warnings
  });
}

function normalizeScope(value: string): ResearchScope {
  return isResearchScope(value) ? value : "all";
}

function normalizeDepth(value: string): ResearchDepth {
  return isResearchDepth(value) ? value : "long";
}
