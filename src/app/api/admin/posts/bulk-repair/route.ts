import { NextResponse } from "next/server";
import type { Queue } from "bullmq";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { enqueueBatchContinuing } from "@/lib/batch-queue";
import { getModelConfigForUse } from "@/lib/model-selection";
import {
  buildPostRepairUrl,
  decodePostRepairResult,
  encodePostRepairResult,
  parsePostRepairUrl,
  POST_REPAIR_MAX_ATTEMPTS,
  postRepairEvidenceRevision,
  postRepairGuidance,
  type PostRepairResult
} from "@/lib/post-repair";
import { prisma } from "@/lib/prisma";
import { getResearchQueue } from "@/lib/queue";
import { parseJsonBody } from "@/lib/request-validation";
import { revalidatePublicContent } from "@/lib/revalidate-public";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  postIds: z.array(z.string().min(1).max(120)).min(1).max(40)
});

async function withQueue<T>(queue: Queue, callback: () => Promise<T>) {
  try {
    return await callback();
  } finally {
    await queue.close().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const postIds = [...new Set(parsed.data.postIds)];

  const [posts, modelConfig, fallbackStyle] = await Promise.all([
    prisma.post.findMany({
      where: { id: { in: postIds } },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        rawItemId: true,
        rawItem: {
          select: {
            id: true,
            title: true,
            url: true,
            content: true,
            markdown: true,
            artifactKind: true,
            fetchJob: { select: { sourceType: true, sourceUrl: true, contentStyleId: true } }
          }
        }
      }
    }),
    getModelConfigForUse("content"),
    prisma.contentStyle.findFirst({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] })
  ]);

  if (posts.length !== postIds.length) {
    return NextResponse.json({ error: "所选文章中有条目已被删除，请刷新列表后重试" }, { status: 404 });
  }
  const nonDrafts = posts.filter((post) => post.status !== "DRAFT");
  if (nonDrafts.length) {
    return NextResponse.json({
      error: `AI 自动返修只处理草稿；所选内容中有 ${nonDrafts.length} 篇不是草稿，请刷新后重新选择`
    }, { status: 409 });
  }

  const orderedPosts = postIds.map((id) => posts.find((post) => post.id === id)!);
  const { batch, jobs } = await prisma.$transaction(async (tx) => {
    const batch = await tx.adminAiBatch.create({
      data: {
        request: `批量 AI 审核、返修并发布 ${orderedPosts.length} 篇文章`,
        summary: `逐篇执行发布检查；可修复问题最多返修 ${POST_REPAIR_MAX_ATTEMPTS} 轮，资料不足时安全停止。`,
        plan: JSON.stringify({
          kind: "post_repair",
          postIds: orderedPosts.map((post) => post.id),
          maxAttempts: POST_REPAIR_MAX_ATTEMPTS
        })
      }
    });
    const jobs = [];
    for (const post of orderedPosts) {
      const raw = post.rawItem;
      const evidenceRevision = postRepairEvidenceRevision({
        rawItemId: raw?.id,
        title: raw?.title,
        url: raw?.url,
        content: raw?.content,
        markdown: raw?.markdown,
        artifactKind: raw?.artifactKind,
        sourceType: raw?.fetchJob?.sourceType,
        fetchSourceUrl: raw?.fetchJob?.sourceUrl
      });
      jobs.push(await tx.fetchJob.create({
        data: {
          sourceUrl: buildPostRepairUrl({
            postId: post.id,
            expectedUpdatedAt: post.updatedAt,
            evidenceRevision
          }),
          sourceType: "WEB",
          modelConfigId: modelConfig?.id,
          contentStyleId: raw?.fetchJob?.contentStyleId || fallbackStyle?.id,
          adminAiBatchId: batch.id
        }
      }));
    }
    return { batch, jobs };
  });

  const titleByJobId = new Map(jobs.map((job, index) => [job.id, orderedPosts[index].title]));
  const postIdByJobId = new Map(jobs.map((job, index) => [job.id, orderedPosts[index].id]));
  const queue = getResearchQueue();
  const outcomes = await withQueue(queue, () => enqueueBatchContinuing(
    jobs.map((job) => ({ jobId: job.id, task: { postId: postIdByJobId.get(job.id)! } })),
    {
      enqueue: async (jobId) => {
        // Internal content rounds are already bounded. A queue-level 3x retry
        // would silently turn them into as many as nine model rewrites.
        await queue.add("post-repair", { fetchJobId: jobId }, { priority: 1, attempts: 1 });
      },
      markFailed: async (jobId, error) => {
        const result = failedResult(
          postIdByJobId.get(jobId) || "",
          titleByJobId.get(jobId) || "文章",
          error
        );
        // Redis may have accepted the job even when the client lost the ACK.
        // Only a still-QUEUED row may be classified as an enqueue failure;
        // never overwrite a worker that already moved it to RUNNING/COMPLETED.
        await prisma.fetchJob.updateMany({
          where: { id: jobId, status: "QUEUED" },
          data: { status: "FAILED", error: encodePostRepairResult(result), completedAt: new Date() }
        });
      }
    }
  ));

  return NextResponse.json({
    accepted: true,
    batchId: batch.id,
    maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
    jobs: outcomes.map((outcome) => ({
      jobId: outcome.jobId,
      postId: outcome.task.postId,
      status: outcome.status
    }))
  }, { status: 202 });
}

