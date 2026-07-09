import { NextResponse } from "next/server";
import type { Queue } from "bullmq";
import { z } from "zod";
import { generateAdminAiPlan } from "@/lib/admin-ai";
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

const BodySchema = z.object({
  request: z.string().min(4).max(6000),
  scope: z.enum(["all", "domestic", "international"]).default("all"),
  depth: z.enum(["standard", "long", "deep"]).default("long"),
  articleCount: z.coerce.number().int().min(1).max(5).default(1),
  contentStyleId: z.string().max(120).optional().default("")
});

async function withQueue<T>(queue: Queue, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await queue.close().catch(() => undefined);
  }
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

  const style = body.contentStyleId
    ? await prisma.contentStyle.findUnique({ where: { id: body.contentStyleId } })
    : (await prisma.contentStyle.findFirst({ where: { isDefault: true } })) ||
      (await prisma.contentStyle.findFirst());

  if (body.contentStyleId && !style) {
    return NextResponse.json({ error: "指定的生成风格不存在" }, { status: 400 });
  }

  let plan;
  try {
    plan = await generateAdminAiPlan({
      modelConfig,
      request: body.request,
      defaultScope: normalizeScope(body.scope),
      defaultDepth: normalizeDepth(body.depth),
      defaultArticleCount: body.articleCount
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

  const queue = getResearchQueue();
  const created = await withQueue(queue, async () => {
    const rows = [];
    for (const task of plan.tasks) {
      const job = await prisma.fetchJob.create({
        data: {
          sourceUrl: buildKeywordResearchUrl(task.keyword, task.scope, task.articleCount, task.depth),
          sourceType: "WEB",
          modelConfigId: modelConfig.id,
          contentStyleId: style?.id
        }
      });
      await queue.add("fetch", { fetchJobId: job.id }, { priority: 1 });
      rows.push({ ...task, jobId: job.id });
    }
    return rows;
  });

  return NextResponse.json({
    summary: plan.summary,
    warnings: plan.warnings,
    tasks: created
  });
}

function normalizeScope(value: string): ResearchScope {
  return isResearchScope(value) ? value : "all";
}

function normalizeDepth(value: string): ResearchDepth {
  return isResearchDepth(value) ? value : "long";
}
