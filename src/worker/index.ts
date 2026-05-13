import { Worker } from "bullmq";
import { CompilationKind, Source, VideoType } from "@prisma/client";
import {
  generateDigest,
  generateNewsArticle,
  generateSummary,
  estimateAudience,
  type EvidenceItem
} from "../lib/ai";
import {
  audienceQueueName,
  createRedisConnection,
  fetchQueueName,
  researchQueueName,
  scheduleQueueName
} from "../lib/queue";
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
import { searchWithExa } from "../lib/exa";
import {
  downloadVideoByPolicy,
  isDomesticVideoCandidate,
  isDomesticVideoUrl,
  isVideoMediaUrl,
  parseInternationalHostKeys,
  shouldDownloadVideo,
  type VideoDownloadPolicy
} from "../lib/video-downloader";
import { selectVideoLinksForPost } from "../lib/video-candidates";
import { runStorageCleanup } from "../lib/storage";

function workerConcurrency(envName: string, fallback = 1) {
  const n = Number(process.env[envName] || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 4);
}

type FetchJobData = {
  fetchJobId: string;
};

type ScrapedImage = {
  src: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
};

type ScheduleJobData = {
  topicId: string;
};

// ── 共享辅助 ──────────────────────────────────────────────

/**
 * 从 fetchJob 的关联配置或全局默认加载 model + style。
 * 三条流程(summarize / keyword-research / digest)都执行相同的查询逻辑。
 */
async function loadModelAndStyle(fetchJob: { modelConfigId: string | null; summaryStyleId: string | null }) {
  const [modelConfig, style] = await Promise.all([
    fetchJob.modelConfigId
      ? prisma.modelConfig.findUnique({ where: { id: fetchJob.modelConfigId } })
      : getModelConfigForUse("news"),
    fetchJob.summaryStyleId
      ? prisma.summaryStyle.findUnique({ where: { id: fetchJob.summaryStyleId } })
      : prisma.summaryStyle.findFirst({ where: { isDefault: true } })
  ]);
  return { modelConfig, style };
}

/** 封装 prisma.video.create 的类型断言，避免在多处重复 `as unknown as ...` 体操 */
async function createVideoRecord(data: Record<string, unknown>): Promise<{ id: string }> {
  return (prisma as unknown as {
    video: { create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }> };
  }).video.create({ data });
}

function extractTitleAndSummary(markdown: string, fallbackTitle: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackTitle;
  const plain = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/[-*]\s+/g, "")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: title.slice(0, 120),
    summary: plain.slice(0, 220) || "AI 已生成草稿，请管理员审核。"
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const topicLink = await resolveTopicLink(rawItem.fetchJob?.newsTopicId);

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
      ...(topicLink.connect ? { topics: { connect: { id: topicLink.connect } } } : {})
    }
  });
}

