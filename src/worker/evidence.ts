import { Source } from "@prisma/client";
import { type EvidenceItem } from "../lib/ai";
import { fetchRss } from "../lib/rss";
import { type ResearchDepth, type ResearchScope } from "../lib/research";
import { prisma } from "../lib/prisma";
import { recordSourceFailure, recordSourceSuccess } from "./source-health";
import { searchWithExa, type ExaResult } from "../lib/exa";
import {
  assessSourceSufficiency,
  filterUsableEvidenceItems,
  isBodyLevelEvidence,
  normalizeUrl,
  selectSubstantiveEvidenceItems
} from "../lib/source-quality";
import { hostFromUrl } from "../lib/html";
import { scrapeWebPage } from "../lib/scrape";

// 关键词/话题的证据收集(Exa + 已存 RSS 源 + Google News 搜索源),
// 以及模型生成失败时基于证据的兜底稿构建。
// 只依赖数据层与抓取库,不触碰队列、任务状态等 worker 主流程概念。

export async function collectKeywordEvidence(
  keyword: string,
  scope: ResearchScope,
  opts?: {
    topicId?: string | null;
    searchQueries?: string[];
    onTransientFailure?: (error: unknown) => void;
  }
) {
  const topic = opts?.topicId
    ? await prisma.contentTopic.findUnique({ where: { id: opts.topicId }, select: { useExa: true } })
    : null;
  const useExa = topic ? topic.useExa : true;

  const searchQueries = normalizeSearchQueries(opts?.searchQueries, keyword);
  const [savedEvidence, searchEvidence, exaEvidence] = await Promise.all([
    collectFromSavedSources(keyword, scope, opts),
    collectFromSearchFeeds(searchQueries, scope, opts?.onTransientFailure),
    useExa ? collectFromExa(searchQueries[0] || keyword, scope, opts?.onTransientFailure) : Promise.resolve([])
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

async function collectFromExa(keyword: string, scope: ResearchScope, onTransientFailure?: (error: unknown) => void) {
  try {
    const results = await searchWithExa(keyword, {
      numResults: 8,
      domesticOnly: scope === "domestic",
      internationalOnly: scope === "international"
    });
    return results.map(evidenceFromExaResult);
  } catch (error) {
    console.error("[exa] collect failed:", error);
    onTransientFailure?.(error);
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
    // Exa text 最多只取配置的正文片段，因此仍标 excerpt；回源成功才升级
    // fulltext，但实质片段可由证据门禁另行判定为“正文级资料”。
    materialKind: "excerpt",
    discoveryMethod: "exa"
  };
}

/**
 * Search feeds are discovery tools, not evidence by themselves. Before writing,
 * keep only body-level material and require an explicit topic/entity anchor when
 * the request contains one. This prevents a broad “2026 H2 market risk” query
 * from feeding Vietnam stocks or global real estate into a South Korea article.
 */
export function selectWritingEvidence(evidence: EvidenceItem[], keyword: string) {
  const bodyLevel = evidence.filter((item) => isBodyLevelEvidence(item));
  const anchors = researchAnchorPatterns(keyword);
  const topicPatterns = researchTopicPatterns(keyword);
  const relevant = bodyLevel.filter((item) => {
    const heading = `${item.title}\n${item.sourceName}`;
    const text = `${heading}\n${item.summary}`;
    const hasEveryEntity = anchors.every((pattern) =>
      pattern.test(heading) || countPatternMatches(item.summary, pattern) >= 2
    );
    const hasCoreTopic = !topicPatterns.length || topicPatterns.some((pattern) => pattern.test(text));
    return hasEveryEntity && hasCoreTopic;
  });
  return selectSubstantiveEvidenceItems(relevant);
}

/**
 * Historical research inventories predate the trusted-evidence manifest and
 * must be treated as discovery candidates only. Fetch every candidate again,
 * admit only current substantive page bodies, then let selectWritingEvidence
 * apply the normal topic/entity filter. Failed or blocked pages are omitted;
 * their archived excerpt is never promoted merely because it was persisted.
 */
export async function revalidateArchivedEvidence(
  candidates: EvidenceItem[],
  maxFetches = 8,
  onTransientFailure?: (error: unknown) => void
) {
  const seen = new Set<string>();
  const distinct = candidates.filter((item) => {
    const key = normalizeEvidenceUrl(item.url);
    if (!key || !/^https?:\/\//i.test(item.url) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(0, maxFetches));

  const admitted: EvidenceItem[] = [];
  for (let offset = 0; offset < distinct.length; offset += 3) {
    const batch = await Promise.all(distinct.slice(offset, offset + 3).map(async (item) => {
      try {
        const scraped = await scrapeWebPage(item.url);
        const finalUrl = scraped.finalUrl || item.url;
        const fetchedTitle = scraped.title?.trim() || hostFromUrl(finalUrl) || "原始来源";
        const assessment = assessSourceSufficiency({
          url: finalUrl,
          title: fetchedTitle,
          content: scraped.content,
          markdown: scraped.markdown
        });
        if (!assessment.ok) return null;
        const summary = clipRevalidatedEvidenceText(
          sanitizeRevalidatedEvidence(selectRicherEvidenceBody(scraped.markdown, scraped.content)),
          5000
        );
        if (!summary) return null;
        return {
          title: fetchedTitle,
          url: finalUrl,
          // Legacy title/source/date metadata came from an ambiguous Markdown
          // block. Keep only the independently fetched page title and canonical
          // host; otherwise a forged source label could satisfy topic anchors.
          sourceName: hostFromUrl(finalUrl) || "原始来源",
          summary,
          materialKind: "fulltext" as const
        };
      } catch (error) {
        console.error(`[research-revalidate] evidence fetch failed ${item.url}:`, error);
        onTransientFailure?.(error);
        return null;
      }
    }));
    for (const item of batch) {
      if (item) admitted.push(item);
    }
  }

  const seenFinal = new Set<string>();
  return admitted.filter((item) => {
    const key = normalizeEvidenceUrl(item.url);
    if (!key || seenFinal.has(key)) return false;
    seenFinal.add(key);
    return true;
  });
}

function sanitizeRevalidatedEvidence(markdown: string) {
  return markdown
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    .replace(/\[([^\]]+)]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/<https?:\/\/[^>\s]+>/gi, " ")
    .replace(/https?:\/\/[^\s<>"'”’)\]}，。；！？]+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clipRevalidatedEvidenceText(value: string, limit: number) {
  if (value.length <= limit) return value;
  const head = value.slice(0, limit);
  const floor = Math.floor(limit * 0.72);
  const paragraph = head.lastIndexOf("\n\n");
  if (paragraph >= floor) return head.slice(0, paragraph).trimEnd();
  const sentence = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"), head.lastIndexOf(". "));
  return head.slice(0, sentence >= floor ? sentence + 1 : limit).trimEnd();
}

function researchAnchorPatterns(keyword: string) {
  const mappings: Array<[RegExp, RegExp]> = [
    [/(?:韩国|南韩)/i, /(?:south\s+)?korea|korean|kospi|seoul|韩国|한국/i],
    [/(?:三星)/i, /samsung|三星|삼성/i],
    [/(?:日本)/i, /japan|japanese|nikkei|tokyo|日本|日本語/i],
    [/(?:欧洲|欧盟|欧元区)/i, /europe|european|eurozone|\beu\b|欧洲|欧盟/i],
    [/(?:美国)/i, /united\s+states|american|\bu\.?s\.?\b|美国/i],
    [/(?:中国|中国大陆)/i, /china|chinese|中国/i],
    [/(?:英伟达|NVIDIA)/i, /nvidia|英伟达/i],
    [/(?:台积电|TSMC)/i, /tsmc|taiwan\s+semiconductor|台积电/i],
    [/(?:苹果|Apple)/i, /\bapple\b|苹果/i],
    [/(?:OpenAI)/i, /openai/i]
  ];
  return mappings.filter(([needle]) => needle.test(keyword)).map(([, anchor]) => anchor);
}

function researchTopicPatterns(keyword: string) {
  const mappings: Array<[RegExp, RegExp]> = [
    [/(?:股市|股票|股价|KOSPI|证券市场)/i, /stock|equities|equity\s+market|shares|kospi|股市|股票|股价|증시/i],
    [/(?:半导体|芯片)/i, /semiconductor|chips?|半导体|芯片|반도체/i],
    [/(?:外资|外资流向|外国投资者)/i, /foreign\s+(?:investor|capital|fund)|capital\s+flows?|外资|外国投资者|외국인/i],
    [/(?:估值)/i, /valuation|price[- ]to[- ]earnings|\bp\/?e\b|估值|밸류에이션/i],
    [/(?:出口)/i, /exports?|出口|수출/i],
    [/(?:消费电子)/i, /consumer\s+electronics|消费电子/i],
    [/(?:市场情绪)/i, /market\s+sentiment|investor\s+sentiment|市场情绪/i]
  ];
  return mappings.filter(([needle]) => needle.test(keyword)).map(([, topic]) => topic);
}

function countPatternMatches(value: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return value.match(new RegExp(pattern.source, flags))?.length || 0;
}

/**
 * 抓取器同时返回纯文本与 Turndown Markdown。少数站点的正文节点里有复杂组件，
 * 会出现“纯文本完整、Markdown 只剩标题”的情况；写作证据必须选择可见信息更
 * 多的一份，不能仅因 markdown 是非空字符串就丢掉真正的正文。
 */
export function selectRicherEvidenceBody(markdown: string | null | undefined, content: string | null | undefined) {
  const markdownValue = markdown || "";
  const contentValue = content || "";
  return visibleInformationLength(markdownValue) >= visibleInformationLength(contentValue)
    ? markdownValue
    : contentValue;
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

async function collectFromSavedSources(
  keyword: string,
  scope: ResearchScope,
  opts?: { topicId?: string | null; onTransientFailure?: (error: unknown) => void }
) {
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
    const items = await safeFetchSourceItems(source, opts?.onTransientFailure);
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

async function collectFromSearchFeeds(
  queries: string[],
  scope: ResearchScope,
  onTransientFailure?: (error: unknown) => void
) {
  const feeds = buildSearchFeeds(queries, scope);
  const evidence: EvidenceItem[] = [];

  for (const feed of feeds) {
    try {
      const items = await fetchRss(feed.url);
      // 每条查询最多取 3 条，给“最新进展 / 官方原始资料 / 独立报道”三类
      // 查询都留下靠前位置；否则第一条宽泛查询的 6 个结果会吃完后续正文
      // 抓取预算，官方资料虽被搜到却永远轮不到回源。
      for (const item of items.slice(0, 3)) {
        const parsedTitle = splitGoogleNewsTitle(item.title);
        evidence.push({
          title: parsedTitle.title,
          url: item.link,
          sourceName: parsedTitle.publisher || feed.name,
          summary: item.summary || item.title,
          publishedAt: item.date,
          materialKind: "excerpt" as const,
          discoveryMethod: feed.kind || ("google-news" as const)
        });
        if (evidence.length >= 10) return evidence;
      }
    } catch (error) {
      console.error(`Search feed failed ${feed.url}:`, error);
      onTransientFailure?.(error);
    }
  }

  return evidence;
}

function splitGoogleNewsTitle(title: string) {
  const match = title.match(/^(.*?)\s+[\-—–]\s+([^\-—–]{2,80})$/);
  if (!match) return { title, publisher: "" };
  return { title: match[1].trim() || title, publisher: match[2].trim() };
}

async function safeFetchSourceItems(source: Source, onTransientFailure?: (error: unknown) => void) {
  try {
    const items = await fetchRss(source.url);
    await recordSourceSuccess(source.id);
    return items;
  } catch (error) {
    console.error(`Source RSS failed ${source.name}:`, error);
    // 列表抓取失败必须在这里单独记账：聚合流程靠其余来源照常成功，任务
    // 不会失败，failStreak 走不到任务级记账，死源就永远不会被自动暂停。
    await recordSourceFailure(source.id);
    onTransientFailure?.(error);
    return [];
  }
}

export function normalizeSearchQueries(value: string[] | undefined, keyword: string) {
  const candidates = [...(value || []), keyword];
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const query = String(candidate || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    if (query.length < 3) continue;
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length >= 4) break;
  }
  return queries;
}

export function buildSearchFeeds(queries: string[], scope: ResearchScope) {
  const domesticSites = ["news.cn", "people.com.cn", "cctv.com", "thepaper.cn", "caixin.com"];
  const internationalSites = ["bbc.com", "reuters.com", "apnews.com", "theguardian.com", "npr.org", "theverge.com"];
  const cleanedQueries = normalizeSearchQueries(queries, "").slice(0, 3);
  const freshnessQueries = cleanedQueries.length ? [cleanedQueries[0], `${cleanedQueries[0]} when:365d`] : [];
  const feedQueries = normalizeSearchQueries([...cleanedQueries, ...freshnessQueries], "");
  const feeds: Array<{ name: string; url: string; kind?: "google-news" | "bing-news" }> = [];

  if (scope !== "international") {
    for (const query of feedQueries) {
      feeds.push({
        name: "[搜索] Google News 中文",
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
      });
    }
    for (const site of domesticSites.slice(0, 3)) {
      const query = cleanedQueries[0];
      if (!query) break;
      feeds.push({
        name: `[搜索] ${site}`,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} site:${site}`)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
      });
    }
  }

  if (scope !== "domestic") {
    for (const query of feedQueries) {
      // 国际选题不等于只能用英文界面搜索。模型查询扩展偶发失败时，输入仍
      // 可能是中文；Google News 的 en-US 端会把多个中文词近似当作严格
      // AND 条件并返回 0 条，而 zh-CN 端可以正常发现同一国际议题的报道。
      // 这里只增加发现入口，后续仍必须回源抓到合格正文，RSS 摘要不能成稿。
      if (containsCjk(query)) {
        feeds.push({
          name: "[搜索] Google News 中文国际",
          url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
        });
      }
      feeds.push({
        name: "[搜索] Google News Global",
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
      });
    }
    const siteSeed = cleanedQueries.find((query) => !containsCjk(query)) || cleanedQueries[0];
    for (const site of internationalSites.slice(0, 4)) {
      const query = siteSeed;
      if (!query) break;
      feeds.push({
        name: `[搜索] ${site}`,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} site:${site}`)}&hl=en-US&gl=US&ceid=US:en`
      });
    }
  }

  // Bing News 追加在队尾，作为 Google News 的独立兜底通道：collectFromSearchFeeds
  // 顺序消费且集满即停，Google 正常时这些请求根本不会发出；Google 被限流/无结果时
  // （尤其未配置 Exa 的部署里它是唯一发现通道）Bing 能顶上。中英文查询都可用同一
  // 端点（setmkt 参数反而会让 Bing 返回非 RSS 响应，勿加）。
  for (const query of cleanedQueries.slice(0, 2)) {
    feeds.push({
      name: "[搜索] Bing News",
      url: `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
      kind: "bing-news"
    });
  }

  return feeds;
}

function containsCjk(value: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
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
