import { SourceType } from "@prisma/client";
import { Queue } from "bullmq";
import { requireAdmin } from "@/lib/auth";
import { getModelConfigForUse } from "@/lib/model-selection";
import { getFetchQueue, getResearchQueue } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { buildKeywordResearchUrl, type ResearchDepth, type ResearchScope } from "@/lib/research";

// 包装 fn,确保 fn 抛错时 queue.close() 也会被执行。否则一次失败的入队会泄漏
// 一个 BullMQ 连接(短期内不可见,但反复触发或 OOM 后会拖垮 Redis)。
async function withQueue<T>(queue: Queue, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await queue.close().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const keyword = String(form.get("keyword") || "").trim();
  const keywordScope = String(form.get("keywordScope") || "all") as ResearchScope;
  const articleCount = Number(form.get("articleCount") || 1);
  const articleDepth = String(form.get("articleDepth") || "long") as ResearchDepth;
  const sourceId = String(form.get("sourceId") || "");
  const tempUrl = String(form.get("tempUrl") || "");
  const redirectTarget = normalizeRedirect(String(form.get("redirectTo") || "/admin/jobs"));
  const contentStyleId = String(form.get("contentStyleId") || "").trim();
  const modelConfig = await getModelConfigForUse("content");
  const style = contentStyleId
    ? await prisma.contentStyle.findUnique({ where: { id: contentStyleId } })
    : (await prisma.contentStyle.findFirst({ where: { isDefault: true } })) ||
      (await prisma.contentStyle.findFirst());

  if (keyword) {
    const queue = getResearchQueue();
    await withQueue(queue, async () => {
      const job = await prisma.fetchJob.create({
        data: {
          sourceUrl: buildKeywordResearchUrl(keyword, keywordScope, articleCount, articleDepth),
          sourceType: "WEB",
          modelConfigId: modelConfig?.id,
          contentStyleId: style?.id
        }
      });
      await queue.add("fetch", { fetchJobId: job.id }, { priority: 1 });
    });
  } else if (tempUrl) {
    const queue = getFetchQueue();
    const type = String(form.get("tempType") || "WEB") as SourceType;
    const saveTemp = form.get("saveTemp") === "true";
    await withQueue(queue, async () => {
      const source = saveTemp
        ? await prisma.source.create({
            data: { name: tempUrl, url: tempUrl, type, isDefault: true, isTemporary: false }
          })
        : null;

      const job = await prisma.fetchJob.create({
        data: {
          sourceId: source?.id,
          sourceUrl: tempUrl,
          sourceType: type,
          modelConfigId: modelConfig?.id,
          contentStyleId: style?.id
        }
      });
      await queue.add("fetch", { fetchJobId: job.id });
    });
  } else if (sourceId) {
    const queue = getFetchQueue();
    await withQueue(queue, async () => {
      const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
      const job = await prisma.fetchJob.create({
        data: {
          sourceId: source.id,
          sourceUrl: source.url,
          sourceType: source.type,
          modelConfigId: modelConfig?.id,
          contentStyleId: style?.id
        }
      });
      await queue.add("fetch", { fetchJobId: job.id });
    });
  } else {
    const queue = getFetchQueue();
    await withQueue(queue, async () => {
      const sources = await prisma.source.findMany({ where: { isDefault: true, status: "ACTIVE" } });
      for (const source of sources) {
        const job = await prisma.fetchJob.create({
          data: {
            sourceId: source.id,
            sourceUrl: source.url,
            sourceType: source.type,
            modelConfigId: modelConfig?.id,
            contentStyleId: style?.id
          }
        });
        await queue.add("fetch", { fetchJobId: job.id });
      }
    });
  }

  return redirectTo(redirectTarget, request);
}

function normalizeRedirect(value: string) {
  return value.startsWith("/admin") ? value : "/admin/jobs";
}