async function createDraftFromResearch(fetchJobId: string, keyword: string, scopeLabel: string, evidence: EvidenceItem[], generated: string, index?: number) {
  const parsed = extractTitleAndSummary(generated, keyword);
  const slugBase = slugify(`${parsed.title}-${fetchJobId}`);
  const slug = `${slugBase}-${Date.now().toString(36)}${index ? `-${index}` : ""}`;
  const sourceUrl = `keyword://${encodeURIComponent(keyword)}`;
  const publication = await getPublicationData();
  const fetchJob = await prisma.fetchJob.findUnique({ where: { id: fetchJobId } });
  const topicLink = await resolveTopicLink(fetchJob?.newsTopicId);
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
  const topic = await prisma.newsTopic.findUnique({ where: { id: topicId } });
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
  const videoMaxSec = clampVideoDuration((settings as { videoMaxDurationSec?: number } | null)?.videoMaxDurationSec);
  const policy = videoPolicyFromSettings(settings);
  const maxPerPost = clampVideoMaxPerPost((settings as { videoMaxPerPost?: number } | null)?.videoMaxPerPost);

  const result = await scrapeWebPage(fetchJob.sourceUrl);
  const sourcePageUrl = result.finalUrl || fetchJob.sourceUrl;
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
  await embedImagesInPostContent(post.id, result.images || [], sourcePageUrl);

  if (textOnly) {
    // pure-text mode: skip video collection entirely.
    return;
  }

  let downloadedForThisPost = 0;
  const createdVideoIds: string[] = [];

  for (const link of selectVideoLinksForPost(result.videos, 4)) {
    const url = link.href;
    const region = isDomesticVideoCandidate(url, sourcePageUrl) ? "DOMESTIC" : "INTERNATIONAL";
    const type = detectVideoType(url);
    const baseData: Record<string, unknown> = {
      title: link.text || "相关视频资源",
      type,
      url: normalizeEmbedUrl(url),
      summary: "从来源页面自动识别到的视频资源。",
      postId: post.id,
      region,
      sourcePageUrl,
      sourcePlatform: sourcePlatformForVideo(url, sourcePageUrl)
    };

    let attribution = `来源页：${sourcePageUrl}\n原视频：${url}`;

    const shouldDownload =
      downloadedForThisPost < maxPerPost &&
      shouldDownloadVideo(url, sourcePageUrl, policy);

    if (shouldDownload) {
      const dl = await downloadVideoByPolicy(url, policy, {
        maxDurationSec: videoMaxSec,
        referer: sourcePageUrl
      }).catch((err) => {
        console.error(`[video-download] failed ${url}:`, err);
        return null;
      });
      if (dl?.localPath) {
        baseData.type = "LOCAL";
        baseData.url = dl.localPath;
        baseData.localPath = dl.localPath;
        baseData.fileSizeBytes = dl.fileSizeBytes;
        baseData.durationSec = dl.durationSec;
        attribution = `本地下载视频，原始来源：\n - 来源页：${sourcePageUrl}\n - 原视频链接：${url}\n - 平台：${baseData.sourcePlatform || "未知"}\n仅用于内部存档与方便国内访问，所有版权归原作者所有。`;
        downloadedForThisPost += 1;
      } else if (type === "LOCAL") {
        baseData.type = "LINK";
      }
    }

    baseData.attribution = attribution;

    const created = await createVideoRecord(baseData);
    createdVideoIds.push(created.id);
  }

  if (createdVideoIds.length) {
    await embedVideosInPostContent(post.id, createdVideoIds);
  }
}

function clampVideoDuration(value: number | undefined | null) {
  if (!value || !Number.isFinite(value)) return 1200;
  return Math.min(Math.max(Math.floor(value), 30), 1200);
}

function clampVideoMaxPerPost(value: number | undefined | null) {
  if (!value || !Number.isFinite(value)) return 4;
  return Math.min(Math.max(Math.floor(value), 0), 4);
}

function videoPolicyFromSettings(settings: unknown): VideoDownloadPolicy {
  const s = (settings || {}) as {
    videoDownloadDomestic?: boolean;
    videoDownloadHosts?: string | null;
  };
  return {
    domestic: s.videoDownloadDomestic !== false,
    internationalHostKeys: parseInternationalHostKeys(s.videoDownloadHosts)
  };
}

/**
 * 把 [[video:ID]] 短代码追加到 post.content（以及英文翻译，如果已生成）末尾。
 * 渲染层（news/[slug]/page.tsx + markdown.ts）会把短代码替换为播放器，并把
 * 已内嵌的视频从文末"相关视频"列表里去重，因此追加不会造成重复展示。
 */
async function embedVideosInPostContent(postId: string, videoIds: string[]) {
  if (!videoIds.length) return;
  const post = await prisma.post
    .findUnique({ where: { id: postId }, select: { content: true } })
    .catch(() => null);
  if (!post) return;
  const block = videoIds.map((id) => `[[video:${id}]]`).join("\n\n");
  const sep = post.content.endsWith("\n") ? "\n" : "\n\n";
  const nextContent = `${post.content}${sep}${block}\n`;

  const existingEn = await (prisma as unknown as {
    post: { findUnique: (args: unknown) => Promise<{ contentEn: string | null } | null> };
  }).post.findUnique({ where: { id: postId }, select: { contentEn: true } }).catch(() => null);
  const nextContentEn = existingEn?.contentEn
    ? `${existingEn.contentEn}${existingEn.contentEn.endsWith("\n") ? "\n" : "\n\n"}${block}\n`
    : null;

  await (prisma as unknown as {
    post: { update: (args: unknown) => Promise<unknown> };
  }).post.update({
    where: { id: postId },
    data: nextContentEn ? { content: nextContent, contentEn: nextContentEn } : { content: nextContent }
  }).catch((err) => {
    console.error(`[video-embed] failed to inline shortcodes for post ${postId}:`, err);
  });
}

