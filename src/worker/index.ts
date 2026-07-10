import { Worker, UnrecoverableError } from "bullmq";
import { CompilationKind } from "@prisma/client";
import {
  generateDigest,
  generateContentArticle,
  generateSummary,
  estimateAudience,
  translateTitleSummaryToEnglish,
  type EvidenceItem
} from "../lib/ai";
import {
  audienceQueueName,
  createRedisConnection,
  fetchQueueName,
  researchQueueName,
  scheduleQueueName,
  videoDownloadQueueName
} from "../lib/queue";
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
import { scrapeAudienceData } from "../lib/scrape-audience";
import { getModelConfigForUse } from "../lib/model-selection";
import { slugify } from "../lib/slug";
import { prisma } from "../lib/prisma";
import { enqueueTopicRun, parseTopicKeywords } from "../lib/auto-curation";
import { bootstrapAllSchedules } from "../lib/scheduler";
import {
  buildDigestFallback,
  buildResearchFallbackDraft,
  collectKeywordEvidence,
  normalizeEvidenceUrl,
  rotateEvidence
} from "./evidence";
import {
  assertPublishableGeneratedArticle,
  assertUsableSourceMaterial,
  InvalidSourceMaterialError,
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

function workerConcurrency(envName: string, fallback = 1) {
  const n = Number(process.env[envName] || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 4);
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

// ── 共享辅助 ──────────────────────────────────────────────

/**
 * 从 fetchJob 的关联配置或全局默认加载 model + style。
 * 三条流程(summarize / keyword-research / digest)都执行相同的查询逻辑。
 */
async function loadModelAndStyle(fetchJob: { modelConfigId: string | null; contentStyleId: string | null }) {
  const [modelConfig, style] = await Promise.all([
    fetchJob.modelConfigId
      ? prisma.modelConfig.findUnique({ where: { id: fetchJob.modelConfigId } })
      : getModelConfigForUse("content"),
    fetchJob.contentStyleId
      ? prisma.contentStyle.findUnique({ where: { id: fetchJob.contentStyleId } })
      : prisma.contentStyle.findFirst({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] })
  ]);
  return { modelConfig, style };
}

async function createDraftFromRawItem(rawItemId: string, generated: string) {
  const rawItem = await prisma.rawItem.findUniqueOrThrow({
    where: { id: rawItemId },
    include: { fetchJob: true }
  });
  const parsed = extractTitleAndSummary(generated, rawItem.title);
  const slugBase = slugify(`${parsed.title}-${rawItem.id}`);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const publication = await getPublicationData();
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

  return prisma.post.create({
    data: {
      slug,
      title: parsed.title,
      summary: parsed.summary,
      content: generated,
      status: publication.status,
      publishedAt: publication.publishedAt,
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

async function createDraftFromResearch(fetchJobId: string, keyword: string, scopeLabel: string, evidence: EvidenceItem[], generated: string, index?: number) {
  const parsed = extractTitleAndSummary(generated, keyword);
  const slugBase = slugify(`${parsed.title}-${fetchJobId}`);
  const slug = `${slugBase}-${Date.now().toString(36)}${index ? `-${index}` : ""}`;
  const sourceUrl = `keyword://${encodeURIComponent(keyword)}`;
  const publication = await getPublicationData();
  const fetchJob = await prisma.fetchJob.findUnique({ where: { id: fetchJobId } });
  const topicLink = await resolveTopicLink(fetchJob?.contentTopicId);
  const markdown = [
    `# ${keyword}`,
    "",
    `范围：${scopeLabel}`,
    "",
    "## 研究资料",
    ...evidence.map((item, index) => [
      `${index + 1}. [${item.title}](${item.url})`,
      `   - 来源：${item.sourceName}`,
      item.publishedAt ? `   - 时间：${item.publishedAt.toISOString()}` : null,
      `   - 摘录：${item.summary.slice(0, 500)}`
    ].filter(Boolean).join("\n"))
  ].join("\n");

  const rawItem = await prisma.rawItem.create({
    data: {
      title: `关键词研究：${keyword}`,
      url: sourceUrl,
      content: evidence.map((item) => `${item.title}\n${item.summary}`).join("\n\n"),
      markdown,
      fetchJobId
    }
  });

  return prisma.post.create({
    data: {
      slug,
      title: parsed.title,
      summary: parsed.summary,
      content: generated,
      status: publication.status,
      publishedAt: publication.publishedAt,
      sourceUrl,
      rawItemId: rawItem.id,
      kind: topicLink.kind,
      ...(topicLink.connect ? { topics: { connect: { id: topicLink.connect } } } : {})
    }
  });
}

async function resolveTopicLink(topicId: string | null | undefined): Promise<{ connect: string | null; kind: CompilationKind }> {
  if (!topicId) return { connect: null, kind: "SINGLE_ARTICLE" };
  const topic = await prisma.contentTopic.findUnique({ where: { id: topicId } });
  if (!topic) return { connect: null, kind: "SINGLE_ARTICLE" };
  return { connect: topic.id, kind: topic.compileKind };
}

async function getPublicationData() {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const autoPublish = settings?.autoPublish ?? false;
  return {
    status: autoPublish ? "PUBLISHED" as const : "DRAFT" as const,
    publishedAt: autoPublish ? new Date() : null
  };
}

async function processWeb(fetchJobId: string) {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const textOnly = (settings as { textOnlyMode?: boolean } | null)?.textOnlyMode === true;

  const result = await scrapeWebPage(fetchJob.sourceUrl);
  const sourcePageUrl = result.finalUrl || fetchJob.sourceUrl;
  assertUsableSourceMaterial({
    title: result.title,
    content: result.content,
    markdown: result.markdown
  });
  const rawItem = await prisma.rawItem.create({
    data: {
      title: result.title,
      url: sourcePageUrl,
      content: result.content,
      markdown: result.markdown,
      sourceId: fetchJob.sourceId,
      fetchJobId: fetchJob.id
    }
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
    for (const image of entry.result.images) {
      if (!image.src) continue;
      // query/hash 会被规范化，避免同一张图片被多个追踪 URL 重复挂载。
      const canonical = canonicalizeArticleImageUrl(image.src);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      images.push({ ...image, sourcePageUrl, sourceTitle: entry.sourceTitle });
      if (images.length >= 30) break;
    }
  }

  await embedArticleImagesInPostContent(postId, images);
}

function sourcePlatformForVideo(videoUrl: string, sourcePageUrl?: string | null): string | null {
  if (sourcePageUrl && isVideoMediaUrl(videoUrl) && isDomesticVideoUrl(sourcePageUrl)) {
    return hostFromUrl(sourcePageUrl) || hostFromUrl(videoUrl);
  }
  return hostFromUrl(videoUrl);
}

async function processRss(fetchJobId: string) {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } });
  const items = await fetchRss(fetchJob.sourceUrl);
  const usableItems = items.filter((item) =>
    isUsableSourceMaterial({
      title: item.title,
      content: item.summary
    })
  );
  if (!usableItems.length) {
    throw new InvalidSourceMaterialError("RSS 源没有可用条目：疑似错误页、访问受限内容或空内容");
  }

  for (const item of usableItems.slice(0, 3)) {
    const rawItem = await prisma.rawItem.create({
      data: {
        title: item.title,
        url: item.link,
        content: item.summary,
        markdown: `# ${item.title}\n\n${item.summary}\n\n来源：${item.link}`,
        sourceId: fetchJob.sourceId,
        fetchJobId: fetchJob.id,
        publishedAt: item.date
      }
    });
    await summarizeRawItem(rawItem.id, fetchJob.id);
  }
}

async function processVideo(fetchJobId: string) {
  const fetchJob = await prisma.fetchJob.findUniqueOrThrow({
    where: { id: fetchJobId },
    include: { source: true }
  });
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const textOnly = (settings as { textOnlyMode?: boolean } | null)?.textOnlyMode === true;
  const title = fetchJob.source?.name || "视频资源";
  const originalUrl = fetchJob.sourceUrl;
  const summary = "管理员添加的视频资源。";
  const rawItem = await prisma.rawItem.create({
    data: {
      title,
      url: originalUrl,
      content: `${title}\n${originalUrl}`,
      markdown: `# ${title}\n\n视频来源：${originalUrl}`,
      sourceId: fetchJob.sourceId,
      fetchJobId: fetchJob.id
    }
  });

  const publication = await getPublicationData();
  const topicLink = await resolveTopicLink(fetchJob.contentTopicId);
  const slugBase = slugify(`${title}-${fetchJob.id}`);
  const post = await prisma.post.create({
    data: {
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

  const video = await prisma.video.create({
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
  const evidence = await collectKeywordEvidence(keyword, scope, { topicId: fetchJob.contentTopicId });

  if (!evidence.length) {
    await createDraftFromResearch(
      fetchJob.id,
      keyword,
      scopeLabel,
      [],
      `# ${keyword}\n\n没有搜索到足够资料，暂时无法形成文章草稿。请换一个更具体的关键词，或检查信息源是否可访问。`
    );
    return;
  }

  if (!modelConfig || !style) {
    for (let index = 1; index <= count; index++) {
      await createDraftFromResearch(
        fetchJob.id,
        keyword,
        scopeLabel,
        evidence,
        `# ${count > 1 ? `${keyword}（第 ${index} 篇）` : keyword}\n\n> 未配置模型或内容风格，已保留关键词研究资料作为草稿。\n\n${evidence.map((item) => `- [${item.title}](${item.url})：${item.summary}`).join("\n")}`,
        index
      );
    }
    return;
  }

  for (let index = 1; index <= count; index++) {
    let generated: string;
    try {
      generated = await generateContentArticle({
        modelConfig,
        style,
        keyword,
        scopeLabel,
        articleIndex: index,
        articleCount: count,
        depth,
        evidence: rotateEvidence(evidence, index - 1)
      });
      assertPublishableGeneratedArticle(generated);
    } catch (error) {
      generated = buildResearchFallbackDraft(keyword, scopeLabel, rotateEvidence(evidence, index - 1), error, index, count, depth);
    }

    const post = await createDraftFromResearch(fetchJob.id, keyword, scopeLabel, evidence, generated, index);
    await attachImagesFromEvidence(post.id, evidence);
    await attachVideosFromEvidence(post.id, evidence, `关键词「${keyword}」`);
  }
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

  assertUsableSourceMaterial({
    title: rawItem.title,
    content: rawItem.content,
    markdown: rawItem.markdown
  });

  if (!modelConfig || !style) {
    return createDraftFromRawItem(rawItem.id, `# ${rawItem.title}\n\n${rawItem.markdown}\n\n> 未配置模型或内容风格，已保留原始内容作为草稿。`);
  }

  const generated = await generateSummary({
    modelConfig,
    style,
    item: {
      title: rawItem.title,
      url: rawItem.url,
      markdown: rawItem.markdown
    }
  });
  assertPublishableGeneratedArticle(generated);

  return createDraftFromRawItem(rawItem.id, generated);
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
async function attachVideosFromEvidence(postId: string, evidence: EvidenceItem[], contextLabel: string) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if ((settings as { textOnlyMode?: boolean } | null)?.textOnlyMode === true) return;
  if (!videosFeatureEnabled(settings)) return;
  const picks = await collectEvidenceVideoPicks(evidence, 6);
  if (!picks.length) return;

  const createdIds: string[] = [];
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

  if (createdIds.length) {
    await embedVideosInPostContent(postId, createdIds);
  }
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
  const { modelConfig, style } = await loadModelAndStyle(fetchJob);

  const scope = isResearchScope(topic.scope) ? topic.scope : "all";
  const scopeLabel = researchScopeLabel(scope);
  const windowMs = digestWindowMs(digestKind);
  const windowStart = new Date(Date.now() - windowMs);
  const windowLabel = digestWindowLabel(digestKind);
  const keywords = parseTopicKeywords(topic.keywords);

  const seen = new Set<string>();
  const allEvidence: EvidenceItem[] = [];

  for (const keyword of keywords) {
    if (allEvidence.length >= 16) break;
    const items = await collectKeywordEvidence(keyword, scope, { topicId: topic.id });
    for (const item of items) {
      if (allEvidence.length >= 16) break;
      const key = normalizeEvidenceUrl(item.url);
      if (seen.has(key)) continue;
      // When publishedAt is known, drop entries outside the window. Items without dates are kept.
      if (item.publishedAt && item.publishedAt < windowStart) continue;
      seen.add(key);
      allEvidence.push(item);
    }
  }

  const formatLabel = digestKind === "WEEKLY_ROUNDUP" ? "周报综述" : "每日要闻";
  const fallbackTitle = `${topic.name} · ${formatLabel}`;

  if (!allEvidence.length) {
    const fallback = `# ${fallbackTitle}\n\n> ${windowLabel}内未抓到足够${topic.name}主题资料，本期暂无内容。可调整关键词或来源后再试。`;
    await createDraftFromDigest(fetchJob.id, topic.id, digestKind, fallbackTitle, [], fallback, windowLabel, scopeLabel);
    return;
  }

  let generated: string;
  if (modelConfig && style) {
    try {
      generated = await generateDigest({
        modelConfig,
        style,
        topicName: topic.name,
        scopeLabel,
        windowLabel,
        digestKind,
        evidence: allEvidence
      });
      assertPublishableGeneratedArticle(generated);
    } catch (error) {
      generated = buildDigestFallback(topic.name, formatLabel, windowLabel, scopeLabel, allEvidence, error);
    }
  } else {
    generated = buildDigestFallback(topic.name, formatLabel, windowLabel, scopeLabel, allEvidence, new Error("未配置模型或内容风格"));
  }

  const post = await createDraftFromDigest(fetchJob.id, topic.id, digestKind, fallbackTitle, allEvidence, generated, windowLabel, scopeLabel);
  await attachImagesFromEvidence(post.id, allEvidence);
  await attachVideosFromEvidence(post.id, allEvidence, `${topic.name} ${windowLabel}`);
}

async function createDraftFromDigest(
  fetchJobId: string,
  topicId: string,
  digestKind: CompilationKind,
  fallbackTitle: string,
  evidence: EvidenceItem[],
  generated: string,
  windowLabel: string,
  scopeLabel: string
) {
  const parsed = extractTitleAndSummary(generated, fallbackTitle);
  const slugBase = slugify(`${parsed.title}-${fetchJobId}`);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const sourceUrl = `digest://topic?topicId=${encodeURIComponent(topicId)}&kind=${encodeURIComponent(digestKind)}`;
  const publication = await getPublicationData();
  const markdown = [
    `# ${fallbackTitle}`,
    "",
    `范围：${scopeLabel} · 时段：${windowLabel}`,
    "",
    "## 本期资料",
    ...evidence.map((item, index) => [
      `${index + 1}. [${item.title}](${item.url})`,
      `   - 来源：${item.sourceName}`,
      item.publishedAt ? `   - 时间：${item.publishedAt.toISOString()}` : null,
      `   - 摘录：${item.summary.slice(0, 500)}`
    ].filter(Boolean).join("\n"))
  ].join("\n");

  const rawItem = await prisma.rawItem.create({
    data: {
      title: fallbackTitle,
      url: sourceUrl,
      content: evidence.map((item) => `${item.title}\n${item.summary}`).join("\n\n") || "（本期无证据）",
      markdown,
      fetchJobId
    }
  });

  return prisma.post.create({
    data: {
      slug,
      title: parsed.title,
      summary: parsed.summary,
      content: generated,
      status: publication.status,
      publishedAt: publication.publishedAt,
      sourceUrl,
      rawItemId: rawItem.id,
      kind: digestKind,
      topics: { connect: { id: topicId } }
    }
  });
}

// 连续失败达到此阈值即自动 PAUSED；成功一次清零。
const SOURCE_FAIL_PAUSE_THRESHOLD = 5;

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
  const fetchJob = await prisma.fetchJob.update({
    where: { id: fetchJobId },
    data: { status: "RUNNING", error: null }
  });

  // 只有真正抓取来源内容的任务（RSS/VIDEO/WEB）才计入来源健康。知名度估算
  // （audience://estimate?sourceId=…）、关键词研究、摘要聚合这些特殊 URL 任务即便
  // 带 sourceId，其失败也与"来源能否抓取正文"无关，不能累加 failStreak 把健康来源
  // 误暂停。用前缀判断而非完整解析，避免解析在 try 外抛错绕过下面的失败处理。
  const isSpecialJob = /^(?:keyword:\/\/research|audience:\/\/estimate|digest:\/\/topic)/.test(fetchJob.sourceUrl);
  const healthSourceId = isSpecialJob ? null : fetchJob.sourceId;

  try {
    const keywordResearch = parseKeywordResearchUrl(fetchJob.sourceUrl);
    const audienceJob = parseAudienceEstimateUrl(fetchJob.sourceUrl);
    const digestJob = parseDigestUrl(fetchJob.sourceUrl);
    if (audienceJob) {
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

    await prisma.fetchJob.update({
      where: { id: fetchJob.id },
      data: { status: "COMPLETED", completedAt: new Date() }
    });
    await recordSourceSuccess(healthSourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 来源本身是错误页 → 永久失败，不重试。
    const permanent = error instanceof InvalidSourceMaterialError;
    // BullMQ v5：处理中 attemptsMade 为 0-based，本次是第 attempt 次。
    const attempt = (job.attemptsMade ?? 0) + 1;
    const totalAttempts = job.opts?.attempts ?? 1;
    const willRetry = !permanent && attempt < totalAttempts;

    if (willRetry) {
      // 瞬时故障且还有重试机会：状态回到 QUEUED，标注第几次失败；
      // 中途失败不计入来源健康——只有最终失败才累加 failStreak。
      await prisma.fetchJob.update({
        where: { id: fetchJob.id },
        data: { status: "QUEUED", error: `第 ${attempt}/${totalAttempts} 次尝试失败，将自动重试：${message}` }
      });
      throw error; // 交回 BullMQ 按 backoff 重排
    }

    // 最终失败（永久失败，或已用尽重试）。
    await prisma.fetchJob.update({
      where: { id: fetchJob.id },
      data: { status: "FAILED", error: message }
    });
    await recordSourceFailure(healthSourceId);

    // 永久失败包成 UnrecoverableError，让 BullMQ 跳过剩余重试。
    if (permanent) throw new UnrecoverableError(message);
    throw error;
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

for (const worker of [fetchWorker, researchWorker, audienceWorker, scheduleWorker, videoDownloadWorker]) {
  worker.on("completed", (job) => {
    console.log(`Completed job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed job ${job?.id}:`, error);
  });
}

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

// Periodic storage cleanup: every 6 hours, prune expired FetchJobs / RawItems
// and archive over-quota posts. Idempotent, safe to run alongside fetches.
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
      where: { status: "PUBLISHED", OR: [{ titleEn: null }, { summaryEn: null }] },
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
