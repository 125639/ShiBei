import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getResearchQueue } from "@/lib/queue";
import { parseJsonBody } from "@/lib/request-validation";
import { buildPostRepairUrl, parsePostRepairUrl, postRepairEvidenceRevision } from "@/lib/post-repair";
import { getModelConfigForUse } from "@/lib/model-selection";

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

  const repair = parsePostRepairUrl(job.sourceUrl);
  let sourceUrl = job.sourceUrl;
  let repairModelConfigId: string | null | undefined;
  if (repair) {
    repairModelConfigId = (await getModelConfigForUse("content"))?.id || null;
    const post = await prisma.post.findUnique({
      where: { id: repair.postId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        rawItem: {
          select: {
            id: true,
            title: true,
            url: true,
            content: true,
            markdown: true,
            artifactKind: true,
            fetchJob: { select: { sourceType: true, sourceUrl: true } }
          }
        }
      }
    });
    if (!post) return NextResponse.json({ error: "对应文章已被删除" }, { status: 404 });
    if (post.status !== "DRAFT") {
      return NextResponse.json({ error: "AI 自动返修只处理草稿；文章状态已经变化，请刷新后确认" }, { status: 409 });
    }
    sourceUrl = buildPostRepairUrl({
      postId: post.id,
      expectedUpdatedAt: post.updatedAt,
      evidenceRevision: postRepairEvidenceRevision({
        rawItemId: post.rawItem?.id,
        title: post.rawItem?.title,
        url: post.rawItem?.url,
        content: post.rawItem?.content,
        markdown: post.rawItem?.markdown,
        artifactKind: post.rawItem?.artifactKind,
        sourceType: post.rawItem?.fetchJob?.sourceType,
        fetchSourceUrl: post.rawItem?.fetchJob?.sourceUrl
      })
    });
  }

  const reset = await prisma.fetchJob.updateMany({
    where: { id: job.id, status: "FAILED" },
    data: {
      sourceUrl,
      status: "QUEUED",
      error: null,
      completedAt: null,
      ...(repair ? { modelConfigId: repairModelConfigId } : {})
    }
  });
  if (reset.count !== 1) {
    return NextResponse.json({ error: "任务状态已变化，请刷新后重试" }, { status: 409 });
  }

  const queue = getResearchQueue();
  try {
    await queue.add(repair ? "post-repair" : "fetch", { fetchJobId: job.id }, {
      priority: 1,
      ...(repair ? { attempts: 1 } : {})
    });
  } catch (error) {
    // Redis may have accepted the job before the response was lost. Only a
    // row that is still QUEUED may be marked failed; RUNNING/COMPLETED is the
    // worker's authoritative state and must never be overwritten here.
    const failed = await prisma.fetchJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "重试入队失败，请确认 Redis/worker 正常后再试",
        completedAt: new Date()
      }
    }).catch(() => undefined);
    if (failed && failed.count === 0) {
      return NextResponse.json({
        ok: true,
        jobId: job.id,
        warning: "队列已可能接收任务，当前状态由后台继续处理；请刷新任务页确认结果"
      }, { status: 202 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `重试入队失败：${message.slice(0, 200)}` }, { status: 502 });
  } finally {
    await queue.close().catch(() => undefined);
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
