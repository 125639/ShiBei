import { Source } from "@prisma/client";
import { type EvidenceItem } from "../lib/ai";
import { fetchRss } from "../lib/rss";
import { type ResearchDepth, type ResearchScope } from "../lib/research";
import { prisma } from "../lib/prisma";
import { searchWithExa, type ExaResult } from "../lib/exa";
import { filterUsableEvidenceItems, normalizeUrl } from "../lib/source-quality";
import { hostFromUrl } from "../lib/html";

// 关键词/话题的证据收集(Exa + 已存 RSS 源 + Google News 搜索源),
// 以及模型生成失败时基于证据的兜底稿构建。
// 只依赖数据层与抓取库,不触碰队列、任务状态等 worker 主流程概念。

export async function collectKeywordEvidence(keyword: string, scope: ResearchScope, opts?: { topicId?: string | null }) {
  const topic = opts?.topicId
    ? await prisma.contentTopic.findUnique({ where: { id: opts.topicId }, select: { useExa: true } })
    : null;
  const useExa = topic ? topic.useExa : true;

  const [savedEvidence, searchEvidence, exaEvidence] = await Promise.all([
    collectFromSavedSources(keyword, scope, opts),
    collectFromSearchFeeds(keyword, scope),
    useExa ? collectFromExa(keyword, scope) : Promise.resolve([])
  ]);
  const seen = new Set<string>();
  const evidence: EvidenceItem[] = [];

  // Order matters: Exa results are query-specific so they have the highest
  // expected relevance and should win the top slots (which dominate LLM
  // attention). RSS search feeds come next. Saved sources are broad topic
  // feeds and should only fill remaining slots — otherwise a busy general-AI
  // RSS source can shove unrelated items ahead of focused Exa hits.
  for (const item of filterUsableEvidenceItems([...exaEvidence, ...searchEvidence, ...savedEvidence])) {
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
    return results.map(evidenceFromExaResult);
  } catch (error) {
    console.error("[exa] collect failed:", error);
    return [];
  }
}

export function evidenceFromExaResult(result: ExaResult): EvidenceItem {
  return {
    title: result.title,
    url: result.url,
    sourceName: result.sourceName || hostFromUrl(result.url) || "未知来源",
    summary: result.text || result.title,
    publishedAt: result.publishedDate,
    // Exa search 的 text 最多只取配置的截断片段，必须回源抓取后才能升级为 fulltext。
    materialKind: "excerpt",
    discoveryMethod: "exa"
  };
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
    const topic = await prisma.contentTopic.findUnique({
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
        publishedAt: item.date,
        materialKind: "excerpt" as const,
        discoveryMethod: "rss" as const
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
        const parsedTitle = splitGoogleNewsTitle(item.title);
        evidence.push({
          title: parsedTitle.title,
          url: item.link,
          sourceName: parsedTitle.publisher || feed.name,
          summary: item.summary || item.title,
          publishedAt: item.date,
          materialKind: "excerpt" as const,
          discoveryMethod: "google-news" as const
        });
        if (evidence.length >= 10) return evidence;
      }
    } catch (error) {
      console.error(`Search feed failed ${feed.url}:`, error);
    }
  }

  return evidence;
}

function splitGoogleNewsTitle(title: string) {
  const match = title.match(/^(.*?)\s+[\-—–]\s+([^\-—–]{2,80})$/);
  if (!match) return { title, publisher: "" };
  return { title: match[1].trim() || title, publisher: match[2].trim() };
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

export function buildResearchFallbackDraft(keyword: string, scopeLabel: string, evidence: EvidenceItem[], error: unknown, index = 1, count = 1, depth: ResearchDepth = "long") {
  const reason = error instanceof Error ? error.message : String(error);
  const cleaned = evidence.slice(0, 10).map((item) => ({
    ...item,
    summary: cleanSummary(item.summary)
  }));
  return [
    `# ${count > 1 ? `${keyword}（第 ${index} 篇）` : keyword}`,
    "",
    `> AI 内容生成请求未完成：${reason}。系统保留了本次关键词研究的原始资料，管理员可基于这些事实线索手动改写为正式文章。`,
    "",
    `资料范围：${scopeLabel}　计划篇数：${count}　文章长度：${depth}`,
    "",
    "## 已收集的事实线索",
    "",
    ...cleaned.map((item, i) => formatEvidenceBlock(i + 1, item)),
    "",
    "## 参考来源",
    ...cleaned.map((item) => `- [${item.sourceName}｜${item.title}](${item.url})`)
  ].join("\n");
}

export function buildDigestFallback(topicName: string, formatLabel: string, windowLabel: string, scopeLabel: string, evidence: EvidenceItem[], error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  const cleaned = evidence.slice(0, 12).map((item) => ({
    ...item,
    summary: cleanSummary(item.summary)
  }));
  return [
    `# ${topicName} · ${formatLabel}`,
    "",
    `> AI ${formatLabel}请求未完成：${reason}。系统已经把过去${windowLabel}内可用的资料线索整理在下方，管理员可以直接基于这些事实改写发布。`,
    "",
    `范围：${scopeLabel}　时段：${windowLabel}　收录条目：${cleaned.length}`,
    "",
    `## ${windowLabel}的${topicName}速览`,
    "",
    cleaned.length === 0
      ? "本期暂未抓到足够的事实线索。"
      : `${windowLabel}内，${topicName}话题共有 ${cleaned.length} 条值得关注的材料，涵盖${listKeyTitles(cleaned)}等议题。具体内容如下。`,
    "",
    "## 事实线索",
    "",
    ...cleaned.map((item, i) => formatEvidenceBlock(i + 1, item)),
    "",
    "## 参考来源",
    ...cleaned.map((item) => `- [${item.sourceName}｜${item.title}](${item.url})`)
  ].join("\n");
}

export function rotateEvidence(evidence: EvidenceItem[], offset: number) {
  if (!evidence.length) return evidence;
  const start = offset % evidence.length;
  return [...evidence.slice(start), ...evidence.slice(0, start)];
}

function matchesKeyword(keyword: string, text: string) {
  const normalizedText = text.toLowerCase();
  const terms = keyword.toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  if (!terms.length) return false;
  // Single-term keywords keep the original substring check. For multi-term
  // keywords require at least half the terms to match — otherwise a broad
  // saved RSS source whose articles incidentally mention one term (e.g.
  // "claude" appearing in unrelated AI-safety posts) floods evidence with
  // irrelevant hits and starves the more focused Exa/search results.
  if (terms.length === 1) return normalizedText.includes(terms[0]);
  const minMatches = Math.ceil(terms.length / 2);
  let hits = 0;
  for (const term of terms) {
    if (normalizedText.includes(term)) {
      hits++;
      if (hits >= minMatches) return true;
    }
  }
  return false;
}

// 与引用校验门（source-quality）用同一套「同一 URL」判定：去 hash 与跟踪参数、
// host 小写、去尾斜杠。证据去重、RSS 幂等槽和引用白名单必须对「链接是否相同」
// 得出一致结论，否则带 utm 变体的同一篇文章会绕过去重被重复处理。
export function normalizeEvidenceUrl(url: string) {
  return normalizeUrl(url) || url;
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
