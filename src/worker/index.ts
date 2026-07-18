import { Worker, UnrecoverableError } from "bullmq";
import { CompilationKind } from "@prisma/client";
import { writeFileSync } from "node:fs";
import {
  generateDigest,
  generateContentArticle,
  generateResearchSearchQueries,
  generateSummary,
  repairUnpublishableArticle,
  estimateAudience,
  translateTitleSummaryToEnglish,
  isInsufficientEvidenceOutput,
  ModelRequestError,
  type EvidenceItem
} from "../lib/ai";
import {
  audienceQueueName,
  createRedisConnection,
  fetchQueueName,
  getAudienceQueue,
  getFetchQueue,
  getResearchQueue,
  getVideoDownloadQueue,
  researchQueueName,
  scheduleQueueName,
  videoDownloadQueueName
} from "../lib/queue";
import { reconcileWorkerQueues, type QueueRecoveryStore } from "../lib/queue-recovery";
import { downloadVideoToLocal } from "../lib/video-download";
import { fetchRss } from "../lib/rss";
import {
  digestWindowLabel,
  digestWindowMs,
  isResearchScope,
  parseDigestUrl,
  parseKeywordResearchUrl,
  researchScopeLabel,
  type ResearchDepth,
  type ResearchScope
} from "../lib/research";
import { parseAudienceEstimateUrl } from "../lib/audience";
import { scrapeWebPage } from "../lib/scrape";
import { extractSalientTokens, pickTopRelevantVideo, searchTopYouTubeVideos } from "../lib/youtube-search";
import { scrapeAudienceData } from "../lib/scrape-audience";
import {
  getModelConfigForUse,
  getQueuedModelConfigForUse
} from "../lib/model-selection";
import { slugify } from "../lib/slug";
import { prisma } from "../lib/prisma";
import { enqueueTopicRun, parseTopicKeywords } from "../lib/auto-curation";
import { bootstrapAllSchedules } from "../lib/scheduler";
import {
  buildDigestFallback,
  buildResearchFallbackDraft,
  collectKeywordEvidence,
  normalizeEvidenceUrl,
  rotateEvidence,
  selectWritingEvidence,
  selectRicherEvidenceBody
} from "./evidence";
import {
  assessEvidenceSufficiency,
  assessSourceSufficiency,
  assertPublishableGeneratedArticle,
  assertSufficientSourceMaterial,
  assertUsableSourceMaterial,
  InvalidSourceMaterialError,
  RetryableSourceFetchError,
  UnpublishableGeneratedArticleError,
  isUsableSourceMaterial
} from "../lib/source-quality";
import {
  isDomesticVideoCandidate,
  isDomesticVideoUrl,
  isVideoMediaUrl
} from "../lib/video-policy";
import { selectVideoLinksForPost } from "../lib/video-candidates";
import { runStorageCleanup } from "../lib/storage";
import {
  detectVideoType,
  distributeVideoShortcodes,
  normalizeEmbedUrl,
  removePlaceholderVideoSections
} from "../lib/video-display";
import {
  canonicalizeArticleImageUrl,
  embedArticleImagesInPostContent,
  withImageSource,
  type ArticleImageCandidate
} from "../lib/article-images";
import { hostFromUrl } from "../lib/html";
import { extractTitleAndSummary } from "../lib/post-derive";
import { classifyTopic } from "../lib/topic-classify";
import {
  generationPublicationBlockReason,
  markNonPublishableGeneration,
  publicationData
} from "../lib/publication-policy";
import { normalizeContentMode } from "../lib/content-style";
import { artifactRawItemId } from "../lib/job-artifact";
import {
  buildTrustedEvidenceManifest,
  parsePostRepairUrl,
  POST_REPAIR_MAX_ATTEMPTS,
  runPostRepairRounds
} from "../lib/post-repair";
import { processPostRepair } from "./post-repair";
import { notifyPublicContentRevalidation } from "./public-cache";
import { assessEvidenceClaimConsistency } from "../lib/evidence-claim-consistency";

function workerConcurrency(envName: string, fallback = 1) {
  const n = Number(process.env[envName] || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 4);
}

function requiresSectionHeadings(style: { contentMode: string; length: string }, depth?: ResearchDepth) {
  const mode = normalizeContentMode(style.contentMode);
  // standard 深度的目标只有 800—1400 字，与「短」篇幅同级：写作规则本就
  // 允许短稿不用小标题，门禁不能反过来把它变成硬性要求——模型在三轮返修
  // 里补不出“有意义的小节”时，整篇合格短文会被硬性报废。
  if (depth === "standard") return false;
  return style.length !== "短" && mode !== "essay" && mode !== "opinion";
}

function minimumGeneratedBodyChars(style: { contentMode: string; length: string }) {
  const mode = normalizeContentMode(style.contentMode);
  // “短”与观点/随笔仍然是一篇有标题、有正文、有来源的文章，只是不应被
  // 完整长文的 350 字硬门槛误杀。来源白名单、正文引用和事实门禁均不降低。
  return style.length === "短" || mode === "opinion" || mode === "essay" ? 180 : 350;
}

function assertEvidenceClaims(markdown: string, evidence: EvidenceItem[]) {
  const assessment = assessEvidenceClaimConsistency(markdown, evidence);
  if (!assessment.ok) throw new UnpublishableGeneratedArticleError(assessment.reason);
}

type FetchJobData = {
  fetchJobId: string;
};

type ScheduleJobData = {
  topicId: string;
};

type VideoDownloadJobData = {
  videoId: string;
};

class DuplicatePostRepairDeliveryError extends Error {
  constructor(status: string) {
    super(`返修任务当前状态为 ${status}，后台忽略重复投递`);
    this.name = "DuplicatePostRepairDeliveryError";
  }
}

// ── 共享辅助 ──────────────────────────────────────────────

/**
 * 从 fetchJob 的关联配置或全局默认加载 model + style。
 * 三条流程(summarize / keyword-research / digest)都执行相同的查询逻辑。
 */
async function loadModelAndStyle(fetchJob: { modelConfigId: string | null; contentStyleId: string | null }) {
  const [modelConfig, style] = await Promise.all([
    fetchJob.modelConfigId
      ? getQueuedModelConfigForUse(fetchJob.modelConfigId)
      : getModelConfigForUse("content"),
    fetchJob.contentStyleId
      ? prisma.contentStyle.findUnique({ where: { id: fetchJob.contentStyleId } })
      : prisma.contentStyle.findFirst({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] })
  ]);
  return { modelConfig, style };
}

async function createDraftFromRawItem(
  rawItemId: string,
  generated: string,
  publishable: boolean,
  blockedReason?: string
) {
  const rawItem = await prisma.rawItem.findUniqueOrThrow({
    where: { id: rawItemId },
    include: { fetchJob: true }
  });
  const content = publishable ? generated : markNonPublishableGeneration(generated);
  const parsed = extractTitleAndSummary(content, rawItem.title);
  const slugBase = slugify(`${parsed.title}-${rawItem.id}`);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const publication = await getPublicationData(publishable);
  const topicLink = await resolveTopicLink(rawItem.fetchJob?.contentTopicId);

  // 抓取来源（web/rss）的文章没有显式主题，用词库归类器自动挂一个分类，
  // 否则前台「按主题分栏」对这批文章永远失效（历史上 8 成文章无分类）。
  let autoTopicId: string | null = null;
  if (!topicLink.connect) {
    autoTopicId = await classifyTopicForContent({
      title: parsed.title,
      summary: parsed.summary,
      content: generated,
      sourceId: rawItem.sourceId
    });
  }
  const connectTopicId = topicLink.connect || autoTopicId;

  return prisma.post.upsert({
    where: { rawItemId: rawItem.id },
    update: {
      title: parsed.title,
      titleEn: null,
      summary: parsed.summary,
      summaryEn: null,
      content,
      contentEn: null,
      translatedAt: null,
      status: publication.status,
      publishedAt: publication.publishedAt,
      publicationBlockedReason: publishable ? null : blockedReason || "生成内容未通过发布门禁",
      sourceUrl: rawItem.url,
      kind: topicLink.kind
    },
    create: {
      slug,
      title: parsed.title,
      summary: parsed.summary,
      content,
      status: publication.status,
      publishedAt: publication.publishedAt,
      publicationBlockedReason: publishable ? null : blockedReason || "生成内容未通过发布门禁",
      sourceUrl: rawItem.url,
      rawItemId: rawItem.id,
      kind: topicLink.kind,
      ...(connectTopicId ? { topics: { connect: { id: connectTopicId } } } : {})
    }
  });
}

/**
 * 词库自动归类（见 src/lib/topic-classify.ts）。任何失败都返回 null——
 * 归类只是锦上添花，绝不能让抓取任务因此 FAILED。
 */
async function classifyTopicForContent(input: {
  title: string;
  summary: string;
  content: string;
  sourceId?: string | null;
}): Promise<string | null> {
  try {
    const [topics, source] = await Promise.all([
      // 注意不过滤 isEnabled：启停只控制定时自动生产，分类体系对全部主题有效。
      prisma.contentTopic.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, slug: true, name: true, keywords: true }
      }),
      input.sourceId
        ? prisma.source.findUnique({
            where: { id: input.sourceId },
            select: { modules: { select: { slug: true } } }
          })
        : Promise.resolve(null)
    ]);
    const result = classifyTopic(
      {
        title: input.title,
        summary: input.summary,
        content: input.content,
        moduleSlugs: source?.modules.map((m) => m.slug) || []
      },
      topics
    );
    return result?.topicId ?? null;
  } catch (error) {
    console.error("[topic-classify] failed:", error);
    return null;
  }
}

async function createDraftFromResearch(
  fetchJobId: string,
  keyword: string,
  scopeLabel: string,
  evidence: EvidenceItem[],
  generated: string,
  index: number | undefined,
  publishable: boolean,
  blockedReason?: string,
  trustedEvidence: EvidenceItem[] = [],
  depth: ResearchDepth = "long"
) {
  const content = publishable ? generated : markNonPublishableGeneration(generated);
  const parsed = extractTitleAndSummary(content, keyword);
  const slugBase = slugify(`${parsed.title}-${fetchJobId}`);
  const slug = `${slugBase}-${Date.now().toString(36)}${index ? `-${index}` : ""}`;
  const sourceUrl = `keyword://${encodeURIComponent(keyword)}`;
  const publication = await getPublicationData(publishable);
  const fetchJob = await prisma.fetchJob.findUnique({ where: { id: fetchJobId } });
  const topicLink = await resolveTopicLink(fetchJob?.contentTopicId);
  const rawItem = await upsertResearchRawItem(
    fetchJobId,
    keyword,
    scopeLabel,
    evidence,
    trustedEvidence,
    index ?? 1,
    depth
  );

  return prisma.post.upsert({
    where: { rawItemId: rawItem.id },
    update: {
      title: parsed.title,
      titleEn: null,
      summary: parsed.summary,
      summaryEn: null,
      content,
      contentEn: null,
      translatedAt: null,
      status: publication.status,
      publishedAt: publication.publishedAt,
      publicationBlockedReason: publishable ? null : blockedReason || "生成内容未通过发布门禁",
      sourceUrl,
      kind: topicLink.kind
    },
    create: {
      slug,
      title: parsed.title,
      summary: parsed.summary,
      content,
      status: publication.status,
      publishedAt: publication.publishedAt,
      publicationBlockedReason: publishable ? null : blockedReason || "生成内容未通过发布门禁",
      sourceUrl,
      rawItemId: rawItem.id,
      kind: topicLink.kind,
      ...(topicLink.connect ? { topics: { connect: { id: topicLink.connect } } } : {})
    }
  });
}

