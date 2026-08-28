import FeedParser from "feedparser";
import { Readable } from "node:stream";
import { safeFetch } from "./url-safety";
import {
  InvalidSourceMaterialError,
  isRetryableSourceStatus,
  RetryableSourceFetchError
} from "./source-quality";

type RssItem = {
  title: string;
  link: string;
  summary: string;
  date?: Date;
};

/**
 * Strip HTML tags + decode common entities from RSS description / summary.
 *
 * Many feeds (Google News, especially) put the entire item teaser as raw
 * HTML inside <description>. If we hand that straight to the AI it wastes
 * tokens on `<a href="…">` boilerplate, and if we hand it to the fallback
 * draft it ends up as visible HTML in the post body.
 */
function stripHtml(input: string): string {
  if (!input) return "";
  let s = input;
  // Remove script/style blocks entirely.
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Replace <br>/<p>/<li> with whitespace before stripping.
  s = s.replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, " ");
  // Drop all remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Decode the common entities; everything else falls back as-is.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  // Collapse whitespace.
  return s.replace(/\s+/g, " ").trim();
}

const RSS_FETCH_TIMEOUT_MS = 20000;
// RSS 正文极少超过个位数 MB；上限防止恶意/异常源把 1GB 内存上限的 worker 撑爆。
const MAX_RSS_BODY_BYTES = 8 * 1024 * 1024;

export async function fetchRss(url: string): Promise<RssItem[]> {
  const controller = new AbortController();
  // 计时器必须活到响应体读完为止。只保护到「响应头到达」的话，慢速滴流的
  // body 可以无限期占住并发为 1 的抓取队列槽，而且没有任何恢复机制能打断它。
  const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  let text: string;
  try {
    const response = await safeFetch(url, {
      headers: { "User-Agent": "ShiBeiBlog/0.1" },
      signal: controller.signal
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const message = `RSS 来源返回 HTTP ${response.status}`;
      if (isRetryableSourceStatus(response.status)) {
        throw new RetryableSourceFetchError(message);
      }
      throw new InvalidSourceMaterialError(message);
    }
    if (!response.body) throw new RetryableSourceFetchError("RSS 来源未返回响应体");
    text = await readBodyTextWithLimit(response, MAX_RSS_BODY_BYTES);
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new RetryableSourceFetchError(`RSS 拉取超时（${Math.round(RSS_FETCH_TIMEOUT_MS / 1000)}s，含响应体）`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  return new Promise((resolve, reject) => {
    const feedparser = new FeedParser();
    const items: RssItem[] = [];

    feedparser.on("error", reject);
    feedparser.on("readable", () => {
      let item;
      while ((item = feedparser.read())) {
        const rawSummary = item.summary || item.description || "";
        items.push({
          title: stripHtml(item.title || item.link || "Untitled").slice(0, 240),
          link: item.link,
          summary: stripHtml(rawSummary),
          date: item.date || undefined
        });
      }
    });
    feedparser.on("end", () => resolve(items.slice(0, 10)));

    Readable.from([text]).pipe(feedparser);
  });
}

/** 流式读响应体，超过 maxBytes 立即断开——RSS 解析在内存中进行，必须有界。 */
async function readBodyTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new InvalidSourceMaterialError(`RSS 响应超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
