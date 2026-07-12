import type { EvidenceItem } from "./ai";

// 来源质量门禁：在写稿流水线里拦下 401/403/404、验证码、Cloudflare 拦截页等
// "看起来抓到了内容、其实是错误页"的材料，避免 AI 把访问受限提示写成文章。

export type SourceMaterial = {
  url?: string | null;
  title?: string | null;
  content?: string | null;
  markdown?: string | null;
  httpStatus?: number | null;
};

export type SourceAssessment =
  | { ok: true }
  | { ok: false; reason: string };

type ParsedReferenceList =
  | { ok: true; urls: string[] }
  | { ok: false; reason: string };

export type GeneratedArticleAssessmentOptions = {
  allowedSourceUrls?: string[];
  requireInlineCitation?: boolean;
  requireSectionHeadings?: boolean;
};

export class InvalidSourceMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSourceMaterialError";
  }
}

/** 来源暂时不可用（限流、5xx 等）；应由队列重试，不能当成坏素材永久跳过。 */
export class RetryableSourceFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryableSourceFetchError";
  }
}

/** 模型已经返回内容，但成稿未达到发布门槛；这不代表原始来源有问题。 */
export class UnpublishableGeneratedArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnpublishableGeneratedArticleError";
  }
}

const BLOCKED_STATUS_REASONS: Record<number, string> = {
  401: "来源页面需要授权访问",
  403: "来源页面返回 403 Forbidden，访问受限",
  404: "来源页面返回 404 Not Found",
  410: "来源页面已不可用",
  429: "来源页面触发限流",
  451: "来源页面因访问限制不可用",
  500: "来源站点返回服务器错误",
  502: "来源站点返回网关错误",
  503: "来源站点服务不可用",
  504: "来源站点网关超时"
};

const ERROR_TITLE_COMPACT_RE =
  /^(?:error)?(?:40[134]|410|429|451|50[0234])(?:forbidden|unauthorized|notfound|accessdenied|serviceunavailable|badgateway|gatewaytimeout)?$|^(?:forbidden|accessdenied|notfound|unauthorized|serviceunavailable|badgateway|gatewaytimeout)$/i;

const ERROR_PAGE_RE =
  /\b(?:401\s*unauthorized|410\s*gone|429\s*too\s*many\s*requests|451\s*unavailable|500\s*internal\s*server\s*error|502\s*bad\s*gateway|503\s*service\s*unavailable|504\s*gateway\s*timeout|access\s*denied|forbidden|not\s*found|captcha|enable\s+javascript|just\s+a\s+moment|attention\s+required|cloudflare|zen\/\d+(?:\.\d+)?)\b|(?:禁止访问|访问受限|无权访问|页面不存在|网页不存在|验证码|请启用\s*javascript|服务器错误|服务不可用)/i;

const GENERATED_INVALID_RE =
  /(?:无法形成.*(?:新闻|报道|文章)|未提供任何新闻正文|无法核验|资料不足以确认|可用材料并未呈现|不是完整新闻内容|访问受限提示|事实风险|不能作为.*(?:报道|文章)|INVALID_SOURCE)/i;

