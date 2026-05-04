import FeedParser from "feedparser";
import { Readable } from "node:stream";

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

export async function fetchRss(url: string): Promise<RssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(url, {
    headers: { "User-Agent": "ShiBeiBlog/0.1" },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  if (!response.ok || !response.body) {
    throw new Error(`RSS fetch failed: ${response.status}`);
  }

  const text = await response.text();
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
