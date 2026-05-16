import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cacheArticleImage,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_PUBLIC_PREFIX,
  IMAGE_TYPES,
  type CacheArticleImageOptions
} from "./article-image-cache";
import { escapeHtml, hostFromUrl } from "./html";
import { prisma } from "./prisma";
import { IMAGE_DIR } from "./storage";
import { insertMarkdownBlock, normalizeVideoPlacement, type VideoPlacement } from "./video-display";

export type ScrapedArticleImage = {
  src: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  domDepth?: number | null;
  parentMarker?: string | null;
};

export type ArticleImageCandidate = ScrapedArticleImage & {
  sourcePageUrl: string;
};

export type ArticleImagePlacement = VideoPlacement;

export type SavedUploadedArticleImage = {
  url: string;
  bytes: number;
  contentType: string;
  filePath: string;
};

export type EmbedArticleImagesResult = {
  inserted: number;
  skipped: number;
  urls: string[];
};

const IMAGE_TRACKER_DOMAINS = ["trk.", "px.", "tracker.", "pixel.", "gravatar.com", "stats."];

const CN_STOPWORDS = new Set([
  "的", "了", "是", "在", "和", "与", "或", "及", "对", "对于", "为", "为了", "等",
  "也", "都", "就", "而", "但", "及其", "其", "之", "之类", "这", "那", "我们", "他们",
  "她们", "它们", "你们", "我", "你", "他", "她", "它", "我们的", "本", "该", "这些",
  "那些", "从", "到", "向", "上", "下", "中", "里", "外", "前", "后", "如", "若", "并",
  "并且", "而且", "或者", "因为", "所以", "如果", "因此", "据", "据悉", "表示", "认为",
  "已经", "已", "可以", "可能", "不", "没有", "没"
]);

const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "being", "this",
  "that", "these", "those", "it", "its", "they", "them", "their", "we", "our", "us",
  "you", "your", "he", "she", "him", "her", "his", "hers", "i", "my", "me", "mine",
  "yours", "ours", "theirs", "do", "does", "did", "have", "has", "had", "will",
  "would", "could", "should", "may", "might", "can", "must", "not", "no", "yes",
  "if", "then", "than", "so", "such", "what", "which", "who", "whom", "whose",
  "where", "when", "why", "how", "about", "after", "before", "between", "during",
  "into", "out", "over", "under", "again", "further", "more", "most", "some", "any",
  "all", "each", "every", "few", "many", "other", "another"
]);

export function normalizeArticleImagePlacement(value: unknown): ArticleImagePlacement {
  return normalizeVideoPlacement(value);
}

export function withImageSource(images: ScrapedArticleImage[], sourcePageUrl: string): ArticleImageCandidate[] {
  return images.map((image) => ({ ...image, sourcePageUrl }));
}