const INSUFFICIENT_EVIDENCE_RE = /^[`'"“”‘’「『]*INSUFFICIENT_EVIDENCE\s*:/i;
const BOILERPLATE_HEADING_RE = /^##\s*(?:摘要|关键点|核心要点|背景|影响|结论|未来展望|未确认问题|仍需确认的问题|阅读提示)\s*$/gim;
const GENERIC_BLOG_HEADING_RE = /^##\s*(?:为什么(?:这件事|它)?值得(?:看|关注)|风险边界|企业落地方式|落地方式|仍需观察的问题|未来值得关注|写在最后)\s*$/gim;
const META_CAVEAT_RE = /(?:来源材料|本次材料|现有材料|资料不足以确认|仍需(?:进一步)?确认|来源未提及|材料未提供|无法从(?:材料|来源)确认)/g;
const MECHANICAL_PROSE_RE = /(?:值得注意的是|需要指出的是|不难发现|显而易见|真正重要的是|更稳妥的做法是|从这个角度来看|总体来看|综上所述|这不仅[^。！？]{0,36}更[^。！？]{0,36})/g;
const PROCESS_LEAK_RE = /(?:用户|系统|提示词)(?:要求|指示)我|我(?:需要|将|会)(?:先|首先)?(?:分析|整理|撰写|审校|核查|生成|改写)|作为(?:一个)?AI助手|作为(?:一个)?(?:语言)?模型[，,]?(?:我|本助手)/i;
const FACT_ACTION_RE = /(?:发布|宣布|确认|披露|表示|指出|报告|规定|要求|批准|签署|推出|上线|下线|开放|关闭|增长|下降|增加|减少|收购|投资|裁员|完成|开始|结束|计划|预计|发生|显示|发现|支持|适用|迁移|实施|执行|提交|回应|announc(?:e|ed|es|ing)|confirm(?:ed|s|ing)?|report(?:ed|s|ing)?|publish(?:ed|es|ing)?|launch(?:ed|es|ing)?|increase(?:d|s|ing)?|decrease(?:d|s|ing)?|acquir(?:e|ed|es|ing)|invest(?:ed|s|ing)?|require(?:d|s|ing)?|approve(?:d|s|ing)?|show(?:ed|s|ing)?|find(?:s|ing)?|found)/i;
const PRECISE_FACT_RE = /(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|％|美元|元|万元|亿元|人|家|项|次|天|周|月|年|日|小时|分钟)|\d{4}[年\-/]\d{1,2}|百分之[零〇一二三四五六七八九十百千万\d]+|(?:今天|昨日|昨天|明天|明年|今年|上周|本周|下周|上月|本月|下月)|[“「『][^”」』\r\n]{2,120}[”」』]|\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s*(?:percent|people|companies|days?|weeks?|months?|years?|hours?|minutes?|million|billion|trillion|usd|rmb)\b)/i;

export function assessSourceMaterial(input: SourceMaterial): SourceAssessment {
  const status = normalizeStatus(input.httpStatus);
  if (status && status >= 400) {
    return { ok: false, reason: BLOCKED_STATUS_REASONS[status] || `来源页面返回 HTTP ${status}` };
  }

  const title = normalizeWhitespace(input.title || "");
  const body = normalizeWhitespace([input.markdown, input.content].filter(Boolean).join("\n"));
  if (!title && !body) return { ok: false, reason: "来源材料为空" };

  const titleLooksLikeError = isErrorTitle(title);
  const bodyLooksLikeError = ERROR_PAGE_RE.test(body);
  const looksLikeError = bodyLooksLikeError || ERROR_PAGE_RE.test(title);
  const bodyInfoLength = informationLength(body);
  const totalInfoLength = bodyInfoLength + informationLength(title);

  if (titleLooksLikeError && (bodyInfoLength < 280 || bodyLooksLikeError)) {
    return { ok: false, reason: "来源材料是错误页或访问受限提示，不是新闻正文" };
  }

  if (looksLikeError && totalInfoLength < 80) {
    return { ok: false, reason: "来源材料正文过短且只包含错误页提示" };
  }

  return { ok: true };
}

export function assertUsableSourceMaterial(input: SourceMaterial) {
  const status = normalizeStatus(input.httpStatus);
  if (status && isRetryableSourceStatus(status)) {
    throw new RetryableSourceFetchError(BLOCKED_STATUS_REASONS[status] || `来源页面返回 HTTP ${status}`);
  }
  const assessment = assessSourceMaterial(input);
  if (!assessment.ok) throw new InvalidSourceMaterialError(assessment.reason);
}

/**
 * “能抓到”不等于“足够写博客”。这里拦截标题加省略号、短摘要和明显导航页，
 * 避免模型把几十个字扩成一篇充满免责声明的伪长文。
 */
export function assessSourceSufficiency(
  input: SourceMaterial,
  options: { minInformationChars?: number } = {}
): SourceAssessment {
  const usable = assessSourceMaterial(input);
  if (!usable.ok) return usable;

  // content 与 markdown 通常是同一正文的两种表示，不能相加后把信息量算两遍，
  // 取信息量更大的那份作为正文。
  const markdownBody = input.markdown || "";
  const contentBody = input.content || "";
  const body = informationLength(stripMarkup(markdownBody)) >= informationLength(stripMarkup(contentBody))
    ? markdownBody
    : contentBody;
  const uniqueText = uniqueEvidenceText(body);
  const infoChars = informationLength(uniqueText);
  const minInformationChars = options.minInformationChars ?? 500;
  if (infoChars < minInformationChars) {
    return {
      ok: false,
      reason: `来源正文有效信息仅约 ${infoChars} 个字符，不足以支撑专业博客（至少 ${minInformationChars}）`
    };
  }

  const compact = normalizeWhitespace(stripMarkup(body));
  if (/^(?:\.{3,}|…+|(?:read|learn)\s+more)$/i.test(compact)) {
    return { ok: false, reason: "来源只有省略号或跳转提示，没有可成文的正文" };
  }

  const markdownLinks = body.match(/\[[^\]]+]\([^)]+\)/g)?.length || 0;
  if (markdownLinks >= 12 && looksLikeIndexUrl(input.url)) {
    const linkText = [...body.matchAll(/\[([^\]]+)]\([^)]+\)/g)].map((match) => match[1]).join(" ");
    const linkTextRatio = informationLength(linkText) / Math.max(infoChars, 1);
    if (infoChars < markdownLinks * 80 || linkTextRatio > 0.35) {
      return { ok: false, reason: "来源更像首页或频道导航，不是单篇正文" };
    }
  }

  if (factBearingSegments(uniqueText).length < 2) {
    return { ok: false, reason: "来源缺少至少两个可核验的具体事实信号，不能仅凭重复描述或宣传语成文" };
  }

  return { ok: true };
}

export function assertSufficientSourceMaterial(
  input: SourceMaterial,
  options?: { minInformationChars?: number }
) {
  const status = normalizeStatus(input.httpStatus);
  if (status && isRetryableSourceStatus(status)) {
    throw new RetryableSourceFetchError(BLOCKED_STATUS_REASONS[status] || `来源页面返回 HTTP ${status}`);
  }
  const assessment = assessSourceSufficiency(input, options);
  if (!assessment.ok) throw new InvalidSourceMaterialError(assessment.reason);
}

export function isUsableSourceMaterial(input: SourceMaterial) {
  return assessSourceMaterial(input).ok;
}

export function filterUsableEvidenceItems<T extends Pick<EvidenceItem, "title" | "summary">>(items: T[]): T[] {
  return items.filter((item) =>
    isUsableSourceMaterial({
      title: item.title,
      content: item.summary
    })
  );
}

export function assessEvidenceSufficiency<
  T extends Pick<EvidenceItem, "title" | "summary" | "url"> & { materialKind?: "fulltext" | "excerpt" }
>(
  items: T[],
  options: {
    minItems?: number;
    minTotalInformationChars?: number;
    minItemInformationChars?: number;
    strongSingleItemChars?: number | null;
    minFullTextItems?: number;
  } = {}
): SourceAssessment {
  const minItems = options.minItems ?? 2;
  const minTotal = options.minTotalInformationChars ?? 900;
  const minItem = options.minItemInformationChars ?? 140;
  const strongSingle = options.strongSingleItemChars === undefined ? 900 : options.strongSingleItemChars;
  const minFullTextItems = options.minFullTextItems ?? 1;
  const seen = new Set<string>();
  const seenContent = new Set<string>();
  const lengths: number[] = [];
  let fullTextItems = 0;

  for (const item of filterUsableEvidenceItems(items)) {
    const key = normalizeUrl(item.url) || item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    const uniqueText = uniqueEvidenceText(item.summary);
    const contentKey = evidenceFingerprint(uniqueText);
    if (!contentKey || seenContent.has(contentKey)) continue;
    const assessment = assessSourceSufficiency(
      { url: item.url, title: item.title, markdown: item.summary },
      { minInformationChars: minItem }
    );
    if (!assessment.ok) continue;
    seenContent.add(contentKey);
    const length = informationLength(uniqueText);
    lengths.push(length);
    if (item.materialKind === "fulltext") {
      fullTextItems++;
    }
  }

  const total = lengths.reduce((sum, length) => sum + Math.min(length, 2000), 0);
  const strongest = lengths.length ? Math.max(...lengths) : 0;
  if (fullTextItems < minFullTextItems) {
    return { ok: false, reason: `只有 ${fullTextItems} 条正文级资料，至少需要 ${minFullTextItems} 条` };
  }
  if (strongSingle !== null && strongest >= strongSingle) return { ok: true };
  if (lengths.length < minItems) {
    return { ok: false, reason: `只有 ${lengths.length} 条实质资料，至少需要 ${minItems} 条` };
  }
  if (total < minTotal) {
    return { ok: false, reason: `资料有效信息合计约 ${total} 个字符，至少需要 ${minTotal}` };
  }
  return { ok: true };
}

export function assessGeneratedArticle(
  markdown: string,
  options: GeneratedArticleAssessmentOptions = {}
): SourceAssessment {
  if (/^INVALID_SOURCE$/i.test(markdown.trim())) {
    return { ok: false, reason: "AI 判定来源无效" };
  }
  if (INSUFFICIENT_EVIDENCE_RE.test(markdown.trim())) {
    return { ok: false, reason: markdown.trim().slice(0, 240) };
  }

  const text = normalizeWhitespace(stripMarkdown(markdown));
  if (!text) return { ok: false, reason: "AI 生成内容为空" };

  if (ERROR_PAGE_RE.test(text) && GENERATED_INVALID_RE.test(text)) {
    return { ok: false, reason: "AI 生成结果只是错误页/无效来源说明，不能作为文章发布" };
  }

  const firstLine = markdown.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
  if (!/^#\s+\S/.test(firstLine)) {
    return { ok: false, reason: "成稿缺少置于首行的 Markdown 一级标题" };
  }

  const referencesMatch = markdown.match(/^##\s*参考来源\s*$/im);
  if (!referencesMatch || referencesMatch.index === undefined) {
    return { ok: false, reason: "成稿缺少文末“参考来源”章节" };
  }
  const body = markdown.slice(0, referencesMatch.index);
  const references = markdown.slice(referencesMatch.index + referencesMatch[0].length);
  if (informationLength(stripMarkdown(body)) < 350) {
    return { ok: false, reason: "正文有效信息过少，不能作为完整博客发布" };
  }
  if (options.requireSectionHeadings !== false && !/^##\s+\S+/m.test(body)) {
    return { ok: false, reason: "正文没有任何有意义的二级小节" };
  }

  const parsedReferences = parseReferenceList(references);
  if (!parsedReferences.ok) return parsedReferences;
  const referenceUrls = parsedReferences.urls;
  const normalizedReferenceUrls = referenceUrls.map(normalizeUrl);
  if (new Set(normalizedReferenceUrls).size !== normalizedReferenceUrls.length) {
    return { ok: false, reason: "参考来源包含重复链接" };
  }
  const bodyUrls = extractHttpUrls(body);
  if (options.requireInlineCitation && !bodyUrls.length) {
    return { ok: false, reason: "正文关键事实没有就近来源链接" };
  }
  if (options.requireInlineCitation) {
    const bodyUrlSet = new Set(bodyUrls.map(normalizeUrl));
    const referenceUrlSet = new Set(referenceUrls.map(normalizeUrl));
    const unusedReference = referenceUrls.find((url) => !bodyUrlSet.has(normalizeUrl(url)));
    if (unusedReference) return { ok: false, reason: `参考来源未在正文实际使用：${unusedReference}` };
    const unindexedBodySource = bodyUrls.find((url) => !referenceUrlSet.has(normalizeUrl(url)));
    if (unindexedBodySource) return { ok: false, reason: `正文来源未列入参考来源：${unindexedBodySource}` };
    const uncitedFactParagraph = findUncitedPrecisionFactParagraph(body);
    if (uncitedFactParagraph) {
      return { ok: false, reason: `包含精确事实的段落缺少就近来源链接：${uncitedFactParagraph}` };
    }
  }

  if (options.allowedSourceUrls?.length) {
    const allowed = new Set(options.allowedSourceUrls.map(normalizeUrl).filter(Boolean));
    const invented = extractHttpUrls(markdown).find((url) => !allowed.has(normalizeUrl(url)));
    if (invented) return { ok: false, reason: `成稿使用了资料之外的链接：${invented}` };
  }

  const boilerplateHeadings = markdown.match(BOILERPLATE_HEADING_RE)?.length || 0;
  if (boilerplateHeadings >= 3) {
    return { ok: false, reason: "成稿仍在套用“摘要—关键点—背景—影响”式固定模板" };
  }
  const genericBlogHeadings = markdown.match(GENERIC_BLOG_HEADING_RE)?.length || 0;
  if (genericBlogHeadings >= 2) {
    return { ok: false, reason: "成稿使用了多个泛化博客小标题，主题组织仍有明显人机味" };
  }
  const metaCaveats = markdown.match(META_CAVEAT_RE)?.length || 0;
  if (metaCaveats >= 4) {
    return { ok: false, reason: "成稿反复谈论资料缺失，信息密度不足且人机味明显" };
  }
  const mechanicalPhrases = body.match(MECHANICAL_PROSE_RE)?.length || 0;
  if (mechanicalPhrases >= 4) {
    return { ok: false, reason: "成稿机械连接词和伪权威句式过密，文字仍有明显人机味" };
  }

  if (PROCESS_LEAK_RE.test(body)) {
    return { ok: false, reason: "成稿泄露了模型任务或写作过程" };
  }

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => normalizeWhitespace(stripMarkdown(paragraph)))
    .filter((paragraph) => informationLength(paragraph) >= 50);
  if (new Set(paragraphs).size !== paragraphs.length) {
    return { ok: false, reason: "成稿包含完全重复的正文段落" };
  }

  return { ok: true };
}

export function assertPublishableGeneratedArticle(
  markdown: string,
  options?: GeneratedArticleAssessmentOptions
) {
  const assessment = assessGeneratedArticle(markdown, options);
  if (!assessment.ok) throw new UnpublishableGeneratedArticleError(assessment.reason);
}

function normalizeStatus(value: number | null | undefined) {
  if (!Number.isFinite(value)) return null;
  return Math.floor(Number(value));
}

export function isRetryableSourceStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 504);
}

function isErrorTitle(title: string) {
  if (!title) return false;
  const compact = title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\s_\-—–|:：/\\()[\]{}"'“”‘’.,，。!?！？;；]+/g, "");
  return ERROR_TITLE_COMPACT_RE.test(compact);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function informationLength(value: string) {
  return value.match(/[\p{L}\p{N}]/gu)?.length || 0;
}

function stripMarkdown(value: string) {
  // 图片语法已在 stripNonCitationRegions 里剥除，这里不再重复。
  return stripNonCitationRegions(value)
    .replace(/\[([^\]]+)]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~#-]+/g, " ");
}

function uniqueEvidenceText(value: string) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const segment of evidenceSegments(value)) {
    const key = segment.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(segment);
  }
  return unique.join("\n");
}

function evidenceSegments(value: string) {
  return stripMarkup(value)
    .split(/(?:\r?\n)+|[。！？!?；;]+|(?<=\w)\.\s+/)
    .map(normalizeWhitespace)
    .filter((segment) => informationLength(segment) >= 10);
}

function factBearingSegments(value: string) {
  return evidenceSegments(value).filter((segment) => FACT_ACTION_RE.test(segment) || PRECISE_FACT_RE.test(segment));
}

function evidenceFingerprint(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 4000);
}

function parseReferenceList(value: string): ParsedReferenceList {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, reason: "参考来源章节没有有效 HTTP(S) 链接" };

  const urls: string[] = [];
  for (const line of lines) {
    const item = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (!item) {
      return { ok: false, reason: "参考来源必须置于文末，并使用每项仅含一个链接的 Markdown 列表" };
    }
    const content = item[1].trim();
    const markdownLink = content.match(/^\[([^\]\r\n]{1,160})]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)$/i);
    const autoLink = content.match(/^<(https?:\/\/[^<>\s]+)>$/i);
    const bareLink = content.match(/^(https?:\/\/\S+)$/i);
    const url = markdownLink?.[2] || autoLink?.[1] || bareLink?.[1];
    if (!url || (markdownLink && informationLength(markdownLink[1]) > 80)) {
      return { ok: false, reason: "参考来源必须置于文末，每个列表项只能包含链接和简短来源标题，不能追加正文" };
    }
    urls.push(trimBareUrlPunctuation(url));
  }

  return { ok: true, urls };
}

function findUncitedPrecisionFactParagraph(body: string) {
  let previousParagraphHadCitation = false;
  for (const rawParagraph of body.split(/\n\s*\n/)) {
    const trimmed = rawParagraph.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed)) continue;
    const paragraphUrls = extractHttpUrls(rawParagraph);
    const text = normalizeWhitespace(stripMarkdown(rawParagraph));
    if (informationLength(text) < 20) continue;
    const containsPrecisionFact = PRECISE_FACT_RE.test(text) && FACT_ACTION_RE.test(text);
    if (containsPrecisionFact && !paragraphUrls.length && !previousParagraphHadCitation) {
      return text.slice(0, 100);
    }
    previousParagraphHadCitation = paragraphUrls.length > 0;
  }
  return null;
}

function stripNonCitationRegions(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\r\n]*`/g, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ");
}

