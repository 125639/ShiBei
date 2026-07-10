import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getResearchQueue } from "@/lib/queue";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  jobId: z.string().min(1).max(120)
});

// 只允许重试 AI 管理员批次里的失败任务:重置状态后按原参数重新入队,
// 复用同一 FetchJob 行,批次进度统计因此保持一对一。
export async function POST(request: Request) {
  await requireAdmin();

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  const job = await prisma.fetchJob.findUnique({ where: { id: parsed.data.jobId } });
  if (!job || !job.adminAiBatchId) {
    return NextResponse.json({ error: "任务不存在或不属于 AI 管理员批次" }, { status: 404 });
  }
  if (job.status !== "FAILED") {
    return NextResponse.json({ error: "只有失败的任务可以重试" }, { status: 409 });
  }

  await prisma.fetchJob.update({
    where: { id: job.id },
    data: { status: "QUEUED", error: null, completedAt: null }
  });

  const queue = getResearchQueue();
  try {
    await queue.add("fetch", { fetchJobId: job.id }, { priority: 1 });
  } catch (error) {
    // 入队失败要把状态改回去,否则任务显示排队中却永远不会被处理。
    await prisma.fetchJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "重试入队失败，请确认 Redis/worker 正常后再试" }
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `重试入队失败：${message.slice(0, 200)}` }, { status: 502 });
  } finally {
    await queue.close().catch(() => undefined);
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
