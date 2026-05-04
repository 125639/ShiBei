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
 * Enqueue one run of a NewsTopic.
 *
 * - SINGLE_ARTICLE: one keyword-research FetchJob per keyword (reuses processKeywordResearch).
 * - DAILY_DIGEST / WEEKLY_ROUNDUP: one digest FetchJob covering the full topic.
 */
export async function enqueueTopicRun(topicId: string) {
  const topic = await prisma.newsTopic.findUnique({ where: { id: topicId } });
  if (!topic) return { enqueued: 0, reason: "topic-not-found" as const };

  const modelConfig = await getModelConfigForUse("news");
  const style = topic.styleId
    ? await prisma.summaryStyle.findUnique({ where: { id: topic.styleId } })
    : null;
  const fallbackStyle = style
    || await prisma.summaryStyle.findFirst({ where: { isDefault: true } })
    || await prisma.summaryStyle.findFirst();

  const scope: ResearchScope = isResearchScope(topic.scope) ? topic.scope : "all";
  const depth: ResearchDepth = isResearchDepth(topic.depth) ? topic.depth : "long";

  const queue = getResearchQueue();
  let enqueued = 0;

  try {
    if (topic.compileKind === "SINGLE_ARTICLE") {
      const keywords = parseTopicKeywords(topic.keywords);
      if (!keywords.length) {
        return { enqueued: 0, reason: "no-keywords" as const };
      }

      for (const keyword of keywords) {
        const job = await prisma.fetchJob.create({
          data: {
            sourceUrl: buildKeywordResearchUrl(keyword, scope, topic.articleCount, depth),
            sourceType: "WEB",
            modelConfigId: modelConfig?.id,
            summaryStyleId: fallbackStyle?.id,
            newsTopicId: topic.id
          }
        });
        await queue.add("topic-keyword", { fetchJobId: job.id }, { priority: 2 });
        enqueued++;
      }
    } else {
      const job = await prisma.fetchJob.create({
        data: {
          sourceUrl: buildDigestUrl(topic.id, topic.compileKind),
          sourceType: "WEB",
          modelConfigId: modelConfig?.id,
          summaryStyleId: fallbackStyle?.id,
          newsTopicId: topic.id
        }
      });
      await queue.add("topic-digest", { fetchJobId: job.id }, { priority: 2 });
      enqueued = 1;
    }
  } finally {
    await queue.close();
  }

  return { enqueued, reason: "ok" as const };
}