async function embedImagesInPostContent(postId: string, images: ScrapedImage[], sourcePageUrl: string) {
  const picked = selectArticleImages(images, 3);
  if (!picked.length) return;

  const existing = await (prisma as unknown as {
    post: { findUnique: (args: unknown) => Promise<{ content: string; contentEn: string | null } | null> };
  }).post.findUnique({ where: { id: postId }, select: { content: true, contentEn: true } }).catch(() => null);
  if (!existing) return;

  const figures = picked
    .filter((image) => !existing.content.includes(image.src) && !(existing.contentEn || "").includes(image.src))
    .map((image) => articleImageFigureHtml(image, sourcePageUrl))
    .filter(Boolean);
  if (!figures.length) return;

  const block = figures.join("\n\n");
  const append = (content: string) => `${content}${content.endsWith("\n") ? "\n" : "\n\n"}${block}\n`;

  await (prisma as unknown as {
    post: { update: (args: unknown) => Promise<unknown> };
  }).post.update({
    where: { id: postId },
    data: existing.contentEn
      ? { content: append(existing.content), contentEn: append(existing.contentEn) }
      : { content: append(existing.content) }
  }).catch((err) => {
    console.error(`[image-embed] failed to inline images for post ${postId}:`, err);
  });
}

function selectArticleImages(images: ScrapedImage[], limit: number): ScrapedImage[] {
  const seen = new Set<string>();
  const out: ScrapedImage[] = [];
  for (const image of images) {
    if (!image?.src || seen.has(image.src) || !/^https?:\/\//i.test(image.src)) continue;
    seen.add(image.src);
    out.push(image);
    if (out.length >= limit) break;
  }
  return out;
}

function articleImageFigureHtml(image: ScrapedImage, sourcePageUrl: string) {
  const caption = image.alt?.trim() || "原文配图";
  const sourceHost = hostFromUrl(sourcePageUrl) || "原文";
  return [
    `<figure class="article-media article-image">`,
    `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(caption)}" loading="lazy" decoding="async">`,
    `<figcaption><span>${escapeHtml(caption)}</span><a href="${escapeHtml(sourcePageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceHost)}</a></figcaption>`,
    `</figure>`
  ].join("");
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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

  for (const item of items.slice(0, 3)) {
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
  const videoMaxSec = clampVideoDuration((settings as { videoMaxDurationSec?: number } | null)?.videoMaxDurationSec);
  const policy = textOnly
    ? { domestic: false, internationalHostKeys: [] as string[] }
    : videoPolicyFromSettings(settings);
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
  const topicLink = await resolveTopicLink(fetchJob.newsTopicId);
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

  const type = detectVideoType(originalUrl);
  const region = isDomesticVideoCandidate(originalUrl, originalUrl) ? "DOMESTIC" : "INTERNATIONAL";
  const baseData: Record<string, unknown> = {
    title,
    type,
    url: normalizeEmbedUrl(originalUrl),
    summary,
    postId: post.id,
    region,
    sourcePageUrl: originalUrl,
    sourcePlatform: sourcePlatformForVideo(originalUrl, originalUrl),
    attribution: `来源页：${originalUrl}\n原视频：${originalUrl}`
  };

  if (shouldDownloadVideo(originalUrl, originalUrl, policy)) {
    const dl = await downloadVideoByPolicy(originalUrl, policy, {
      maxDurationSec: videoMaxSec,
      referer: originalUrl
    }).catch((err) => {
      console.error(`[video-download] failed ${originalUrl}:`, err);
      return null;
    });

    if (dl?.localPath) {
      baseData.type = "LOCAL";
      baseData.url = dl.localPath;
      baseData.localPath = dl.localPath;
      baseData.fileSizeBytes = dl.fileSizeBytes;
      baseData.durationSec = dl.durationSec;
      baseData.attribution = `本地下载视频，原始来源：\n - 来源页：${originalUrl}\n - 原视频链接：${originalUrl}\n - 平台：${baseData.sourcePlatform || "未知"}\n仅用于内部存档与方便国内访问，所有版权归原作者所有。`;
    } else if (type === "LOCAL") {
      baseData.type = "LINK";
    }
  }

  const video = await createVideoRecord(baseData);
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
  const evidence = await collectKeywordEvidence(keyword, scope, { topicId: fetchJob.newsTopicId });

  if (!evidence.length) {
    await createDraftFromResearch(
      fetchJob.id,
      keyword,
      scopeLabel,
      [],
      `# ${keyword}\n\n没有搜索到足够资料，暂时无法形成新闻稿。请换一个更具体的关键词，或检查信息源是否可访问。`
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
        `# ${count > 1 ? `${keyword}（第 ${index} 篇）` : keyword}\n\n> 未配置模型或总结风格，已保留关键词研究资料作为草稿。\n\n${evidence.map((item) => `- [${item.title}](${item.url})：${item.summary}`).join("\n")}`,
        index
      );
    }
    return;
  }

  for (let index = 1; index <= count; index++) {
    let generated: string;
    try {
      generated = await generateNewsArticle({
        modelConfig,
        style,
        keyword,
        scopeLabel,
        articleIndex: index,
        articleCount: count,
        depth,
        evidence: rotateEvidence(evidence, index - 1)
      });
    } catch (error) {
      generated = buildResearchFallbackDraft(keyword, scopeLabel, rotateEvidence(evidence, index - 1), error, index, count, depth);
    }

    const post = await createDraftFromResearch(fetchJob.id, keyword, scopeLabel, evidence, generated, index);
    await attachVideosFromEvidence(post.id, evidence, `关键词「${keyword}」`);
  }
}

async function collectKeywordEvidence(keyword: string, scope: ResearchScope, opts?: { topicId?: string | null }) {
  const [savedEvidence, searchEvidence, exaEvidence] = await Promise.all([
    collectFromSavedSources(keyword, scope, opts),
    collectFromSearchFeeds(keyword, scope),
    collectFromExa(keyword, scope)
  ]);
  const seen = new Set<string>();
  const evidence: EvidenceItem[] = [];

  for (const item of [...savedEvidence, ...exaEvidence, ...searchEvidence]) {
    const key = normalizeEvidenceUrl(item.url);
    if (!item.url || seen.has(key)) continue;
    seen.add(key);
    evidence.push(item);
    if (evidence.length >= 14) break;
  }

  return evidence;
}

async function collectFromExa(keyword: string, scope: ResearchScope) {
  try {
    const results = await searchWithExa(keyword, {
      numResults: 8,
      domesticOnly: scope === "domestic",
      internationalOnly: scope === "international"
    });
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      sourceName: r.sourceName ? `[Exa] ${r.sourceName}` : "[Exa]",
      summary: r.text || r.title,
      publishedAt: r.publishedDate
    }));
  } catch (error) {
    console.error("[exa] collect failed:", error);
    return [];
  }
}