export function extractPostKeywords(title: string, summary: string): string[] {
  // 只取标题和摘要里的高频词，作为图片 alt 相关性打分的轻量信号。
  const text = `${title || ""} ${(summary || "").slice(0, 200)}`.toLowerCase();
  const counts = new Map<string, number>();

  const enMatches = text.match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  for (const word of enMatches) {
    if (EN_STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  const cjkRuns = text.match(/[一-鿿]+/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (CN_STOPWORDS.has(bigram) || CN_STOPWORDS.has(bigram[0]) || CN_STOPWORDS.has(bigram[1])) continue;
      counts.set(bigram, (counts.get(bigram) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => key);
}

export function canonicalizeArticleImageUrl(url: string): string {
  try {
    // 去掉 query/hash 后再去重，避免同一张 CDN 图片因追踪参数重复插入。
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    u.protocol = u.protocol.toLowerCase();
    return u.toString();
  } catch {
    return url;
  }
}

export function scoreArticleImage(image: ArticleImageCandidate, keywords: string[]): number {
  const width = image.width || 0;
  const height = image.height || 0;
  const ratio = width && height ? width / height : 0;
  const marker = (image.parentMarker || "").toLowerCase();
  const alt = (image.alt || "").toLowerCase();
  let score = 0;

  // 主体图通常尺寸更大、横图比例更接近新闻配图；小图和极端比例大幅扣分。
  score += Math.min(width * height, 1_200_000) / 10_000;

  if (width && height) {
    if (width < 320 || height < 200) score -= 60;
    if (ratio >= 1.2 && ratio <= 2.4) score += 40;
    if (ratio > 4 || ratio < 0.4) score -= 30;
  }

  // DOM 容器能区分正文图和边栏/推荐/广告图。
  if (/(article|main|content|entry|post)/.test(marker)) score += 25;
  if (/(sidebar|footer|header|nav|related|comment|share|advert|ad-|hot|recom)/.test(marker)) score -= 40;

  let overlap = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (alt.includes(keyword)) overlap += 1;
    if (overlap >= 5) break;
  }
  score += overlap * 12;

  const filename = (() => {
    try {
      return new URL(image.src).pathname.split("/").pop() || "";
    } catch {
      return "";
    }
  })().toLowerCase();
  if (filename.length > 6 && !/^[0-9_.-]+$/.test(filename)) score += 10;

  const host = (() => {
    try {
      return new URL(image.src).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  // 追踪像素、头像和统计域名即使有合法图片响应，也不应该进入文章正文。
  if (host && IMAGE_TRACKER_DOMAINS.some((bad) => host.includes(bad))) score -= 100;

  return score;
}

export function selectArticleImages(
  images: ArticleImageCandidate[],
  limit: number,
  keywords: string[] = [],
  opts?: { minScore?: number }
): ArticleImageCandidate[] {
  const minScore = opts?.minScore ?? 5;
  const byCanonical = new Map<string, ArticleImageCandidate>();
  for (const image of images) {
    if (!image?.src || !/^https?:\/\//i.test(image.src)) continue;
    const key = canonicalizeArticleImageUrl(image.src);
    const existing = byCanonical.get(key);
    if (!existing) {
      byCanonical.set(key, image);
    } else {
      // 同一图片保留元数据更完整的版本，后续 caption 和排序会更稳。
      const oldRank = (existing.width || 0) * (existing.height || 0) + (existing.alt?.length || 0);
      const newRank = (image.width || 0) * (image.height || 0) + (image.alt?.length || 0);
      if (newRank > oldRank) byCanonical.set(key, image);
    }
  }

  return [...byCanonical.values()]
    .map((image) => ({ image, score: scoreArticleImage(image, keywords) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.image);
}

export async function embedArticleImagesInPostContent(
  postId: string,
  images: ArticleImageCandidate[],
  opts: {
    limit?: number;
    placement?: ArticleImagePlacement;
    cacheOptions?: CacheArticleImageOptions;
    mirrorToEnglish?: boolean;
  } = {}
): Promise<EmbedArticleImagesResult> {
  if (!images.length) return { inserted: 0, skipped: 0, urls: [] };

  // 自动流程只依赖 Post 当前内容做去重，不引入新的数据库表，方便同步和回滚。
  const existing = await (prisma as unknown as {
    post: { findUnique: (args: unknown) => Promise<{ title: string; summary: string; content: string; contentEn: string | null } | null> };
  }).post.findUnique({
    where: { id: postId },
    select: { title: true, summary: true, content: true, contentEn: true }
  }).catch(() => null);
  if (!existing) return { inserted: 0, skipped: images.length, urls: [] };

  const keywords = extractPostKeywords(existing.title, existing.summary);
  const picked = selectArticleImages(images, opts.limit ?? 3, keywords);
  if (!picked.length) return { inserted: 0, skipped: images.length, urls: [] };

  const existingHtml = `${existing.content}\n${existing.contentEn || ""}`;
  const candidates = picked.filter((image) => !existingHtml.includes(image.src));
  let skipped = picked.length - candidates.length;

  // 远程图先缓存到本地 /uploads/image，再把本地 URL 写入正文；并发拉取减少串行等待。
  const cachedResults = await Promise.all(
    candidates.map((image) =>
      cacheArticleImage(image.src, {
        ...opts.cacheOptions,
        sourcePageUrl: image.sourcePageUrl
      }).then((cached) => ({ image, cached }))
    )
  );

  const figures: string[] = [];
  const urls: string[] = [];
  const seenInThisBatch = new Set<string>();

  for (const { image, cached } of cachedResults) {
    if (!cached) {
      skipped += 1;
      continue;
    }
    if (existingHtml.includes(cached.url) || seenInThisBatch.has(cached.url)) {
      skipped += 1;
      continue;
    }
    figures.push(buildArticleImageFigureHtml({
      src: cached.url,
      caption: image.alt || "原文配图",
      sourcePageUrl: image.sourcePageUrl
    }));
    urls.push(cached.url);
    seenInThisBatch.add(cached.url);
  }

  if (!figures.length) return { inserted: 0, skipped, urls: [] };

  const result = await insertArticleImageFiguresIntoPost(postId, figures, {
    placement: opts.placement || "after-intro",
    mirrorToEnglish: opts.mirrorToEnglish ?? true,
    preloadedPost: { content: existing.content, contentEn: existing.contentEn }
  }).catch((err) => {
    console.error(`[image-embed] failed to inline images for post ${postId}:`, err);
    return { inserted: 0, skipped: figures.length, urls: [] };
  });
  return { inserted: result.inserted, skipped: skipped + result.skipped, urls };
}

export function buildArticleImageFigureHtml(input: {
  src: string;
  caption?: string | null;
  sourcePageUrl?: string | null;
  sourceLabel?: string | null;
}): string {
  // 生成的 HTML 走 markdown sanitizer 白名单，只保留 figure/img/figcaption/a。
  const caption = normalizeCaption(input.caption);
  const sourceUrl = safeHttpUrl(input.sourcePageUrl || "");
  const sourceLabel = input.sourceLabel || (sourceUrl ? hostFromUrl(sourceUrl) : null);
  const sourceLink = sourceUrl
    ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel || "来源")}</a>`
    : "";
  return [
    `<figure class="article-media article-image">`,
    `<img src="${escapeHtml(input.src)}" alt="${escapeHtml(caption)}" loading="lazy" decoding="async">`,
    `<figcaption><span>${escapeHtml(caption)}</span>${sourceLink}</figcaption>`,
    `</figure>`
  ].join("");
}

export function insertArticleImageFiguresIntoMarkdown(
  markdown: string,
  figures: string[],
  placement: ArticleImagePlacement
) {
  const block = figures.filter(Boolean).join("\n\n");
  if (!block) return markdown;
  return insertMarkdownBlock(markdown, block, placement);
}

export async function insertArticleImageFiguresIntoPost(
  postId: string,
  figures: string[],
  opts: {
    placement?: ArticleImagePlacement;
    mirrorToEnglish?: boolean;
    preloadedPost?: { content: string; contentEn: string | null };
  } = {}
): Promise<EmbedArticleImagesResult> {
  const post = opts.preloadedPost ?? await (prisma as unknown as {
    post: { findUnique: (args: unknown) => Promise<{ content: string; contentEn: string | null } | null> };
  }).post.findUnique({
    where: { id: postId },
    select: { content: true, contentEn: true }
  });
  if (!post) return { inserted: 0, skipped: figures.length, urls: [] };

  const existingHtml = `${post.content}\n${post.contentEn || ""}`;
  const uniqueFigures: string[] = [];
  const urls: string[] = [];
  let skipped = 0;

  for (const figure of figures) {
    // 手动和自动流程都在插入前按 img src 去重，避免反复提交产生重复配图。
    const src = extractImgSrc(figure);
    if (src && (existingHtml.includes(src) || urls.includes(src))) {
      skipped += 1;
      continue;
    }
    uniqueFigures.push(figure);
    if (src) urls.push(src);
  }

  if (!uniqueFigures.length) return { inserted: 0, skipped, urls: [] };

  const placement = opts.placement || "after-intro";
  const nextContent = insertArticleImageFiguresIntoMarkdown(post.content, uniqueFigures, placement);
  const mirrorToEnglish = opts.mirrorToEnglish ?? true;
  const nextContentEn = mirrorToEnglish && post.contentEn
    ? insertArticleImageFiguresIntoMarkdown(post.contentEn, uniqueFigures, placement)
    : null;

  await (prisma as unknown as {
    post: { update: (args: unknown) => Promise<unknown> };
  }).post.update({
    where: { id: postId },
    data: nextContentEn ? { content: nextContent, contentEn: nextContentEn } : { content: nextContent }
  });

  return { inserted: uniqueFigures.length, skipped, urls };
}

export async function saveUploadedArticleImage(
  file: File,
  opts: { imageDir?: string; publicPathPrefix?: string; maxBytes?: number } = {}
): Promise<SavedUploadedArticleImage | null> {
  const maxBytes = opts.maxBytes || DEFAULT_MAX_IMAGE_BYTES;
  if (file.size <= 0 || file.size > maxBytes) return null;

  const buffer = Buffer.from(await file.arrayBuffer());
  // 不信任浏览器传来的 MIME/type，只看文件头判断真实图片格式。
  const detected = detectImageType(buffer);
  if (!detected) return null;

  const imageDir = opts.imageDir || IMAGE_DIR;
  const publicPathPrefix = opts.publicPathPrefix || DEFAULT_PUBLIC_PREFIX;
  // 内容 hash 命名让重复上传天然复用同一个文件，也避免原始文件名注入路径。
  const key = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileName = `manual-${key.slice(0, 32)}${detected.ext}`;
  const filePath = path.join(imageDir, fileName);

  await fs.mkdir(imageDir, { recursive: true });
  await fs.writeFile(filePath, buffer, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code !== "EEXIST") throw error;
  });

  return {
    url: `${publicPathPrefix}/${fileName}`,
    bytes: buffer.length,
    contentType: detected.contentType,
    filePath
  };
}

function detectImageType(buffer: Buffer): { contentType: string; ext: string } | null {
  const contentType = sniffImageContentType(buffer);
  if (!contentType) return null;
  const ext = IMAGE_TYPES[contentType];
  return ext ? { contentType, ext } : null;
}

function sniffImageContentType(buffer: Buffer): string | null {
  // 只接受前台渲染和 /uploads 路由明确支持的常见图片格式。
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function normalizeCaption(value?: string | null) {
  const caption = (value || "").replace(/\s+/g, " ").trim();
  return (caption || "文章配图").slice(0, 180);
}

function extractImgSrc(html: string) {
  return html.match(/<img\b[^>]*\bsrc=(["'])(.*?)\1/i)?.[2] || "";
}

function safeHttpUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}