async function upsertResearchRawItem(
  fetchJobId: string,
  keyword: string,
  scopeLabel: string,
  evidence: EvidenceItem[],
  trustedEvidence: EvidenceItem[],
  index: number,
  depth: ResearchDepth = "long"
) {
  const sourceUrl = `keyword://${encodeURIComponent(keyword)}`;
  const trustedUrls = new Set(trustedEvidence.map((item) => normalizeEvidenceUrl(item.url)));
  const researchClues = evidence.filter((item) => !trustedUrls.has(normalizeEvidenceUrl(item.url)));
  const markdown = [
    buildTrustedEvidenceManifest(trustedEvidence),
    "",
    `# ${keyword}`,
    "",
    `范围：${scopeLabel}`,
    `深度：${depth}`,
    "",
    "## 可用于写作的正文资料",
    ...(trustedEvidence.length ? formatEvidenceInventory(trustedEvidence) : ["（无）"]),
    "",
    "## 仅供检索的研究线索",
    ...(researchClues.length ? formatEvidenceInventory(researchClues) : ["（无）"])
  ].join("\n");

  const rawItemId = artifactRawItemId(fetchJobId, `keyword:${index}`);
  // NUL(0x00) 由 Prisma 客户端扩展统一剥离（src/lib/prisma.ts），无需手工包裹。
  const researchData = {
    title: `关键词研究：${keyword}`,
    url: sourceUrl,
    content: evidence.map((item) => `${item.title}\n${item.summary}`).join("\n\n"),
    markdown,
    fetchJobId
  };
  return prisma.rawItem.upsert({
    where: { id: rawItemId },
    create: { id: rawItemId, ...researchData },
    update: researchData
  });
}

function formatEvidenceInventory(items: EvidenceItem[]) {
  return items.map((item, index) => [
    `${index + 1}. [${item.title}](${item.url})`,
    `   - 来源：${item.sourceName}`,
    item.publishedAt ? `   - 时间：${item.publishedAt.toISOString()}` : null,
    `   - 摘录：${item.summary.slice(0, 500)}`
  ].filter(Boolean).join("\n"));
}

async function resolveTopicLink(topicId: string | null | undefined): Promise<{ connect: string | null; kind: CompilationKind }> {
  if (!topicId) return { connect: null, kind: "SINGLE_ARTICLE" };
  const topic = await prisma.contentTopic.findUnique({ where: { id: topicId } });
  if (!topic) return { connect: null, kind: "SINGLE_ARTICLE" };
  return { connect: topic.id, kind: topic.compileKind };
}

async function getPublicationData(publishable = true) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const autoPublish = settings?.autoPublish ?? false;
  return publicationData(autoPublish, publishable);
}

async function processWeb(fetchJobId: string) {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  const rawItemId = artifactRawItemId(fetchJob.id, "web");
  const existing = await prisma.rawItem.findUnique({
    where: { id: rawItemId },
    select: {
      post: {
        select: { publicationBlockedReason: true, summary: true, content: true }
      }
    }
  });
  if (existing?.post && !generationPublicationBlockReason({ ...existing.post, generatedArtifact: true })) return;

  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const textOnly = (settings as { textOnlyMode?: boolean } | null)?.textOnlyMode === true;

  const result = await scrapeWebPage(fetchJob.sourceUrl);
  const sourcePageUrl = result.finalUrl || fetchJob.sourceUrl;
  assertUsableSourceMaterial({
    title: result.title,
    content: result.content,
    markdown: result.markdown
  });
  const webData = {
    title: result.title,
    url: sourcePageUrl,
    content: result.content,
    markdown: result.markdown,
    sourceId: fetchJob.sourceId,
    fetchJobId: fetchJob.id
  };
  const rawItem = await prisma.rawItem.upsert({
    where: { id: rawItemId },
    create: { id: rawItemId, ...webData },
    update: webData
  });

  const post = await summarizeRawItem(rawItem.id, fetchJob.id);
  if (autoImageSearchEnabled(settings)) {
    // 网页来源已经有 DOM 上下文，直接用来源页图片走统一筛选/缓存/插入链路。
    await embedArticleImagesInPostContent(post.id, withImageSource(result.images || [], sourcePageUrl, result.title));
  }

  if (textOnly || !videosFeatureEnabled(settings)) {
    // 纯文本模式或视频功能未开启：完全跳过视频收集。
    return;
  }

  const createdVideoIds: string[] = [];

  for (const link of selectVideoLinksForPost(result.videos, 4)) {
    const url = link.href;
    const created = await prisma.video.create({
      data: {
        title: link.text || "相关视频资源",
        type: "LINK",
        url,
        displayMode: "link",
        summary: "从来源页面自动识别到的相关视频链接。",
        postId: post.id,
        region: isDomesticVideoCandidate(url, sourcePageUrl) ? "DOMESTIC" : "INTERNATIONAL",
        sourcePageUrl,
        sourcePlatform: sourcePlatformForVideo(url, sourcePageUrl),
        attribution: `来源页：${sourcePageUrl}\n视频链接：${url}\n自动流程仅保留链接，不下载视频文件。`
      },
      select: { id: true }
    });
    createdVideoIds.push(created.id);
  }

  if (createdVideoIds.length) {
    await embedVideosInPostContent(post.id, createdVideoIds);
  }
}

/**
 * 把 [[video:ID]] 短代码穿插进 post.content（以及英文翻译，如果已生成）：
 * 每个视频按标题/摘要与各章节的关键词相关性落到最合适的章节末尾（每节最多
 * 一个），与任何章节都不相关的才集中放到参考来源前。插入前先清掉 AI 生成
 * 的「相关视频」占位小节，避免"本文无相关视频"紧挨着一排播放器的自相矛盾。
 * 渲染层（posts/[slug]/page.tsx + markdown.ts）会把短代码替换为播放器，并把
 * 已内嵌的视频从文末"相关视频"列表里去重，因此插入不会造成重复展示。
 */
async function embedVideosInPostContent(postId: string, videoIds: string[]) {
  if (!videoIds.length) return;
  try {
    const [post, videos] = await Promise.all([
      prisma.post.findUnique({ where: { id: postId }, select: { content: true, contentEn: true } }),
      prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, title: true, summary: true } })
    ]);
    if (!post || !videos.length) return;

    // findMany 不保证顺序，按调用方给的创建顺序排回去，保证同节竞争时先创建的优先。
    const orderIndex = new Map(videoIds.map((id, index) => [id, index]));
    videos.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    const weave = (markdown: string) =>
      distributeVideoShortcodes(removePlaceholderVideoSections(markdown), videos);
    const nextContent = weave(post.content);
    const nextContentEn = post.contentEn ? weave(post.contentEn) : null;

    await prisma.post.update({
      where: { id: postId },
      data: nextContentEn ? { content: nextContent, contentEn: nextContentEn } : { content: nextContent }
    });
  } catch (err) {
    console.error(`[video-embed] failed to inline shortcodes for post ${postId}:`, err);
  }
}

function autoImageSearchEnabled(settings: unknown) {
  return (settings as { autoImageSearchEnabled?: boolean } | null)?.autoImageSearchEnabled !== false;
}

/** 视频功能总开关（后台 设置→媒体）。默认关闭：不勾选就不收集、不展示任何视频。 */
function videosFeatureEnabled(settings: unknown) {
  return (settings as { videosEnabled?: boolean } | null)?.videosEnabled === true;
}

/**
 * YouTube 相关视频搜索的独立开关（后台 设置→媒体）。默认开启；墙内部署 YouTube
 * 不可达时关掉，省去每篇文章 ≤25s 的搜索超时白等。仅约束主题搜索，不影响证据链视频。
 */
function youtubeSearchFeatureEnabled(settings: unknown) {
  return (settings as { youtubeSearchEnabled?: boolean } | null)?.youtubeSearchEnabled !== false;
}

async function attachImagesFromEvidence(postId: string, evidence: EvidenceItem[]) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if (!autoImageSearchEnabled(settings)) return;

  const evidenceItems = evidence.slice(0, 10).filter((item) => /^https?:\/\//i.test(item.url));
  // 关键词研究和摘要没有原始 DOM，只能回到 evidence 页面二次抓图；并发跑能把
  // 串行 20–50s 的 Playwright 抓取拉到 ~5–10s 量级。
  const scraped = await Promise.all(
    evidenceItems.map((item) =>
      scrapeWebPage(item.url)
        .then((result) => ({ result, fallbackUrl: item.url, sourceTitle: item.title }))
        .catch((error) => {
          console.error(`[image-search] evidence page scrape failed ${item.url}:`, error);
          return null;
        })
    )
  );

  const images: ArticleImageCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of scraped) {
    if (images.length >= 30) break;
    if (!entry?.result?.images?.length) continue;
    const sourcePageUrl = entry.result.finalUrl || entry.fallbackUrl;
    let documentIndex = 0;
    for (const image of entry.result.images) {
      if (!image.src) continue;
      // query/hash 会被规范化，避免同一张图片被多个追踪 URL 重复挂载。
      const canonical = canonicalizeArticleImageUrl(image.src);
      const positionInPage = documentIndex;
      documentIndex += 1;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      images.push({ ...image, sourcePageUrl, sourceTitle: entry.sourceTitle, documentIndex: positionInPage });
      if (images.length >= 30) break;
    }
  }

  await embedArticleImagesInPostContent(postId, images);
}

/**
 * 搜索/RSS 往往只给一两句 teaser。写稿前把靠前的薄资料回源抓成正文，避免
 * “多来源”实际只是多条标题。抓取失败保留原摘要，后续证据门禁再决定能否成文。
 */
