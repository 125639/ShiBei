import { hostFromUrl } from "./html";
import { fetchRss } from "./rss";
import { assessSourceSufficiency, normalizeUrl } from "./source-quality";
import type { ExaResult } from "./exa";

type SearchFeedItem = {
  title: string;
  link: string;
  summary: string;
  date?: Date;
};

type ScrapedPage = {
  title: string;
  content: string;
  markdown: string;
  finalUrl: string;
};

export type CreationGoogleNewsSearchOutcome = {
  evidence: ExaResult[];
  /** At least one Google News RSS request completed, even if it had no hits. */
  searchCompleted: boolean;
  candidateCount: number;
};

type CreationResearchDependencies = {
  fetchFeed?: (url: string) => Promise<SearchFeedItem[]>;
  scrapePage?: (url: string) => Promise<ScrapedPage>;
};

/**
 * 共创研究不直接使用 Google News 的标题和 RSS 摘要。RSS 在这里仅负责
 * “发现链接”，每一条返回给写作模型的 evidence 都必须回源抓到网页正文，
 * 并通过与批量文章相同的正文充分性门槛。
 */
export async function searchCreationEvidenceWithGoogleNews(
  queries: string[],
  dependencies: CreationResearchDependencies = {}
): Promise<CreationGoogleNewsSearchOutcome> {
  const feeds = buildCreationGoogleNewsFeeds(queries);
  if (!feeds.length) {
    return { evidence: [], searchCompleted: true, candidateCount: 0 };
  }

  const fetchFeed = dependencies.fetchFeed ?? fetchRss;
  const scrapePage = dependencies.scrapePage ?? defaultScrapePage;
  const feedResults = await Promise.allSettled(feeds.map((feed) => fetchFeed(feed.url)));
  const fulfilled = feedResults.filter(
    (result): result is PromiseFulfilledResult<SearchFeedItem[]> => result.status === "fulfilled"
  );

  // 交错取各查询、各语种结果，避免第一条宽查询独占全部回源抓取预算。
  const candidates = interleaveFeedCandidates(fulfilled.map((result) => result.value));
  const evidence: ExaResult[] = [];
  const seenFinalUrls = new Set<string>();

  // Chromium 抓取较重；每批最多三个 context。首批已经取得足够资料时立即停止，
  // 兼顾交互式成文的等待时间和失败站点的容错能力。
  for (let offset = 0; offset < candidates.length && evidence.length < 5; offset += 3) {
    const batch = candidates.slice(offset, offset + 3);
    const scraped = await Promise.allSettled(
      batch.map(async (candidate) => ({ candidate, page: await scrapePage(candidate.link) }))
    );

    for (const result of scraped) {
      if (result.status !== "fulfilled") continue;
      const { candidate, page } = result.value;
      const finalUrl = normalizeUrl(page.finalUrl);
      if (!/^https?:\/\//i.test(finalUrl) || seenFinalUrls.has(finalUrl)) continue;

      const sufficiency = assessSourceSufficiency({
        url: finalUrl,
        title: page.title || candidate.title,
        markdown: page.markdown,
        content: page.content
      });
      if (!sufficiency.ok) continue;

      const body = selectRicherCreationEvidenceBody(page.markdown, page.content);
      const text = cleanEvidenceBody(body).slice(0, 6_000);
      if (!text) continue;

      seenFinalUrls.add(finalUrl);
      evidence.push({
        title: cleanTitle(page.title || candidate.title),
        url: finalUrl,
        text,
        publishedDate: candidate.date || null,
        sourceName: hostFromUrl(finalUrl) || "公开网页"
      });
      if (evidence.length >= 5) break;
    }

    // 两条独立、正文级来源足以支持快速成文与事实交叉核对；无需继续打开
    // 更多站点。深度成文仍可由首批最多三条或下一批补至五条。
    if (evidence.length >= 2) break;
  }

  return {
    evidence,
    searchCompleted: fulfilled.length > 0,
    candidateCount: candidates.length
  };
}

export function buildCreationGoogleNewsFeeds(queries: string[]) {
  const normalized = normalizeCreationSearchQueries(queries).slice(0, 2);
  const feeds: Array<{ name: string; url: string }> = [];
  for (const query of normalized) {
    const encoded = encodeURIComponent(query);
    const locales = containsCjk(query)
      ? [
          ["Google News 中文", `https://news.google.com/rss/search?q=${encoded}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`],
          ["Google News Global", `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`]
        ]
      : [
          ["Google News Global", `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`]
        ];
    for (const [name, url] of locales) feeds.push({ name, url });
  }
  return feeds;
}

export function selectRicherCreationEvidenceBody(
  markdown: string | null | undefined,
  content: string | null | undefined
) {
  const markdownValue = markdown || "";
  const contentValue = content || "";
  return visibleInformationLength(markdownValue) >= visibleInformationLength(contentValue)
    ? markdownValue
    : contentValue;
}

function normalizeCreationSearchQueries(queries: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of queries) {
    const query = String(raw || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    if (query.length < 3) continue;
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(query);
  }
  return normalized;
}

function interleaveFeedCandidates(feedItems: SearchFeedItem[][]) {
  const candidates: SearchFeedItem[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < 3; index += 1) {
    for (const items of feedItems) {
      const item = items[index];
      if (!item?.link) continue;
      const key = normalizeUrl(item.link);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
      if (candidates.length >= 6) return candidates;
    }
  }
  return candidates;
}

async function defaultScrapePage(url: string): Promise<ScrapedPage> {
  // 延迟加载，避免只做访谈提问/评分时初始化 Playwright；scrapeWebPage 内部
  // 会校验初始 URL、每次重定向和所有页面子请求的 DNS/IP，拒绝私网与 metadata。
  const { scrapeWebPage } = await import("./scrape");
  return scrapeWebPage(url);
}

function containsCjk(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function visibleInformationLength(value: string) {
  const visible = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    .replace(/\[([^\]]+)]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/<[^>]+>/g, " ");
  return visible.match(/[\p{L}\p{N}]/gu)?.length || 0;
}

function cleanEvidenceBody(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function cleanTitle(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || "公开资料";
}