export async function GET(request: Request) {
  await requireAdmin();
  const batchId = new URL(request.url).searchParams.get("batchId")?.trim() || "";
  if (!batchId || batchId.length > 120) {
    return NextResponse.json({ error: "缺少有效的返修批次 ID" }, { status: 400 });
  }

  const batch = await prisma.adminAiBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      plan: true,
      jobs: {
        orderBy: { createdAt: "asc" },
        select: { id: true, sourceUrl: true, status: true, error: true, updatedAt: true }
      }
    }
  });
  if (!batch || !isPostRepairBatch(batch.plan)) {
    return NextResponse.json({ error: "返修批次不存在" }, { status: 404 });
  }

  const postIds = batch.jobs
    .map((job) => parsePostRepairUrl(job.sourceUrl)?.postId)
    .filter((id): id is string => Boolean(id));
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: { id: true, title: true, slug: true, status: true }
  });
  const titleByPostId = new Map(posts.map((post) => [post.id, post.title]));
  const postById = new Map(posts.map((post) => [post.id, post]));

  const results = batch.jobs.map((job) => {
    const parsedUrl = parsePostRepairUrl(job.sourceUrl);
    const postId = parsedUrl?.postId || "";
    const decoded = decodePostRepairResult(job.error);
    const actualPost = postById.get(postId);
    if (actualPost?.status === "PUBLISHED") {
      return {
        jobId: job.id,
        jobStatus: job.status,
        updatedAt: job.updatedAt.toISOString(),
        ...(decoded || {
          version: 1 as const,
          postId,
          title: actualPost.title,
          attempts: 0,
          maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
          rounds: []
        }),
        state: "PUBLISHED" as const,
        message: decoded?.state === "PUBLISHED" ? decoded.message : "文章已发布；结果已按数据库实际状态校正",
        reason: null,
        guidance: null
      };
    }
    if (decoded) return { jobId: job.id, jobStatus: job.status, updatedAt: job.updatedAt.toISOString(), ...decoded };

    const title = titleByPostId.get(postId) || "文章";
    if (job.status === "FAILED") {
      const reason = job.error || "后台返修任务异常结束";
      return {
        jobId: job.id,
        jobStatus: job.status,
        updatedAt: job.updatedAt.toISOString(),
        ...failedResult(postId, title, reason)
      };
    }
    const state = job.status === "RUNNING" ? "RUNNING" as const : "QUEUED" as const;
    return {
      jobId: job.id,
      jobStatus: job.status,
      updatedAt: job.updatedAt.toISOString(),
      version: 1 as const,
      postId,
      title,
      state,
      attempts: 0,
      maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
      message: state === "RUNNING" ? "正在执行首次发布检查" : "等待后台编辑接手",
      reason: null,
      guidance: null,
      rounds: []
    };
  });

  const terminal = results.filter((result) => result.jobStatus === "COMPLETED" || result.jobStatus === "FAILED").length;
  if (terminal === results.length && results.some((result) => result.state === "PUBLISHED")) {
    revalidatePublicContent(posts
      .filter((post) => post.status === "PUBLISHED")
      .map((post) => `/posts/${post.slug}`));
  }
  return NextResponse.json({
    batchId: batch.id,
    complete: terminal === results.length,
    completed: terminal,
    total: results.length,
    published: results.filter((result) => result.state === "PUBLISHED").length,
    failed: results.filter((result) => result.state === "FAILED").length,
    results
  });
}

function failedResult(postId: string, title: string, reason: string): PostRepairResult {
  return {
    version: 1,
    postId,
    title,
    state: "FAILED",
    attempts: 0,
    maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
    message: "后台返修未能开始或异常结束，原稿未被覆盖",
    reason,
    guidance: postRepairGuidance(reason),
    rounds: []
  };
}

function isPostRepairBatch(plan: string) {
  try {
    return (JSON.parse(plan) as { kind?: unknown }).kind === "post_repair";
  } catch {
    return false;
  }
}