async function enrichEvidenceForWriting(
  evidence: EvidenceItem[],
  maxFetches = 6,
  onTransientFailure?: (error: unknown) => void
) {
  // 先按归一化 URL 去重再分配抓取预算：重复链接不该先烧掉一次 Playwright
  // 抓取、末尾才被丢弃。
  const seenInput = new Set<string>();
  const distinct = evidence.filter((item) => {
    const key = normalizeEvidenceUrl(item.url);
    if (seenInput.has(key)) return false;
    seenInput.add(key);
    return true;
  });

  const enriched: EvidenceItem[] = [];
  let fetches = 0;

  for (const item of distinct) {
    const alreadyFullText = item.materialKind === "fulltext" || (item.materialKind === undefined && item.summary.trim().length >= 900);
    if (fetches >= maxFetches || alreadyFullText || !/^https?:\/\//i.test(item.url)) {
      enriched.push(item);
      continue;
    }

    fetches++;
    try {
      const scraped = await scrapeWebPage(item.url);
      const finalUrl = scraped.finalUrl || item.url;
      const assessment = assessSourceSufficiency({
        url: finalUrl,
        title: scraped.title || item.title,
        content: scraped.content,
        markdown: scraped.markdown
      });
      if (!assessment.ok) {
        enriched.push(item);
        continue;
      }
      enriched.push({
        ...item,
        title: scraped.title || item.title,
        url: finalUrl,
        summary: clipEvidenceText(
          sanitizeEvidenceExcerpt(selectRicherEvidenceBody(scraped.markdown, scraped.content)),
          5000
        ),
        materialKind: "fulltext"
      });
    } catch (error) {
      console.error(`[research] evidence enrichment failed ${item.url}:`, error);
      onTransientFailure?.(error);
      enriched.push(item);
    }
  }

  // 抓取后的最终跳转 URL 仍可能与其他条目撞车，出口再按同一规则去重一次。
  const seen = new Set<string>();
  return enriched.filter((item) => {
    const key = normalizeEvidenceUrl(item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeEvidenceExcerpt(markdown: string) {
  return markdown
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    // 内嵌链接尚未被独立抓取核验，只保留锚文本；可引用 URL 始终是该证据块的顶层链接。
    .replace(/\[([^\]]+)]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/<https?:\/\/[^>\s]+>/gi, " ")
    .replace(/https?:\/\/[^\s<>"'”’)\]}，。；！？]+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clipEvidenceText(value: string, limit: number) {
  if (value.length <= limit) return value;
  const head = value.slice(0, limit);
  const floor = Math.floor(limit * 0.72);
  const paragraph = head.lastIndexOf("\n\n");
  if (paragraph >= floor) return head.slice(0, paragraph).trimEnd();
  const sentence = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"), head.lastIndexOf(". "));
  return head.slice(0, sentence >= floor ? sentence + 1 : limit).trimEnd();
}

function sourcePlatformForVideo(videoUrl: string, sourcePageUrl?: string | null): string | null {
  if (sourcePageUrl && isVideoMediaUrl(videoUrl) && isDomesticVideoUrl(sourcePageUrl)) {
    return hostFromUrl(sourcePageUrl) || hostFromUrl(videoUrl);
  }
  return hostFromUrl(videoUrl);
}

async function processRss(fetchJobId: string) {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const items = await fetchRss(fetchJob.sourceUrl);
  // feed 条目缺 link 时既无法回源抓取，也无法建幂等槽/防重发键，直接视为不可用。
  const usableItems = items.filter((item) =>
    Boolean(item.link) && isUsableSourceMaterial({
      title: item.title,
      content: item.summary
    })
  );
  if (!usableItems.length) {
    throw new InvalidSourceMaterialError("RSS 源没有可用条目：疑似错误页、访问受限内容或空内容");
  }

  // 幂等槽键含 fetchJob.id，只防「同一任务重试」内的重复。管理员重跑同一来源
  // 或调度器再次抓取会生成新任务，必须按 URL 查历史已成稿条目，否则同一批
  // feed 条目会被重新生成再发布一遍。历史 rawItem.url 可能是 feed 链接，也可能
  // 是抓取后的最终跳转 URL，所以进循环前与抓取后各比对一次。
  const priorRows = fetchJob.sourceId
    ? await prisma.rawItem.findMany({
        where: { sourceId: fetchJob.sourceId, post: { isNot: null } },
        select: {
          url: true,
          post: {
            select: { publicationBlockedReason: true, summary: true, content: true }
          }
        }
      })
    : [];
  const publishedUrls = new Set(
    priorRows
      .filter((row) => row.post && !generationPublicationBlockReason({ ...row.post, generatedArtifact: true }))
      .map((row) => normalizeEvidenceUrl(row.url))
  );

  let completed = 0;
  let alreadyPublished = 0;
  const failures: string[] = [];
  const generationFailures: string[] = [];
  for (const item of usableItems) {
    if (completed >= 3) break;
    const normalizedLink = normalizeEvidenceUrl(item.link) || item.link;
    if (publishedUrls.has(normalizedLink)) {
      alreadyPublished++;
      continue;
    }
    try {
      // 以 feed 原始链接而非跳转后 URL 定义幂等槽。整个 BullMQ 任务
      // 重试时，已成功的条目直接复用，不再生成和发布。
      const rawItemId = artifactRawItemId(fetchJob.id, `rss:${normalizedLink}`);
      const existing = await prisma.rawItem.findUnique({
        where: { id: rawItemId },
        select: {
          post: {
            select: { publicationBlockedReason: true, summary: true, content: true }
          }
        }
      });
      if (existing?.post && !generationPublicationBlockReason({ ...existing.post, generatedArtifact: true })) {
        completed++;
        continue;
      }

      const feedMarkdown = `# ${item.title}\n\n${item.summary}\n\n来源：${item.link}`;
      let material = {
        title: item.title,
        url: item.link,
        content: item.summary,
        markdown: feedMarkdown,
        images: [] as ArticleImageCandidate[]
      };

      // RSS description 通常只有几十至几百字。薄摘要不能直接扩写成长文，先回到
      // 条目原页抓正文；只有 feed 本身已提供足量全文时才省略这次抓取。
      if (!assessSourceSufficiency(material).ok) {
        const scraped = await scrapeWebPage(item.link);
        const finalUrl = scraped.finalUrl || item.link;
        if (publishedUrls.has(normalizeEvidenceUrl(finalUrl))) {
          alreadyPublished++;
          continue;
        }
        assertSufficientSourceMaterial({
          url: finalUrl,
          title: scraped.title || item.title,
          content: scraped.content,
          markdown: scraped.markdown
        });
        material = {
          title: scraped.title || item.title,
          url: finalUrl,
          content: scraped.content,
          markdown: scraped.markdown,
          images: withImageSource(scraped.images || [], finalUrl, scraped.title || item.title)
        };
      }

      const rawItemData = {
        title: material.title,
        url: material.url,
        content: material.content,
        markdown: material.markdown,
        sourceId: fetchJob.sourceId,
        fetchJobId: fetchJob.id,
        publishedAt: item.date
      };
      const rawItem = await prisma.rawItem.upsert({
        where: { id: rawItemId },
        create: { id: rawItemId, ...rawItemData },
        update: rawItemData
      });
      const post = await summarizeRawItem(rawItem.id, fetchJob.id);
      if (autoImageSearchEnabled(settings) && material.images.length) {
        await embedArticleImagesInPostContent(post.id, material.images);
      }
      completed++;
      publishedUrls.add(normalizedLink);
      publishedUrls.add(normalizeEvidenceUrl(material.url));
    } catch (error) {
      // 瞬时模型故障、成稿协议问题和数据库错误都应交给队列重试，不能被
      // 包装成“RSS 来源永久无效”。只有确定的坏素材才跳过并尝试下一条。
      if (error instanceof UnpublishableGeneratedArticleError) {
        generationFailures.push(`${item.title}: ${error.message}`);
        console.error(`[rss] kept blocked draft and continued ${item.link}:`, error);
        continue;
      }
      if (!(error instanceof InvalidSourceMaterialError)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${item.title}: ${reason}`);
      console.error(`[rss] skipped insufficient or failed item ${item.link}:`, error);
    }
  }

  // 全部条目都已在历史任务中成稿属于「无新内容」，是正常结果；
  // 只有既没有新成稿、也没有任何历史成稿可复用时才算来源失败。
  if (generationFailures.length) {
    throw new UnpublishableGeneratedArticleError(
      `RSS 有 ${generationFailures.length} 条内容未通过成稿门禁：${generationFailures.join("；").slice(0, 1000)}`
    );
  }
  if (!completed && !alreadyPublished) {
    throw new InvalidSourceMaterialError(`RSS 条目均未达到发布门槛：${failures.join("；").slice(0, 1000)}`);
  }
}

async function processVideo(fetchJobId: string) {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({
    where: { id: fetchJobId },
    include: { source: true }
  });
  const rawItemId = artifactRawItemId(fetchJob.id, "video");
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const textOnly = (settings as { textOnlyMode?: boolean } | null)?.textOnlyMode === true;
  const title = fetchJob.source?.name || "视频资源";
  const originalUrl = fetchJob.sourceUrl;
  const summary = "管理员添加的视频资源。";
  const videoData = {
    title,
    url: originalUrl,
    content: `${title}\n${originalUrl}`,
    markdown: `# ${title}\n\n视频来源：${originalUrl}`,
    artifactKind: "VIDEO",
    sourceId: fetchJob.sourceId,
    fetchJobId: fetchJob.id
  };
  const rawItem = await prisma.rawItem.upsert({
    where: { id: rawItemId },
    create: { id: rawItemId, ...videoData },
    update: videoData
  });

  const publication = await getPublicationData();
  const topicLink = await resolveTopicLink(fetchJob.contentTopicId);
  const slugBase = slugify(`${title}-${fetchJob.id}`);
  const post = await prisma.post.upsert({
    where: { rawItemId: rawItem.id },
    update: {},
    create: {
      slug: `${slugBase}-${Date.now().toString(36)}`,
      title,
      summary,
      content: `# ${title}\n\n${summary}\n\n视频来源：${originalUrl}`,
      status: publication.status,
      publishedAt: publication.publishedAt,
      sourceUrl: originalUrl,
      rawItemId: rawItem.id,
      kind: topicLink.kind,
      ...(topicLink.connect ? { topics: { connect: { id: topicLink.connect } } } : {})
    }
  });

  // 视频功能关闭时只保留文字版 Post（内容里已有"视频来源"链接），不建 Video 行。
  if (!videosFeatureEnabled(settings)) return;

  // A retry may arrive after RawItem/Post were committed but before the Video
  // row or shortcode was written. Reconcile every stage instead of treating the
  // existence of Post as proof that the whole pipeline completed.
  const existingVideo = await prisma.video.findFirst({
    where: { postId: post.id, sourcePageUrl: originalUrl },
    select: { id: true }
  });
  const video = existingVideo || await prisma.video.create({
    data: {
      title,
      type: detectVideoType(originalUrl),
      url: normalizeEmbedUrl(originalUrl),
      displayMode: textOnly ? "link" : "embed",
      summary,
      postId: post.id,
      region: isDomesticVideoCandidate(originalUrl, originalUrl) ? "DOMESTIC" : "INTERNATIONAL",
      sourcePageUrl: originalUrl,
      sourcePlatform: sourcePlatformForVideo(originalUrl, originalUrl),
      attribution: `来源页：${originalUrl}\n原视频：${originalUrl}`
    },
    select: { id: true }
  });
  await prisma.post.update({
    where: { id: post.id },
    data: {
      content: `# ${title}\n\n${summary}\n\n[[video:${video.id}]]\n\n原始来源：${originalUrl}`
    }
  });
}

async function processKeywordResearch(fetchJobId: string, keyword: string, scope: ResearchScope, count = 1, depth: ResearchDepth = "long") {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  const { modelConfig, style } = await loadModelAndStyle(fetchJob);
  const scopeLabel = researchScopeLabel(scope);
  // A queue retry may follow a partial multi-article success. Record the
  // successful slots before collecting fresh evidence so a temporary search
  // outage can never replace or unpublish an already accepted article.
  const existingArticles = new Map<number, { title: string; summary: string }>();
  for (let index = 1; index <= count; index++) {
    const existing = await prisma.rawItem.findUnique({
      where: { id: artifactRawItemId(fetchJob.id, `keyword:${index}`) },
      select: {
        post: {
          select: { title: true, summary: true, content: true, publicationBlockedReason: true }
        }
      }
    });
    if (existing?.post && !generationPublicationBlockReason({ ...existing.post, generatedArtifact: true })) {
      existingArticles.set(index, existing.post);
    }
  }
  if (existingArticles.size >= count) return;
  // AI 管理员的 keyword 是写作说明，不一定是好搜索词。国际选题若把整段
  // 中文要求原样塞进 Google News，常直接返回 0 条；先只做检索词改写，
  // 后续事实仍必须来自真实抓取到的资料。
  const searchQueries = modelConfig
    ? await generateResearchSearchQueries({ modelConfig, keyword, scope })
    : undefined;
  let transientEvidenceFailures = 0;
  const noteTransientFailure = () => { transientEvidenceFailures += 1; };
  const collectedEvidence = await collectKeywordEvidence(keyword, scope, {
    topicId: fetchJob.contentTopicId,
    searchQueries,
    onTransientFailure: noteTransientFailure
  });
  const evidence = await enrichEvidenceForWriting(
    collectedEvidence,
    depth === "standard" ? 6 : 8,
    noteTransientFailure
  );

  const writingEvidence = selectWritingEvidence(evidence, keyword);
  // Persist collected and accepted evidence before any model call. If all
  // retries later end in a timeout/429/5xx, the job page still has inspectable
  // RawItems instead of misleadingly reporting “原始条目 0”.
  for (let index = 1; index <= count; index++) {
    if (existingArticles.has(index)) continue;
    await upsertResearchRawItem(fetchJob.id, keyword, scopeLabel, evidence, writingEvidence, index, depth);
  }
  const evidenceAssessment = assessEvidenceSufficiency(writingEvidence, evidencePolicyForDepth(depth));
  if (!evidenceAssessment.ok) {
    const reason = `资料未达到发布门槛：${evidenceAssessment.reason}`;
    for (let index = 1; index <= count; index++) {
      if (existingArticles.has(index)) continue;
      await createDraftFromResearch(
        fetchJob.id,
        keyword,
        scopeLabel,
        evidence,
        `# ${count > 1 ? `${keyword}（第 ${index} 篇）` : keyword}\n\n> 资料未达到发布门槛：${evidenceAssessment.reason}。系统保留研究线索供管理员补充资料后重试。`,
        index,
        false,
        reason,
        writingEvidence,
        depth
      );
    }
    if (transientEvidenceFailures > 0) {
      throw new RetryableSourceFetchError(
        `${reason}；本轮另有 ${transientEvidenceFailures} 个采集请求暂时失败，将自动重试`
      );
    }
    throw new UnpublishableGeneratedArticleError(reason);
  }

  if (!modelConfig || !style) {
    for (let index = 1; index <= count; index++) {
      if (existingArticles.has(index)) continue;
      await createDraftFromResearch(
        fetchJob.id,
        keyword,
        scopeLabel,
        evidence,
        `# ${count > 1 ? `${keyword}（第 ${index} 篇）` : keyword}\n\n> 未配置模型或内容风格，已保留关键词研究资料作为草稿。\n\n${evidence.map((item) => `- [${item.title}](${item.url})：${item.summary}`).join("\n")}`,
        index,
        false,
        "未配置模型或内容风格",
        writingEvidence,
        depth
      );
    }
    throw new ModelRequestError("未配置模型或内容风格", { retryable: false });
  }

  const previousArticles: Array<{ title: string; summary: string }> = [];
  for (let index = 1; index <= count; index++) {
    const existing = existingArticles.get(index);
    if (existing) {
      previousArticles.push(existing);
      continue;
    }

    let generated: string;
    let publishable = true;
    let blockedReason: string | undefined;
    let generationFailure: UnpublishableGeneratedArticleError | ModelRequestError | undefined;
    const articleEvidence = rotateEvidence(writingEvidence, index - 1);
    try {
      generated = await generateContentArticle({
        modelConfig,
        style,
        keyword,
        scopeLabel,
        articleIndex: index,
        articleCount: count,
        depth,
        evidence: articleEvidence,
        previousArticles
      });
      const gateOptions = {
        allowedSourceUrls: articleEvidence.map((item) => item.url),
        requireInlineCitation: true,
        requireSectionHeadings: requiresSectionHeadings(style, depth),
        minimumDistinctInlineSources: Math.min(2, new Set(articleEvidence.map((item) => item.url)).size),
        minimumBodyInformationChars: minimumGeneratedBodyChars(style)
      };
      const initialMeta = extractTitleAndSummary(generated, keyword);
      const repairLoop = await runPostRepairRounds({
        initialDraft: {
          title: initialMeta.title,
          summary: initialMeta.summary,
          content: generated
        },
        maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
        assess: (draft) => {
          try {
            assertEvidenceClaims(draft.content, articleEvidence);
            assertPublishableGeneratedArticle(draft.content, gateOptions);
            return { ok: true };
          } catch (gateError) {
            if (!(gateError instanceof UnpublishableGeneratedArticleError)) throw gateError;
            return { ok: false, reason: gateError.message };
          }
        },
        revise: async (draft, reason, round) => {
          // 证据不足是事实边界，不是措辞或版式问题。不要用三次模型调用
          // 诱导模型在没有新来源时硬凑文章。
          if (isInsufficientEvidenceOutput(draft.content)) {
            return {
              draft,
              action: "repair" as const,
              stopReason: `现有资料不足，自动返修已停止：${draft.content.slice(0, 220)}`
            };
          }
          console.warn(
            `[research] publication repair ${round}/${POST_REPAIR_MAX_ATTEMPTS}: ${reason}`
          );
          const content = await repairUnpublishableArticle({
            modelConfig,
            article: draft.content,
            gateReason: reason,
            allowedUrls: articleEvidence.map((item) => item.url),
            evidence: articleEvidence,
            minimumOutputTokens: depth === "deep" ? 6000 : depth === "long" ? 4200 : 3000,
            repairRound: round,
            maxRepairRounds: POST_REPAIR_MAX_ATTEMPTS
          });
          if (isInsufficientEvidenceOutput(content)) {
            return {
              draft: { ...draft, content },
              action: "repair" as const,
              stopReason: `AI 在第 ${round} 轮确认现有资料不足：${content.slice(0, 220)}`
            };
          }
          const meta = extractTitleAndSummary(content, draft.title || keyword);
          return {
            draft: { title: meta.title, summary: meta.summary, content },
            action: "repair" as const
          };
        }
      });
      if (!repairLoop.ok) {
        throw new UnpublishableGeneratedArticleError(
          `${repairLoop.attempts} 轮自动返修后仍未通过发布检查：${repairLoop.reason || "未知质量问题"}`
        );
      }
      generated = repairLoop.draft.content;
      previousArticles.push(extractTitleAndSummary(generated, keyword));
    } catch (error) {
      // 任何模型/门禁失败都不能发布，但已经收集的研究资料仍有价值。
      // 先落一个带结构化阻断原因的可见草稿，再让任务按原错误重试或失败；
      // 这样供应商 5xx、超时或 Key 配错时，管理员不会再看到“产物 0”。
      if (!(error instanceof UnpublishableGeneratedArticleError) && !(error instanceof ModelRequestError)) throw error;
      publishable = false;
      blockedReason = error.message;
      generationFailure = error;
      generated = buildResearchFallbackDraft(keyword, scopeLabel, articleEvidence, error, index, count, depth);
    }

    const post = await createDraftFromResearch(
      fetchJob.id,
      keyword,
      scopeLabel,
      evidence,
      generated,
      index,
      publishable,
      blockedReason,
      articleEvidence,
      depth
    );
    if (publishable) {
      await attachImagesFromEvidence(post.id, articleEvidence);
      await attachVideosFromEvidence(post.id, articleEvidence, `关键词「${keyword}」`, keyword);
    } else if (generationFailure) {
      // RawItem + blocked Post are durable for diagnosis, but the task itself is
      // not a successful article generation and must remain retryable/visible as failed.
      throw generationFailure;
    }
  }
}

function evidencePolicyForDepth(depth: ResearchDepth) {
  if (depth === "deep") {
    return { minItems: 3, minTotalInformationChars: 2200, strongSingleItemChars: null, minFullTextItems: 3 };
  }
  if (depth === "standard") {
    return { minItems: 2, minTotalInformationChars: 700, strongSingleItemChars: 900, minFullTextItems: 1 };
  }
  return { minItems: 2, minTotalInformationChars: 1200, strongSingleItemChars: null, minFullTextItems: 2 };
}

function clampPopularity(value: number) {
  return Math.max(0, Math.min(value, 2147483647));
}

async function summarizeRawItem(rawItemId: string, fetchJobId: string) {
  const [fetchJob, rawItem] = await Promise.all([
    prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } }),
    prisma.rawItem.findUniqueOrThrow({ where: { id: rawItemId } })
  ]);
  const { modelConfig, style } = await loadModelAndStyle(fetchJob);

  // assertSufficientSourceMaterial 内部先做同样的可用性评估（错误页/拦截页
  // 识别），再做信息量门槛，单独的 usable 断言是重复计算。
  assertSufficientSourceMaterial({
    url: rawItem.url,
    title: rawItem.title,
    content: rawItem.content,
    markdown: rawItem.markdown
  });

  if (!modelConfig || !style) {
    await createDraftFromRawItem(
      rawItem.id,
      `# ${rawItem.title}\n\n${rawItem.markdown}\n\n> 未配置模型或内容风格，已保留原始内容作为草稿。`,
      false,
      "未配置模型或内容风格"
    );
    throw new ModelRequestError("未配置模型或内容风格", { retryable: false });
  }

  const generated = await generateSummary({
    modelConfig,
    style,
    item: {
      title: rawItem.title,
      url: rawItem.url,
      markdown: rawItem.markdown,
      publishedAt: rawItem.publishedAt
    }
  });
  try {
    assertEvidenceClaims(generated, [{
      title: rawItem.title,
      url: rawItem.url,
      sourceName: rawItem.title,
      summary: rawItem.markdown,
      publishedAt: rawItem.publishedAt,
      materialKind: "fulltext"
    }]);
    assertPublishableGeneratedArticle(generated, {
      allowedSourceUrls: [rawItem.url],
      requireInlineCitation: true,
      requireSectionHeadings: requiresSectionHeadings(style),
      minimumDistinctInlineSources: 1,
      minimumBodyInformationChars: minimumGeneratedBodyChars(style)
    });
  } catch (error) {
    if (error instanceof UnpublishableGeneratedArticleError) {
      // 保留模型原稿供管理员查看，但绝不让版式/引用未达标的内容继承自动发布。
      await createDraftFromRawItem(rawItem.id, generated, false, error.message);
      throw error;
    }
    throw error;
  }

  return createDraftFromRawItem(rawItem.id, generated, true);
}

/**
 * 从任意自由文本(标题/摘要/链接)里抽出指向视频平台或直链 mp4/m3u8 的 URL。
 * 不做网络请求,纯 regex。结果按出现先后去重(忽略 query/hash 部分),让上层
 * 调用方决定如何创建 Video 行。
 *
 * 用途:keyword research / digest 这两条流程没有 DOM 可解析,evidence 都是
 * RSS / Google News / Exa 给的纯文本摘要;它们里面经常出现 youtube/bilibili
 * 等 URL,但之前流程完全不抽取,导致这两类 Post 永远没有 Video 行。
 */
function extractVideoUrlsFromText(text: string): string[] {
  if (!text) return [];
  const URL_RE = /https?:\/\/[^\s<>"'，。；【】()]+/g;
  const VIDEO_HOST_RE = /(youtube\.com\/watch|youtu\.be\/|bilibili\.com\/video\/|b23\.tv\/|player\.bilibili\.com|v\.qq\.com\/x|v\.youku\.com|iqiyi\.com\/v_|douyin\.com\/video|vimeo\.com\/\d|dailymotion\.com\/video|\.mp4(?:[?#]|$)|\.m3u8(?:[?#]|$))/i;
  const out: string[] = [];
  const seenKey = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    const trimmed = match[0].replace(/[.,;:!?。，；！？)]+$/, "");
    if (!VIDEO_HOST_RE.test(trimmed)) continue;
    const key = trimmed.replace(/[?#].*$/, "");
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * 给 keyword research / digest 生成的 Post 附挂 Video 行。从 evidence 的
 * title/summary/url 文本中抽视频 URL,纯链接(不下载),写入 Video 表关联到
 * postId。任何单条创建失败都吞掉(console.error),避免拖垮整个 worker job
 * ——视频附挂只是锦上添花,不该让 Post 本身变成 FAILED。
 */
async function attachVideosFromEvidence(postId: string, evidence: EvidenceItem[], contextLabel: string, searchQuery: string) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if ((settings as { textOnlyMode?: boolean } | null)?.textOnlyMode === true) return;
  if (!videosFeatureEnabled(settings)) return;

  // 注意：不能在「证据里没抓到视频」时提前返回——YouTube 主题搜索是独立的视频源，
  // 证据视频为空时（外站封锁抓取很常见）它仍应照常补一支相关视频。
  const createdIds: string[] = [];
  const picks = await collectEvidenceVideoPicks(evidence, 6);
  for (const v of picks) {
    // sourceName 可能带 "[Exa]" / "[搜索]" 之类的内部渠道标记，展示文案里去掉。
    const sourceLabel = v.sourceName.replace(/^\[[^\]]+\]\s*/, "").trim() || "来源页面";
    try {
      const created = await prisma.video.create({
        data: {
          title: v.title,
          type: "LINK",
          url: v.url,
          displayMode: "link",
          summary: `从${sourceLabel}的文章中自动识别到的相关视频链接。`,
          postId,
          region: isDomesticVideoCandidate(v.url, v.sourcePageUrl) ? "DOMESTIC" : "INTERNATIONAL",
          sourcePageUrl: v.sourcePageUrl,
          sourcePlatform: sourcePlatformForVideo(v.url, v.sourcePageUrl),
          attribution: `来源页：${v.sourcePageUrl}\n视频链接：${v.url}\n（基于${contextLabel}的研究资料自动提取；不下载视频文件）`
        },
        select: { id: true }
      });
      createdIds.push(created.id);
    } catch (error) {
      console.error(`[video-attach] failed for ${v.url}:`, error);
    }
  }

  const youtubeId = await attachTopYouTubeVideo(postId, searchQuery).catch((error) => {
    console.error(`[youtube-search] attach failed for post ${postId}:`, error);
    return null;
  });
  if (youtubeId) createdIds.push(youtubeId);

  if (createdIds.length) {
    await embedVideosInPostContent(postId, createdIds);
  }
}

function formatViewCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  return String(count);
}

/**
 * 把关键词/主题/标题清洗成适合 YouTube 搜索的查询：去掉引号、书名号、冒号、
 * 破折号等花体标点（成稿标题常见「"外资撤离"与"散户接盘"：…」这类，直接拿去搜
 * 往往零结果），压缩空白并截断。
 */
function cleanYouTubeQuery(raw: string): string {
  return (raw || "")
    .replace(/[“”"'‘’《》〈〉「」『』【】\[\]()（）:：、，,。.!！?？|｜~～—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function youtubeVideoIdOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * 按文章主题在 YouTube 上搜相关视频，取播放量最高的一支，默认以外链 EMBED 挂到
 * 文末（不下载）。原视频链接与频道保留在 sourcePageUrl/attribution，管理员可在
 * 后台一键下载为 480p 低码率存档。YouTube 不可达/搜索失败一律静默跳过，不影响成稿。
 * 只在带 yt-dlp 的 full/backend 镜像内有意义（frontend 模式不跑 worker）。
 */
async function attachTopYouTubeVideo(postId: string, queryHint: string): Promise<string | null> {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if (!youtubeSearchFeatureEnabled(settings)) return null;

  // 优先用驱动文章的关键词/主题当搜索词；实测成稿后的花体标题（带引号、冒号、
  // 比喻）在 YouTube 上常常一条都搜不到，仅在无关键词时回退到清洗后的标题。
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { title: true } });
  const title = post?.title || "";
  let query = cleanYouTubeQuery(queryHint) || cleanYouTubeQuery(title);
  if (!query) return null;

  // 标题里的型号词（L03/SU7/Mate70…）区分度最高：拼进搜索词缩小范围，并对结果
  // 做相关性分层。实测教训：只搜"小鹏汽车 最新车型"时，L03 首发文章挂上了播放量
  // 更高的 P7+ 测评——泛词搜索永远偏向品牌最热门车型而不是文章主角。
  const salientTokens = extractSalientTokens(`${title} ${queryHint}`);
  for (const token of salientTokens) {
    if (!query.toUpperCase().includes(token)) query = `${query} ${token}`;
  }
  query = query.slice(0, 100);

  const picks = await searchTopYouTubeVideos(query, { limit: 5 });
  const pick = pickTopRelevantVideo(picks, salientTokens);
  if (!pick) return null;

  // 去重：证据链里可能已抓到同一支 YouTube，避免同一文章重复挂。
  const videoId = youtubeVideoIdOf(pick.watchUrl);
  if (videoId) {
    const existing = await prisma.video.findMany({ where: { postId }, select: { url: true, sourcePageUrl: true } });
    const already = existing.some(
      (v) => (v.url && v.url.includes(videoId)) || (v.sourcePageUrl && v.sourcePageUrl.includes(videoId))
    );
    if (already) return null;
  }

  const viewsLabel = formatViewCount(pick.viewCount);
  const channelSuffix = pick.channel ? `，频道：${pick.channel}` : "";
  const created = await prisma.video.create({
    data: {
      title: pick.title || "相关 YouTube 视频",
      type: "EMBED",
      url: normalizeEmbedUrl(pick.watchUrl),
      displayMode: "embed",
      summary: `按文章主题在 YouTube 上自动匹配、优先选取播放量最高者（约 ${viewsLabel} 次观看）。`,
      postId,
      region: "INTERNATIONAL",
      durationSec: pick.durationSec ?? undefined,
      sourcePageUrl: pick.watchUrl,
      sourcePlatform: "YouTube",
      attribution:
        `YouTube 搜索自动匹配，按播放量优先（约 ${viewsLabel} 次观看${channelSuffix}）。\n` +
        `原视频：${pick.watchUrl}\n默认外链播放、未下载；管理员可在后台下载为 480p 低码率存档。`
    },
    select: { id: true }
  });
  return created.id;
}

type EvidenceVideoPick = { url: string; title: string; sourceName: string; sourcePageUrl: string };

async function collectEvidenceVideoPicks(evidence: EvidenceItem[], limit: number): Promise<EvidenceVideoPick[]> {
  const seen = new Set<string>();
  const picks: EvidenceVideoPick[] = [];

  const addPick = (item: EvidenceItem, url: string, title: string | null | undefined, sourcePageUrlOverride?: string | null) => {
    const key = normalizeVideoPickKey(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    picks.push({
      url,
      title: (title || item.title || "相关视频资源").slice(0, 200),
      sourceName: item.sourceName,
      sourcePageUrl: sourcePageUrlOverride || item.url
    });
  };

  for (const item of evidence) {
    const text = `${item.title || ""}\n${item.summary || ""}\n${item.url || ""}`;
    for (const url of extractVideoUrlsFromText(text)) {
      addPick(item, url, item.title);
      if (picks.length >= limit) return picks;
    }
  }

  for (const item of evidence.slice(0, 4)) {
    if (picks.length >= limit) break;
    if (!/^https?:\/\//i.test(item.url)) continue;
    const scraped = await scrapeWebPage(item.url).catch((error) => {
      console.error(`[video-attach] evidence page scrape failed ${item.url}:`, error);
      return null;
    });
    if (!scraped?.videos?.length) continue;
    // 优先用 scraped.finalUrl 作为 sourcePageUrl：Google News / 短链跳转后的真实文章页，
    // 这才是 isDomesticVideoCandidate 推断 CDN 直链国内归属时需要的来源域。
    const sourcePageUrl = scraped.finalUrl || item.url;
    for (const link of selectVideoLinksForPost(scraped.videos, 3)) {
      addPick(item, link.href, link.text === "页面播放器加载的视频流" ? `${item.title}｜视频` : link.text, sourcePageUrl);
      if (picks.length >= limit) return picks;
    }
  }

  return picks;
}

function normalizeVideoPickKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (!parsed.protocol.startsWith("http")) return "";
    if (isVideoMediaUrl(url)) {
      parsed.search = "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

async function processAudienceEstimate(fetchJobId: string, sourceId: string) {
  const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
  const modelConfig = await getModelConfigForUse("content");

  if (!modelConfig) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { popularity: 0, popularityUpdatedAt: new Date() }
    });
    return;
  }

  const { rawMetrics, pageText, foundExactNumber } = await scrapeAudienceData(source.url, source.type);

  let popularity = foundExactNumber || 0;
  if (popularity <= 0) {
    try {
      popularity = await estimateAudience({
        modelConfig,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceType: source.type,
        rawMetrics,
        pageText
      });
    } catch (error) {
      console.error(`Audience estimation failed for ${source.name}:`, error);
      popularity = 0;
    }
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: { popularity: clampPopularity(popularity), popularityUpdatedAt: new Date() }
  });
}

async function processDigest(fetchJobId: string, topicId: string, digestKind: "DAILY_DIGEST" | "WEEKLY_ROUNDUP") {
  const [fetchJob, topic] = await Promise.all([
    prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } }),
    prisma.contentTopic.findUniqueOrThrow({ where: { id: topicId } })
  ]);
  const existing = await prisma.rawItem.findUnique({
    where: { id: artifactRawItemId(fetchJob.id, "digest") },
    select: {
      post: {
        select: { publicationBlockedReason: true, summary: true, content: true }
      }
    }
  });
  if (existing?.post && !generationPublicationBlockReason({ ...existing.post, generatedArtifact: true })) return;
  const { modelConfig, style } = await loadModelAndStyle(fetchJob);

  const scope = isResearchScope(topic.scope) ? topic.scope : "all";
  const scopeLabel = researchScopeLabel(scope);
  const windowMs = digestWindowMs(digestKind);
  // 以 FetchJob 入队时间固定窗口终点，避免队列积压后相邻日报出现漂移、缺口或重叠。
  const windowEnd = fetchJob.createdAt;
  const windowStart = new Date(windowEnd.getTime() - windowMs);
  const latestAcceptedTime = windowEnd.getTime() + 5 * 60 * 1000;
  const windowLabel = digestWindowLabel(digestKind);
  const keywords = parseTopicKeywords(topic.keywords);

  const seen = new Set<string>();
  const allEvidence: EvidenceItem[] = [];
  let transientEvidenceFailures = 0;
  const noteTransientFailure = () => { transientEvidenceFailures += 1; };

  for (const keyword of keywords) {
    if (allEvidence.length >= 16) break;
    const items = await collectKeywordEvidence(keyword, scope, {
      topicId: topic.id,
      onTransientFailure: noteTransientFailure
    });
    for (const item of items) {
      if (allEvidence.length >= 16) break;
      const key = normalizeEvidenceUrl(item.url);
      if (seen.has(key)) continue;
      // 定时报/周报必须能证明条目位于时间窗口内。没有日期的资料可用于普通研究，
      // 但不能被包装成“过去 24 小时 / 7 天”的新进展。
      const publishedTime = item.publishedAt?.getTime() ?? Number.NaN;
      if (!Number.isFinite(publishedTime) || publishedTime < windowStart.getTime() || publishedTime > latestAcceptedTime) continue;
      seen.add(key);
      allEvidence.push(item);
    }
  }

  const formatLabel = digestKind === "WEEKLY_ROUNDUP" ? "周报综述" : "每日要闻";
  const fallbackTitle = `${topic.name} · ${formatLabel}`;

  const enrichedEvidence = await enrichEvidenceForWriting(allEvidence, 8, noteTransientFailure);
  allEvidence.splice(0, allEvidence.length, ...enrichedEvidence);
  const digestWritingEvidence = selectWritingEvidence(allEvidence, `${topic.name} ${keywords.join(" ")}`);
  await upsertDigestRawItem(
    fetchJob.id,
    topic.id,
    digestKind,
    fallbackTitle,
    allEvidence,
    digestWritingEvidence,
    windowLabel,
    scopeLabel
  );

  const digestEvidenceAssessment = assessEvidenceSufficiency(digestWritingEvidence, {
    minItems: 3,
    minTotalInformationChars: digestKind === "WEEKLY_ROUNDUP" ? 1600 : 1100,
    strongSingleItemChars: null,
    minFullTextItems: 3
  });
  if (!digestEvidenceAssessment.ok) {
    const blockedReason = `资料未达到定时报发布门槛：${digestEvidenceAssessment.reason}`;
    const fallback = `# ${fallbackTitle}\n\n> 资料未达到定时报发布门槛：${digestEvidenceAssessment.reason}。系统已保留本期资料，补充后可重新生成。`;
    await createDraftFromDigest(
      fetchJob.id,
      topic.id,
      digestKind,
      fallbackTitle,
      allEvidence,
      fallback,
      windowLabel,
      scopeLabel,
      false,
      blockedReason,
      digestWritingEvidence
    );
    if (transientEvidenceFailures > 0) {
      throw new RetryableSourceFetchError(
        `${blockedReason}；本轮另有 ${transientEvidenceFailures} 个采集请求暂时失败，将自动重试`
      );
    }
    throw new UnpublishableGeneratedArticleError(blockedReason);
  }

  let generated: string;
  let publishable = true;
  let blockedReason: string | undefined;
  let generationFailure: UnpublishableGeneratedArticleError | ModelRequestError | undefined;
  if (modelConfig && style) {
    try {
      generated = await generateDigest({
        modelConfig,
        style,
        topicName: topic.name,
        scopeLabel,
        windowLabel,
        digestKind,
        evidence: digestWritingEvidence
      });
      const digestGateOptions = {
        allowedSourceUrls: digestWritingEvidence.map((item) => item.url),
        requireInlineCitation: true,
        minimumDistinctInlineSources: 2
      };
      try {
        assertEvidenceClaims(generated, digestWritingEvidence);
        assertPublishableGeneratedArticle(generated, digestGateOptions);
      } catch (gateError) {
        if (!(gateError instanceof UnpublishableGeneratedArticleError)) throw gateError;
        if (isInsufficientEvidenceOutput(generated)) throw gateError;
        console.warn(`[digest] publish gate rejected digest, attempting targeted repair: ${gateError.message}`);
        generated = await repairUnpublishableArticle({
          modelConfig,
          article: generated,
          gateReason: gateError.message,
          allowedUrls: digestWritingEvidence.map((item) => item.url),
          evidence: digestWritingEvidence,
          minimumOutputTokens: 4200
        });
        assertEvidenceClaims(generated, digestWritingEvidence);
        assertPublishableGeneratedArticle(generated, digestGateOptions);
      }
    } catch (error) {
      if (error instanceof ModelRequestError && !error.truncated) throw error;
      if (!(error instanceof UnpublishableGeneratedArticleError) && !(error instanceof ModelRequestError)) throw error;
      publishable = false;
      blockedReason = error.message;
      generationFailure = error;
      generated = buildDigestFallback(topic.name, formatLabel, windowLabel, scopeLabel, allEvidence, error);
    }
  } else {
    publishable = false;
    blockedReason = "未配置模型或内容风格";
    generationFailure = new ModelRequestError(blockedReason, { retryable: false });
    generated = buildDigestFallback(topic.name, formatLabel, windowLabel, scopeLabel, allEvidence, generationFailure);
  }

  const post = await createDraftFromDigest(
    fetchJob.id,
    topic.id,
    digestKind,
    fallbackTitle,
    allEvidence,
    generated,
    windowLabel,
    scopeLabel,
    publishable,
    blockedReason,
    digestWritingEvidence
  );
  if (publishable) {
    await attachImagesFromEvidence(post.id, digestWritingEvidence);
    await attachVideosFromEvidence(post.id, digestWritingEvidence, `${topic.name} ${windowLabel}`, topic.name);
  } else if (generationFailure) {
    throw generationFailure;
  }
}

async function createDraftFromDigest(
  fetchJobId: string,
  topicId: string,
  digestKind: CompilationKind,
  fallbackTitle: string,
  evidence: EvidenceItem[],
  generated: string,
  windowLabel: string,
  scopeLabel: string,
  publishable: boolean,
  blockedReason?: string,
  trustedEvidence: EvidenceItem[] = []
) {
  const content = publishable ? generated : markNonPublishableGeneration(generated);
  const parsed = extractTitleAndSummary(content, fallbackTitle);
  const slugBase = slugify(`${parsed.title}-${fetchJobId}`);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const sourceUrl = `digest://topic?topicId=${encodeURIComponent(topicId)}&kind=${encodeURIComponent(digestKind)}`;
  const publication = await getPublicationData(publishable);
  const rawItem = await upsertDigestRawItem(
    fetchJobId,
    topicId,
    digestKind,
    fallbackTitle,
    evidence,
    trustedEvidence,
    windowLabel,
    scopeLabel
  );

  return prisma.post.upsert({
    where: { rawItemId: rawItem.id },
    update: {
      title: parsed.title,
      titleEn: null,
      summary: parsed.summary,
      summaryEn: null,
      content,
      contentEn: null,
      translatedAt: null,
      status: publication.status,
      publishedAt: publication.publishedAt,
      publicationBlockedReason: publishable ? null : blockedReason || "生成内容未通过发布门禁",
      sourceUrl,
      kind: digestKind
    },
    create: {
      slug,
      title: parsed.title,
      summary: parsed.summary,
      content,
      status: publication.status,
      publishedAt: publication.publishedAt,
      publicationBlockedReason: publishable ? null : blockedReason || "生成内容未通过发布门禁",
      sourceUrl,
      rawItemId: rawItem.id,
      kind: digestKind,
      topics: { connect: { id: topicId } }
    }
  });
}

async function upsertDigestRawItem(
  fetchJobId: string,
  topicId: string,
  digestKind: CompilationKind,
  fallbackTitle: string,
  evidence: EvidenceItem[],
  trustedEvidence: EvidenceItem[],
  windowLabel: string,
  scopeLabel: string
) {
  const sourceUrl = `digest://topic?topicId=${encodeURIComponent(topicId)}&kind=${encodeURIComponent(digestKind)}`;
  const trustedUrls = new Set(trustedEvidence.map((item) => normalizeEvidenceUrl(item.url)));
  const researchClues = evidence.filter((item) => !trustedUrls.has(normalizeEvidenceUrl(item.url)));
  const markdown = [
    buildTrustedEvidenceManifest(trustedEvidence),
    "",
    `# ${fallbackTitle}`,
    "",
    `范围：${scopeLabel} · 时段：${windowLabel}`,
    "",
    "## 可用于写作的正文资料",
    ...(trustedEvidence.length ? formatEvidenceInventory(trustedEvidence) : ["（无）"]),
    "",
    "## 仅供检索的研究线索",
    ...(researchClues.length ? formatEvidenceInventory(researchClues) : ["（无）"])
  ].join("\n");

  const rawItemId = artifactRawItemId(fetchJobId, "digest");
  const digestData = {
    title: fallbackTitle,
    url: sourceUrl,
    content: evidence.map((item) => `${item.title}\n${item.summary}`).join("\n\n") || "（本期无证据）",
    markdown,
    fetchJobId
  };
  return prisma.rawItem.upsert({
    where: { id: rawItemId },
    create: { id: rawItemId, ...digestData },
    update: digestData
  });
}

// 连续失败达到此阈值即自动 PAUSED；成功一次清零。
const SOURCE_FAIL_PAUSE_THRESHOLD = 5;
const FETCH_JOB_HEARTBEAT_MS = 30_000;

// 来源健康记账绝不能影响主流程：内部整体 try/catch，永不抛。
// sourceId 为空（临时抓取、关键词研究等无来源任务）直接跳过。
async function recordSourceFailure(sourceId: string | null | undefined) {
  if (!sourceId) return;
  try {
    const updated = await prisma.source.update({
      where: { id: sourceId },
      data: { failStreak: { increment: 1 } },
      select: { failStreak: true, status: true }
    });
    if (updated.failStreak >= SOURCE_FAIL_PAUSE_THRESHOLD && updated.status !== "PAUSED") {
      await prisma.source.update({ where: { id: sourceId }, data: { status: "PAUSED" } });
      console.warn(`[source-health] 来源 ${sourceId} 连续失败 ${updated.failStreak} 次（阈值 ${SOURCE_FAIL_PAUSE_THRESHOLD}），已自动暂停（PAUSED）。`);
    }
  } catch (error) {
    console.error("[source-health] recordSourceFailure 失败:", error);
  }
}

async function recordSourceSuccess(sourceId: string | null | undefined) {
  if (!sourceId) return;
  try {
    // 仅在当前有累计失败时才写库，避免每次成功都白白 UPDATE。
    const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { failStreak: true } });
    if (source && source.failStreak > 0) {
      await prisma.source.update({ where: { id: sourceId }, data: { failStreak: 0 } });
    }
  } catch (error) {
    console.error("[source-health] recordSourceSuccess 失败:", error);
  }
}

const workerHandler = async (job: { data: FetchJobData; attemptsMade?: number; opts?: { attempts?: number } }) => {
  const fetchJobId = job.data.fetchJobId;
  const queuedFetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  const queuedPostRepair = parsePostRepairUrl(queuedFetchJob.sourceUrl);
  if (queuedFetchJob.status === "FAILED") {
    // A terminal DB row is authoritative. An old/duplicate Bull delivery must
    // never resurrect it without the explicit retry endpoint resetting QUEUED.
    return;
  }
  if (queuedPostRepair && queuedFetchJob.status === "COMPLETED") {
    // BullMQ is at-least-once. A crash after the atomic publish commit but
    // before ACK must not turn a completed repair back into RUNNING/FAILED.
    // Re-delivery is also a reliable second chance to deliver cache invalidation.
    const published = await prisma.post.findUnique({
      where: { id: queuedPostRepair.postId },
      select: { status: true, slug: true }
    });
    if (published?.status === "PUBLISHED") {
      await notifyPublicContentRevalidation([`/posts/${published.slug}`]);
    }
    return;
  }
  let fetchJob;
  if (queuedPostRepair) {
    const claimed = await prisma.fetchJob.updateMany({
      where: {
        id: fetchJobId,
        // A repair owns at most three model rounds. Never let a stalled or
        // duplicate BullMQ delivery claim the same RUNNING row and execute a
        // second three-round loop; such a row is reconciled to FAILED and may
        // be explicitly retried from the UI as a fresh QUEUED run.
        status: "QUEUED",
        updatedAt: queuedFetchJob.updatedAt
      },
      data: { status: "RUNNING", error: null, completedAt: null }
    });
    if (claimed.count !== 1) {
      const current = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
      if (current.status === "COMPLETED") {
        const published = await prisma.post.findUnique({
          where: { id: queuedPostRepair.postId },
          select: { status: true, slug: true }
        });
        if (published?.status === "PUBLISHED") {
          await notifyPublicContentRevalidation([`/posts/${published.slug}`]);
        }
        return;
      }
      throw new DuplicatePostRepairDeliveryError(current.status);
    }
    fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  } else {
    // All recovered/producer deliveries use an atomic claim. A Redis ACK loss,
    // concurrent startup reconciler, or an older queue item can otherwise run
    // the same durable job twice.
    const claimed = await prisma.fetchJob.updateMany({
      where: { id: fetchJobId, status: "QUEUED", updatedAt: queuedFetchJob.updatedAt },
      data: { status: "RUNNING", error: null, completedAt: null }
    });
    if (claimed.count !== 1) return;
    fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  }

  // 只有真正抓取来源内容的任务（RSS/VIDEO/WEB）才计入来源健康。知名度估算
  // （audience://estimate?sourceId=…）、关键词研究、摘要聚合这些特殊 URL 任务即便
  // 带 sourceId，其失败也与"来源能否抓取正文"无关，不能累加 failStreak 把健康来源
  // 误暂停。用前缀判断而非完整解析，避免解析在 try 外抛错绕过下面的失败处理。
  const isSpecialJob = /^(?:keyword:\/\/research|audience:\/\/estimate|digest:\/\/topic|post-repair:\/\/publish)/.test(fetchJob.sourceUrl);
  const healthSourceId = isSpecialJob ? null : fetchJob.sourceId;

  // 网页抓取 + 推理模型单项可能需要数分钟。定时触碰 updatedAt 既让后台能显示
  // “最近活动”，也能区分真正失联的 RUNNING 与仍在正常工作的长任务。
  const heartbeat = setInterval(() => {
    void prisma.fetchJob.updateMany({
      where: { id: fetchJob.id, status: "RUNNING" },
      data: { updatedAt: new Date() }
    }).catch((error) => {
      console.error(`[worker] heartbeat failed for ${fetchJob.id}:`, error);
    });
  }, FETCH_JOB_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    const keywordResearch = parseKeywordResearchUrl(fetchJob.sourceUrl);
    const audienceJob = parseAudienceEstimateUrl(fetchJob.sourceUrl);
    const digestJob = parseDigestUrl(fetchJob.sourceUrl);
    const postRepair = parsePostRepairUrl(fetchJob.sourceUrl);
    if (postRepair) {
      await processPostRepair(fetchJob.id, postRepair);
    } else if (audienceJob) {
      await processAudienceEstimate(fetchJob.id, audienceJob.sourceId);
    } else if (digestJob) {
      await processDigest(fetchJob.id, digestJob.topicId, digestJob.kind);
    } else if (keywordResearch) {
      await processKeywordResearch(fetchJob.id, keywordResearch.keyword, keywordResearch.scope, keywordResearch.count, keywordResearch.depth);
    } else if (fetchJob.sourceType === "RSS") {
      await processRss(fetchJob.id);
    } else if (fetchJob.sourceType === "VIDEO") {
      await processVideo(fetchJob.id);
    } else {
      await processWeb(fetchJob.id);
    }

    await prisma.fetchJob.updateMany({
      where: { id: fetchJob.id, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: new Date() }
    });
    await recordSourceSuccess(healthSourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 来源本身是错误页 → 永久失败，不重试。
    const permanent = error instanceof InvalidSourceMaterialError ||
      error instanceof UnpublishableGeneratedArticleError ||
      (error instanceof ModelRequestError && (!error.retryable || error.truncated));
    // BullMQ v5：处理中 attemptsMade 为 0-based，本次是第 attempt 次。
    const attempt = (job.attemptsMade ?? 0) + 1;
    const totalAttempts = job.opts?.attempts ?? 1;
    const willRetry = !permanent && attempt < totalAttempts;

    if (willRetry) {
      // 瞬时故障且还有重试机会：状态回到 QUEUED，标注第几次失败；
      // 中途失败不计入来源健康——只有最终失败才累加 failStreak。
      await prisma.fetchJob.updateMany({
        where: { id: fetchJob.id, status: "RUNNING" },
        data: { status: "QUEUED", error: `第 ${attempt}/${totalAttempts} 次尝试失败，将自动重试：${message}` }
      });
      throw error; // 交回 BullMQ 按 backoff 重排
    }

    // 最终失败（永久失败，或已用尽重试）。
    await prisma.fetchJob.updateMany({
      where: { id: fetchJob.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", error: message, completedAt: new Date() }
    });
    // 只有明确的来源内容/抓取错误才记来源健康；数据库、模型、
    // 成稿协议等内部故障绝不得误暂停正常来源。
    const causedBySource = error instanceof InvalidSourceMaterialError || error instanceof RetryableSourceFetchError;
    await recordSourceFailure(causedBySource ? healthSourceId : null);

    // 永久失败包成 UnrecoverableError，让 BullMQ 跳过剩余重试。
    if (permanent) throw new UnrecoverableError(message);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
};

const scheduleHandler = async (job: { data: ScheduleJobData }) => {
  const { topicId } = job.data;
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if (!settings?.autoCurationEnabled) {
    console.log(`[schedule] auto curation disabled; skip topic ${topicId}`);
    return;
  }
  const topic = await prisma.contentTopic.findUnique({ where: { id: topicId } });
  if (!topic || !topic.isEnabled) {
    console.log(`[schedule] topic ${topicId} not active; skip`);
    return;
  }
  const result = await enqueueTopicRun(topicId);
  await prisma.autoSchedule.update({
    where: { topicId },
    data: { lastRunAt: new Date() }
  }).catch(() => undefined);
  console.log(`[schedule] topic ${topic.name} (${topicId}) — enqueued ${result.enqueued}, skipped ${result.skipped} jobs (${result.reason})`);
};

const fetchWorker = new Worker<FetchJobData>(
  fetchQueueName,
  workerHandler,
  { connection: createRedisConnection(), concurrency: workerConcurrency("FETCH_WORKER_CONCURRENCY"), lockDuration: 300000 }
);

const researchWorker = new Worker<FetchJobData>(
  researchQueueName,
  workerHandler,
  { connection: createRedisConnection(), concurrency: workerConcurrency("RESEARCH_WORKER_CONCURRENCY"), lockDuration: 300000 }
);

const audienceWorker = new Worker<FetchJobData>(
  audienceQueueName,
  workerHandler,
  { connection: createRedisConnection(), concurrency: workerConcurrency("AUDIENCE_WORKER_CONCURRENCY"), lockDuration: 300000 }
);

const scheduleWorker = new Worker<ScheduleJobData>(
  scheduleQueueName,
  scheduleHandler,
  { connection: createRedisConnection(), concurrency: workerConcurrency("SCHEDULE_WORKER_CONCURRENCY"), lockDuration: 60000 }
);

// 视频下载串行执行（concurrency 1）：yt-dlp + ffmpeg 是 CPU/带宽大户，
// 并发跑会挤占抓取与生成任务。lockDuration 略大于 lib 内 15 分钟的下载超时。
const videoDownloadWorker = new Worker<VideoDownloadJobData>(
  videoDownloadQueueName,
  async (job) => {
    const outcome = await downloadVideoToLocal(job.data.videoId);
    console.log(`[video-download] ${outcome.videoId} -> ${outcome.fileName} (${outcome.fileSizeBytes} bytes)`);
  },
  { connection: createRedisConnection(), concurrency: 1, lockDuration: 16 * 60 * 1000 }
);

const QUEUE_RECONCILE_INTERVAL_MS = (() => {
  const raw = Number(process.env.QUEUE_RECONCILE_INTERVAL_MS || 60_000);
  if (!Number.isFinite(raw)) return 60_000;
  return Math.min(Math.max(Math.floor(raw), 30_000), 10 * 60_000);
})();
let queueRecoveryInFlight = false;
async function tickQueueRecovery() {
  if (queueRecoveryInFlight || shuttingDown) return;
  queueRecoveryInFlight = true;
  const queues = {
    fetch: getFetchQueue(),
    research: getResearchQueue(),
    audience: getAudienceQueue(),
    video: getVideoDownloadQueue()
  };
  try {
    await reconcileWorkerQueues({
      store: prisma as unknown as QueueRecoveryStore,
      queues
    });
  } catch (error) {
    console.error("[queue-recovery] reconciliation failed; will retry:", error);
  } finally {
    await Promise.allSettled(Object.values(queues).map((queue) => queue.close()));
    queueRecoveryInFlight = false;
  }
}

for (const worker of [fetchWorker, researchWorker, audienceWorker, scheduleWorker, videoDownloadWorker]) {
  worker.on("completed", (job) => {
    console.log(`Completed job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed job ${job?.id}:`, error);
  });
}

// processor 内部通常会先把 FetchJob 写成 FAILED；但 worker 进程被杀、任务
// 超过 stalled 上限，或状态更新自身抛错时，BullMQ 仍可能把队列项终结为 failed，
// 数据库却永久停在 RUNNING/QUEUED。只在 Redis 已确认是最终 failed（重试中的
// job 会处于 delayed/waiting）时补记状态，且不覆盖 processor 已落下的详细错误。
for (const worker of [fetchWorker, researchWorker, audienceWorker]) {
  worker.on("failed", (job, error) => {
    if (!job?.data.fetchJobId) return;
    // A second Bull item may exist when Redis accepted queue.add but the client
    // lost its ACK. Its refusal must not mark the first, currently RUNNING
    // processor's shared FetchJob as FAILED.
    if (error instanceof DuplicatePostRepairDeliveryError || error.name === "DuplicatePostRepairDeliveryError") {
      void prisma.fetchJob.updateMany({
        where: {
          id: job.data.fetchJobId,
          status: "RUNNING",
          // A healthy processor touches updatedAt every 30 seconds. Only a
          // genuinely abandoned lease becomes FAILED/retryable; an immediate
          // duplicate caused by a lost queue ACK leaves the live run untouched.
          updatedAt: { lt: new Date(Date.now() - FETCH_JOB_HEARTBEAT_MS * 3) }
        },
        data: {
          status: "FAILED",
          error: "返修 worker 在处理中断，任务已安全停止；原稿未被覆盖，可点击重试",
          completedAt: new Date()
        }
      }).catch((reconcileError) => {
        console.error(`[worker] failed to reconcile abandoned repair ${job.id}:`, reconcileError);
      });
      return;
    }
    void (async () => {
      const state = await job.getState();
      if (state !== "failed") return;
      await prisma.fetchJob.updateMany({
        where: { id: job.data.fetchJobId, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "FAILED",
          error: `队列任务最终失败：${error.message || "未知错误"}`.slice(0, 2000),
          completedAt: new Date()
        }
      });
    })().catch((reconcileError) => {
      console.error(`[worker] failed to reconcile terminal job ${job.id}:`, reconcileError);
    });
  });
}

// Docker healthcheck reads this heartbeat. A live Redis/Postgres container is
// insufficient when the worker event loop itself is stalled.
const WORKER_HEARTBEAT_PATH = "/tmp/shibei-worker-heartbeat";
const writeWorkerHeartbeat = () => {
  try {
    writeFileSync(WORKER_HEARTBEAT_PATH, String(Date.now()));
  } catch (error) {
    console.error("[worker] failed to write heartbeat:", error);
  }
};
writeWorkerHeartbeat();
const workerHeartbeatInterval = setInterval(writeWorkerHeartbeat, 30_000);

// Graceful shutdown: 给正在执行的 job 一个机会跑完,而不是被 SIGTERM 直接掐掉。
// BullMQ 的 worker.close() 会停接新 job、等待当前 job 结束再关闭连接。
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, draining workers...`);
  clearTimeout(cleanupBootTimer);
  clearInterval(cleanupInterval);
  clearTimeout(listI18nBootTimer);
  clearInterval(listI18nInterval);
  clearInterval(workerHeartbeatInterval);
  clearInterval(queueRecoveryInterval);
  await Promise.allSettled([
    fetchWorker.close(),
    researchWorker.close(),
    audienceWorker.close(),
    scheduleWorker.close(),
    videoDownloadWorker.close(),
  ]);
  console.log("[worker] all workers closed; exiting.");
  // 退出码 0 让 docker 把"被信号终止"理解为预期内的优雅退出。
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

bootstrapAllSchedules().catch((error) => {
  console.error("bootstrapAllSchedules failed:", error);
});

// Reconcile immediately after listeners are attached, then periodically. This
// covers both worker restarts and a Redis restart/flush while the worker stays
// alive; DB rows are never left QUEUED/RUNNING forever just because a queue key
// disappeared.
void tickQueueRecovery();
const queueRecoveryInterval = setInterval(() => { void tickQueueRecovery(); }, QUEUE_RECONCILE_INTERVAL_MS);
queueRecoveryInterval.unref();

// Periodic storage cleanup: every 6 hours, apply the administrator's retention
// rules only when cleanupCustomEnabled is on. Manual cleanup has a separate,
// explicitly confirmed route and does not depend on this switch.
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
async function tickCleanup() {
  try {
    const summary = await runStorageCleanup();
    if (summary.fetchJobsDeleted || summary.rawItemsDeleted || summary.archivedPosts || summary.videoFilesDeleted) {
      console.log("[storage] periodic cleanup:", summary);
    }
  } catch (error) {
    console.error("[storage] periodic cleanup failed:", error);
  }
}
// Kick off once on boot (delayed so DB is reachable), then every 6h.
// 句柄保留下来给 shutdown 用：否则 SIGTERM 时 timer 仍在 event loop 里挂着，
// 进程要等下一个 tick（最长 6h）才会退出。
const cleanupBootTimer = setTimeout(() => { void tickCleanup(); }, 60 * 1000);
const cleanupInterval = setInterval(() => { void tickCleanup(); }, CLEANUP_INTERVAL_MS);

// 列表英文回填：titleEn/summaryEn 原本只在访客打开详情页触发整篇翻译时才写入，
// 列表页英文模式因此长期回退中文。这里周期性小批量补齐标题+摘要（轻量、不翻正文，
// 正文仍由详情页按需翻译）。不占用公共翻译接口的每日预算，靠批次上限自我节流；
// 存量补完后每个周期查询命中 0 行，自然只剩新发布文章的增量。
const LIST_I18N_INTERVAL_MS = 10 * 60 * 1000;
function listI18nBatchSize() {
  const n = Number(process.env.LIST_TRANSLATION_BATCH ?? 6);
  if (!Number.isFinite(n)) return 6;
  return Math.min(Math.max(Math.floor(n), 0), 20); // 0 表示关闭
}
async function tickListTranslationBackfill() {
  try {
    const batchSize = listI18nBatchSize();
    if (!batchSize) return;
    const posts = await prisma.post.findMany({
      where: {
        status: "PUBLISHED",
        publicationBlockedReason: null,
        OR: [{ titleEn: null }, { summaryEn: null }]
      },
      orderBy: { publishedAt: "desc" },
      take: batchSize,
      select: { id: true, title: true, summary: true }
    });
    if (!posts.length) return;
    const modelConfig = await getModelConfigForUse("translation");
    if (!modelConfig) return;
    let done = 0;
    for (const post of posts) {
      try {
        const translated = await translateTitleSummaryToEnglish({
          modelConfig,
          title: post.title,
          summary: post.summary
        });
        await prisma.post.update({
          where: { id: post.id },
          data: { titleEn: translated.title, summaryEn: translated.summary }
        });
        done += 1;
      } catch (error) {
        console.error(`[i18n] list backfill failed for post ${post.id}:`, error);
        break; // 多半是模型端点故障，别再撞剩余批次，等下个周期
      }
    }
    if (done) console.log(`[i18n] backfilled list translations for ${done}/${posts.length} posts`);
  } catch (error) {
    console.error("[i18n] list translation backfill tick failed:", error);
  }
}
const listI18nBootTimer = setTimeout(() => { void tickListTranslationBackfill(); }, 90 * 1000);
const listI18nInterval = setInterval(() => { void tickListTranslationBackfill(); }, LIST_I18N_INTERVAL_MS);

console.log(`ShiBei worker started: ${fetchQueueName}, ${researchQueueName}, ${audienceQueueName}, ${scheduleQueueName}, ${videoDownloadQueueName}`);
