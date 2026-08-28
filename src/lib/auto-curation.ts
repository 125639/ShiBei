import crypto from "node:crypto";
import { prisma } from "./prisma";
import { getModelConfigForUse } from "./model-selection";
import { getResearchQueue } from "./queue";
import {
  buildDigestUrl,
  buildKeywordResearchUrl,
  type ResearchDepth,
  type ResearchScope
} from "./research";

function isResearchScope(value: string): value is ResearchScope {
  return value === "all" || value === "domestic" || value === "international";
}

function isResearchDepth(value: string): value is ResearchDepth {
  return value === "standard" || value === "long" || value === "deep";
}

export function parseTopicKeywords(raw: string): string[] {
  return raw
    .split(/[\n,，、;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Enqueue one run of a ContentTopic.
 *
 * - SINGLE_ARTICLE: one keyword-research FetchJob per keyword (reuses processKeywordResearch).
 * - DAILY_DIGEST / WEEKLY_ROUNDUP: one digest FetchJob covering the full topic.
 */
export type TopicRunResult = {
  enqueued: number;
  skipped: number;
  reason: "ok" | "topic-not-found" | "no-keywords" | "already-running";
};

export async function enqueueTopicRun(topicId: string): Promise<TopicRunResult> {
  const topic = await prisma.contentTopic.findUnique({ where: { id: topicId } });
  if (!topic) return { enqueued: 0, skipped: 0, reason: "topic-not-found" };

  const modelConfig = await getModelConfigForUse("content");
  const style = topic.styleId
    ? await prisma.contentStyle.findUnique({ where: { id: topic.styleId } })
    : null;
  const fallbackStyle = style
    || await prisma.contentStyle.findFirst({ where: { isDefault: true } })
    || await prisma.contentStyle.findFirst();

  const scope: ResearchScope = isResearchScope(topic.scope) ? topic.scope : "all";
  const depth: ResearchDepth = isResearchDepth(topic.depth) ? topic.depth : "long";

  const queue = getResearchQueue();
  let enqueued = 0;
  let skipped = 0;

  try {
    if (topic.compileKind === "SINGLE_ARTICLE") {
      const keywords = parseTopicKeywords(topic.keywords);
      if (!keywords.length) {
        return { enqueued: 0, skipped: 0, reason: "no-keywords" };
      }

      for (const keyword of keywords) {
        const sourceUrl = buildKeywordResearchUrl(keyword, scope, topic.articleCount, depth);
        const added = await enqueueResearchFetchJob({
          topicId: topic.id,
          sourceUrl,
          modelConfigId: modelConfig?.id ?? null,
          contentStyleId: fallbackStyle?.id ?? null,
          queueJobName: "topic-keyword",
          queueJobId: buildTopicQueueJobId(topic.id, sourceUrl)
        });
        if (added === "enqueued") enqueued++;
        else skipped++;
      }
    } else {
      const sourceUrl = buildDigestUrl(topic.id, topic.compileKind);
      const added = await enqueueResearchFetchJob({
        topicId: topic.id,
        sourceUrl,
        modelConfigId: modelConfig?.id ?? null,
        contentStyleId: fallbackStyle?.id ?? null,
        queueJobName: "topic-digest",
        queueJobId: buildTopicQueueJobId(topic.id, sourceUrl)
      });
      if (added === "enqueued") enqueued = 1;
      else skipped = 1;
    }
  } finally {
    await queue.close();
  }

  return { enqueued, skipped, reason: enqueued > 0 ? "ok" : "already-running" };

  async function enqueueResearchFetchJob(input: {
    topicId: string;
    sourceUrl: string;
    modelConfigId: string | null;
    contentStyleId: string | null;
    queueJobName: string;
    queueJobId: string;
  }): Promise<"enqueued" | "duplicate"> {
    const existing = await prisma.fetchJob.findFirst({
      where: {
        contentTopicId: input.topicId,
        sourceUrl: input.sourceUrl,
        status: { in: ["QUEUED", "RUNNING"] }
      },
      select: { id: true }
    });
    if (existing) return "duplicate";

    const fetchJob = await prisma.fetchJob.create({
      data: {
        sourceUrl: input.sourceUrl,
        sourceType: "WEB",
        modelConfigId: input.modelConfigId,
        contentStyleId: input.contentStyleId,
        contentTopicId: input.topicId
      }
    });

    const queueJob = await queue.add(
      input.queueJobName,
      { fetchJobId: fetchJob.id },
      {
        jobId: input.queueJobId,
        priority: 2,
        removeOnComplete: true,
        removeOnFail: true
      }
    );

    if (queueJob.data.fetchJobId !== fetchJob.id) {
      await prisma.fetchJob.update({
        where: { id: fetchJob.id },
        data: {
          status: "FAILED",
          error: `Duplicate topic run suppressed by queue job ${input.queueJobId}`
        }
      }).catch(() => undefined);
      return "duplicate";
    }

    return "enqueued";
  }
}

function buildTopicQueueJobId(topicId: string, sourceUrl: string) {
  const hash = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 20);
  return `topic-${topicId}-${hash}`;
}