function stripMarkup(value: string) {
  return stripMarkdown(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/**
 * 提取所有会在 Markdown 正文中形成外链的 HTTP(S) URL。
 *
 * 分阶段提取并遮掉已匹配片段，避免 `[文字](https://...)` 同时被裸 URL
 * 扫描重复计数；不同位置真正重复出现的链接仍会保留，供参考来源去重门禁使用。
 */
function extractHttpUrls(value: string) {
  const urls: string[] = [];
  let remaining = stripNonCitationRegions(value).replace(
    /\[[^\]]*]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/gi,
    (match, url: string) => {
      urls.push(url);
      return " ".repeat(match.length);
    }
  );

  remaining = remaining.replace(/<(https?:\/\/[^<>\s]+)>/gi, (match, url: string) => {
    urls.push(url);
    return " ".repeat(match.length);
  });

  for (const match of remaining.matchAll(/https?:\/\/[^\s<>"'`“”‘’，。；：！？、（）［］｛｝【】《》「」]+/gi)) {
    const url = trimBareUrlPunctuation(match[0]);
    if (url) urls.push(url);
  }
  return urls;
}

function trimBareUrlPunctuation(value: string) {
  let url = value.replace(/[.,;:!?]+$/g, "");
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    while (url.endsWith(close) && countCharacter(url, close) > countCharacter(url, open)) {
      url = url.slice(0, -1);
    }
  }
  return url;
}

function countCharacter(value: string, character: string) {
  let count = 0;
  for (const current of value) {
    if (current === character) count++;
  }
  return count;
}

/**
 * 全站统一的「同一 URL」判定：去 hash、去跟踪参数（utm_ 系、fbclid、gclid、
 * mc_cid、mc_eid）、host 小写、去尾斜杠。引用校验门、证据去重和 RSS 防重发
 * 都必须用同一套规则，否则对「这两个链接是不是同一篇」会得出互相矛盾的结论。
 */
export function normalizeUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

function looksLikeIndexUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const pathname = new URL(value).pathname;
    return pathname === "/" || pathname.endsWith("/") || /\/(?:index|home)(?:\.[a-z]+)?$/i.test(pathname);
  } catch {
    return false;
  }
}
