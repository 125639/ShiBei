import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertSafeFetchUrl } from "./url-safety";

export const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_IMAGE_DIR = path.join(process.cwd(), "public", "uploads", "image");
export const DEFAULT_PUBLIC_PREFIX = "/uploads/image";

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

export type CachedArticleImage = {
  url: string;
  bytes: number;
  contentType: string;
  filePath: string;
};

export type CacheArticleImageOptions = {
  cacheDir?: string;
  publicPathPrefix?: string;
  fetcher?: typeof fetch;
  maxBytes?: number;
  sourcePageUrl?: string | null;
};

export type RewriteArticleImagesResult = {
  html: string;
  changed: number;
  skipped: number;
};

export async function cacheArticleImage(
  rawUrl: string,
  opts: CacheArticleImageOptions = {}
): Promise<CachedArticleImage | null> {
  const safeUrl = safeRemoteImageUrl(rawUrl);
  if (!safeUrl) return null;

  const cacheDir = opts.cacheDir || DEFAULT_IMAGE_DIR;
  const publicPathPrefix = opts.publicPathPrefix || DEFAULT_PUBLIC_PREFIX;
  const maxBytes = opts.maxBytes || DEFAULT_MAX_IMAGE_BYTES;
  const key = crypto.createHash("sha256").update(safeUrl).digest("hex");
  const existing = await findExistingImage(cacheDir, publicPathPrefix, key);
  if (existing) return existing;

  const fetcher = opts.fetcher || fetch;
  let response: Response;
  try {
    response = await fetcher(safeUrl, {
      redirect: "follow",
      headers: imageRequestHeaders(opts.sourcePageUrl)
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return null;

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) return null;

  const buffer = await readLimitedResponse(response, maxBytes).catch(() => null);
  if (!buffer || buffer.length === 0) return null;

  await fs.mkdir(cacheDir, { recursive: true });
  const fileName = `${key}${ext}`;
  const filePath = path.join(cacheDir, fileName);
  await fs.writeFile(filePath, buffer, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
    if (error?.code !== "EEXIST") throw error;
  });

  return {
    url: `${publicPathPrefix}/${fileName}`,
    bytes: buffer.length,
    contentType,
    filePath
  };
}

export async function rewriteRemoteArticleImageSources(
  html: string,
  opts: CacheArticleImageOptions = {}
): Promise<RewriteArticleImagesResult> {
  const matches = [...html.matchAll(/<img\b([^>]*?)\bsrc=(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi)];
  if (!matches.length) return { html, changed: 0, skipped: 0 };

  const replacements = new Map<string, string>();
  let changed = 0;
  let skipped = 0;

  for (const match of matches) {
    const src = match[3];
    if (replacements.has(src)) continue;
    const cached = await cacheArticleImage(src, opts);
    if (cached) {
      replacements.set(src, cached.url);
      changed += 1;
    } else {
      skipped += 1;
    }
  }

  if (!replacements.size) return { html, changed, skipped };

  const rewritten = html.replace(
    /(<img\b[^>]*?\bsrc=)(["'])(https?:\/\/[^"']+)(\2[^>]*>)/gi,
    (full, prefix: string, quote: string, src: string, suffix: string) => {
      const next = replacements.get(src);
      return next ? `${prefix}${quote}${next}${suffix}` : full;
    }
  );

  return { html: rewritten, changed, skipped };
}

function safeRemoteImageUrl(rawUrl: string) {
  try {
    const url = assertSafeFetchUrl(decodeHtmlUrl(rawUrl));
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtmlUrl(rawUrl: string) {
  return rawUrl
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeContentType(value: string | null) {
  return (value || "").split(";")[0].trim().toLowerCase();
}

function imageRequestHeaders(sourcePageUrl?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.2",
    "User-Agent": "Mozilla/5.0 (compatible; ShiBeiBot/1.0; +https://example.invalid)"
  };
  if (sourcePageUrl && /^https?:\/\//i.test(sourcePageUrl)) {
    headers.Referer = sourcePageUrl;
  }
  return headers;
}

async function findExistingImage(cacheDir: string, publicPathPrefix: string, key: string) {
  for (const ext of new Set(Object.values(IMAGE_TYPES))) {
    const filePath = path.join(cacheDir, `${key}${ext}`);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        return {
          url: `${publicPathPrefix}/${key}${ext}`,
          bytes: stat.size,
          contentType: contentTypeForExt(ext),
          filePath
        };
      }
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function contentTypeForExt(ext: string) {
  if (ext === ".jpg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error("image too large");
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("image too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