async function collectFromSavedSources(keyword: string, scope: ResearchScope, opts?: { topicId?: string | null }) {
  const where: Record<string, unknown> = { status: "ACTIVE", type: "RSS" };
  if (scope !== "all") {
    where.OR = [
      { region: scope === "domestic" ? "DOMESTIC" : "INTERNATIONAL" },
      { name: { startsWith: scope === "domestic" ? "[国内]" : "[国外]" } }
    ];
  }
  if (opts?.topicId) {
    // Restrict to sources tied to any module that the topic also belongs to.
    const topic = await prisma.newsTopic.findUnique({
      where: { id: opts.topicId },
      include: { modules: { select: { id: true } } } as never
    });
    const moduleIds = ((topic as unknown as { modules?: Array<{ id: string }> })?.modules || []).map((m) => m.id);
    if (moduleIds.length) {
      where.modules = { some: { id: { in: moduleIds } } };
    }
  }

  const sources = await prisma.source.findMany({
    where: where as never,
    orderBy: { updatedAt: "desc" },
    take: 12
  });
  const evidence: EvidenceItem[] = [];

  for (const source of sources) {
    const items = await safeFetchSourceItems(source);
    for (const item of items) {
      if (!matchesKeyword(keyword, `${item.title}\n${item.summary}`)) continue;
      evidence.push({
        title: item.title,
        url: item.link,
        sourceName: source.name,
        summary: item.summary || item.title,
        publishedAt: item.date
      });
      if (evidence.length >= 8) return evidence;
    }
  }

  return evidence;
}

async function collectFromSearchFeeds(keyword: string, scope: ResearchScope) {
  const feeds = buildSearchFeeds(keyword, scope);
  const evidence: EvidenceItem[] = [];

  for (const feed of feeds) {
    try {
      const items = await fetchRss(feed.url);
      for (const item of items.slice(0, 6)) {
        evidence.push({
          title: item.title,
          url: item.link,
          sourceName: feed.name,
          summary: item.summary || item.title,
          publishedAt: item.date
        });
        if (evidence.length >= 10) return evidence;
      }
    } catch (error) {
      console.error(`Search feed failed ${feed.url}:`, error);
    }
  }

  return evidence;
}

async function safeFetchSourceItems(source: Source) {
  try {
    return await fetchRss(source.url);
  } catch (error) {
    console.error(`Source RSS failed ${source.name}:`, error);
    return [];
  }
}

function buildSearchFeeds(keyword: string, scope: ResearchScope) {
  const domesticSites = ["news.cn", "people.com.cn", "cctv.com", "thepaper.cn", "caixin.com"];
  const internationalSites = ["bbc.com", "reuters.com", "apnews.com", "theguardian.com", "npr.org", "theverge.com"];
  const queries = [keyword, `${keyword} when:14d`];
  const feeds = [];

  if (scope !== "international") {
    for (const query of queries) {
      feeds.push({
        name: "[搜索] Google News 中文",
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
      });
    }
    for (const site of domesticSites) {
      feeds.push({
        name: `[搜索] ${site}`,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${keyword} site:${site}`)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
      });
    }
  }

  if (scope !== "domestic") {
    for (const query of queries) {
      feeds.push({
        name: "[搜索] Google News Global",
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
      });
    }
    for (const site of internationalSites) {
      feeds.push({
        name: `[搜索] ${site}`,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${keyword} site:${site}`)}&hl=en-US&gl=US&ceid=US:en`
      });
    }
  }

  return feeds;
}

function buildResearchFallbackDraft(keyword: string, scopeLabel: string, evidence: EvidenceItem[], error: unknown, index = 1, count = 1, depth: ResearchDepth = "long") {
  const reason = error instanceof Error ? error.message : String(error);
  const cleaned = evidence.slice(0, 10).map((item) => ({
    ...item,
    summary: cleanSummary(item.summary)
  }));
  return [
    `# ${count > 1 ? `${keyword}（第 ${index} 篇）` : keyword}`,
    "",
    `> AI 新闻写作请求未完成：${reason}。系统保留了本次关键词研究的原始资料，管理员可基于这些事实线索手动改写为正式报道。`,
    "",
    `报道范围：${scopeLabel}　计划篇数：${count}　报道长度：${depth}`,
    "",
    "## 已收集的事实线索",
    "",
    ...cleaned.map((item, i) => formatEvidenceBlock(i + 1, item)),
    "",
    "## 参考来源",
    ...cleaned.map((item) => `- [${item.sourceName}｜${item.title}](${item.url})`)
  ].join("\n");
}

function rotateEvidence(evidence: EvidenceItem[], offset: number) {
  if (!evidence.length) return evidence;
  const start = offset % evidence.length;
  return [...evidence.slice(start), ...evidence.slice(0, start)];
}

function matchesKeyword(keyword: string, text: string) {
  const normalizedText = text.toLowerCase();
  const terms = keyword.toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  if (!terms.length) return false;
  return terms.some((term) => normalizedText.includes(term));
}

function normalizeEvidenceUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
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

  if (!modelConfig || !style) {
    return createDraftFromRawItem(rawItem.id, `# ${rawItem.title}\n\n${rawItem.markdown}\n\n> 未配置模型或总结风格，已保留原始内容作为草稿。`);
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

  return createDraftFromRawItem(rawItem.id, generated);
}

function detectVideoType(url: string): VideoType {
  if (/\.mp4($|\?)/i.test(url)) return "LOCAL";
  if (/youtube|youtu\.be|bilibili|vimeo/i.test(url)) return "EMBED";
  return "LINK";
}

function normalizeEmbedUrl(url: string) {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const bilibili = url.match(/bilibili\.com\/video\/([A-Za-z0-9]+)/);
  if (bilibili) return `https://player.bilibili.com/player.html?bvid=${bilibili[1]}`;
  return url;
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
  const videoMaxSec = clampVideoDuration((settings as { videoMaxDurationSec?: number } | null)?.videoMaxDurationSec);
  const policy = videoPolicyFromSettings(settings);
  const maxPerPost = clampVideoMaxPerPost((settings as { videoMaxPerPost?: number } | null)?.videoMaxPerPost);
  const picks = await collectEvidenceVideoPicks(evidence, 6);
  if (!picks.length) return;

  const createdIds: string[] = [];
  let downloadedForThisPost = 0;
  for (const v of picks) {
    const region = isDomesticVideoCandidate(v.url, v.sourcePageUrl) ? "DOMESTIC" : "INTERNATIONAL";
    const type = detectVideoType(v.url);
    const baseData: Record<string, unknown> = {
      title: v.title,
      type,
      url: normalizeEmbedUrl(v.url),
      summary: `从${v.sourceName}的报道中自动识别到的视频资源。`,
      postId,
      region,
      sourcePageUrl: v.sourcePageUrl,
      sourcePlatform: sourcePlatformForVideo(v.url, v.sourcePageUrl)
    };
    let attribution = `来源页：${v.sourcePageUrl}\n原视频：${v.url}\n（基于${contextLabel}的研究资料自动提取）`;

    if (downloadedForThisPost < maxPerPost && shouldDownloadVideo(v.url, v.sourcePageUrl, policy)) {
      const dl = await downloadVideoByPolicy(v.url, policy, {
        maxDurationSec: videoMaxSec,
        referer: v.sourcePageUrl
      }).catch((err) => {
        console.error(`[video-download] failed ${v.url}:`, err);
        return null;
      });
      if (dl?.localPath) {
        baseData.type = "LOCAL";
        baseData.url = dl.localPath;
        baseData.localPath = dl.localPath;
        baseData.fileSizeBytes = dl.fileSizeBytes;
        baseData.durationSec = dl.durationSec;
        downloadedForThisPost += 1;
        attribution = `本地下载视频，原始来源：\n - 来源页：${v.sourcePageUrl}\n - 原视频链接：${v.url}\n - 平台：${baseData.sourcePlatform || "未知"}\n仅用于内部存档与方便国内访问，所有版权归原作者所有。`;
      } else if (type === "LOCAL") {
        baseData.type = "LINK";
      }
    } else if (type === "LOCAL") {
      baseData.type = "LINK";
    }

    baseData.attribution = attribution;

    try {
      const created = await createVideoRecord(baseData);
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
  const modelConfig = await getModelConfigForUse("news");

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
    prisma.newsTopic.findUniqueOrThrow({ where: { id: topicId } })
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
    } catch (error) {
      generated = buildDigestFallback(topic.name, formatLabel, windowLabel, scopeLabel, allEvidence, error);
    }
  } else {
    generated = buildDigestFallback(topic.name, formatLabel, windowLabel, scopeLabel, allEvidence, new Error("未配置模型或总结风格"));
  }

  const post = await createDraftFromDigest(fetchJob.id, topic.id, digestKind, fallbackTitle, allEvidence, generated, windowLabel, scopeLabel);
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

function buildDigestFallback(topicName: string, formatLabel: string, windowLabel: string, scopeLabel: string, evidence: EvidenceItem[], error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  const cleaned = evidence.slice(0, 12).map((item) => ({
    ...item,
    summary: cleanSummary(item.summary)
  }));
  return [
    `# ${topicName} · ${formatLabel}`,
    "",
    `> AI ${formatLabel}请求未完成：${reason}。系统已经把过去${windowLabel}内可用的新闻线索整理在下方，管理员可以直接基于这些事实改写发布。`,
    "",
    `范围：${scopeLabel}　时段：${windowLabel}　收录条目：${cleaned.length}`,
    "",
    `## ${windowLabel}的${topicName}速览`,
    "",
    cleaned.length === 0
      ? "本期暂未抓到足够的事实线索。"
      : `${windowLabel}内，${topicName}话题共有 ${cleaned.length} 条值得关注的报道，涵盖${listKeyTitles(cleaned)}等议题。具体内容如下。`,
    "",
    "## 事实线索",
    "",
    ...cleaned.map((item, i) => formatEvidenceBlock(i + 1, item)),
    "",
    "## 参考来源",
    ...cleaned.map((item) => `- [${item.sourceName}｜${item.title}](${item.url})`)
  ].join("\n");
}

/**
 * Strip residual HTML and trim length, then collapse whitespace.
 * Defensive: even if rss.ts already cleaned, evidence may come from Exa or
 * the keyword-search feeds where the path is different.
 */
function cleanSummary(input: string): string {
  if (!input) return "";
  let s = input;
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return s.replace(/\s+/g, " ").trim().slice(0, 320);
}

function formatEvidenceBlock(index: number, item: EvidenceItem) {
  const dateStr = item.publishedAt ? item.publishedAt.toISOString().slice(0, 10) : "";
  const meta = [item.sourceName, dateStr].filter(Boolean).join(" · ");
  const body = item.summary || "（无摘要）";
  return `**${index}. [${item.title}](${item.url})**\n\n${meta ? `_${meta}_\n\n` : ""}${body}\n`;
}

function listKeyTitles(evidence: EvidenceItem[]): string {
  const titles = evidence.slice(0, 5).map((e) => e.title.replace(/\s*[\-—–]\s*[^\-—–]+$/, "")).filter(Boolean);
  if (!titles.length) return "若干";
  return titles.map((t) => `「${t}」`).join("、");
}

const workerHandler = async (job: { data: FetchJobData }) => {
  const fetchJobId = job.data.fetchJobId;
  const fetchJob = await prisma.fetchJob.update({
    where: { id: fetchJobId },
    data: { status: "RUNNING", error: null }
  });

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
  } catch (error) {
    await prisma.fetchJob.update({
      where: { id: fetchJob.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) }
    });
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
  const topic = await prisma.newsTopic.findUnique({ where: { id: topicId } });
  if (!topic || !topic.isEnabled) {
    console.log(`[schedule] topic ${topicId} not active; skip`);
    return;
  }
  const result = await enqueueTopicRun(topicId);
  await prisma.autoSchedule.update({
    where: { topicId },
    data: { lastRunAt: new Date() }
  }).catch(() => undefined);
  console.log(`[schedule] topic ${topic.name} (${topicId}) — enqueued ${result.enqueued} jobs (${result.reason})`);
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

for (const worker of [fetchWorker, researchWorker, audienceWorker, scheduleWorker]) {
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
  await Promise.allSettled([
    fetchWorker.close(),
    researchWorker.close(),
    audienceWorker.close(),
    scheduleWorker.close(),
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

console.log(`ShiBei worker started: ${fetchQueueName}, ${researchQueueName}, ${audienceQueueName}, ${scheduleQueueName}`);
