import { Marked } from "marked";
import type { EvidenceItem } from "./ai";
import { generationPublicationBlockReason } from "./publication-policy";

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
  minimumDistinctInlineSources?: number;
  /** 短稿/评论可以更紧凑，但仍需保留同一套来源与引用门禁。 */
  minimumBodyInformationChars?: number;
  /**
   * 管理员复核已经入库的文章时，允许由本站图片工具生成的本地 figure。
   * Worker 初次审稿不得开启，避免模型自行伪造“受信媒体”HTML。
   */
  allowTrustedLocalMediaFigures?: boolean;
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
  /\b(?:401\s*unauthorized|410\s*gone|429\s*too\s*many\s*requests|451\s*unavailable|500\s*internal\s*server\s*error|502\s*bad\s*gateway|503\s*service\s*unavailable|504\s*gateway\s*timeout|access\s*denied|forbidden|not\s*found|captcha|enable\s+javascript|just\s+a\s+moment|attention\s+required|checking\s+your\s+browser|zen\/\d+(?:\.\d+)?)\b|(?:禁止访问|访问受限|无权访问|页面不存在|网页不存在|验证码|请启用\s*javascript|服务器错误|服务不可用)/i;

const GENERATED_INVALID_RE =
  /(?:无法形成.*(?:新闻|报道|文章)|未提供任何新闻正文|无法核验|资料不足以确认|可用材料并未呈现|不是完整新闻内容|访问受限提示|事实风险|不能作为.*(?:报道|文章)|INVALID_SOURCE)/i;

const INSUFFICIENT_EVIDENCE_RE = /^[`'"“”‘’「『]*INSUFFICIENT_EVIDENCE\s*:/i;
const BOILERPLATE_HEADING_RE = /^##\s*(?:摘要|关键点|核心要点|背景|影响|结论|未来展望|未确认问题|仍需确认的问题|阅读提示)\s*$/gim;
const GENERIC_BLOG_HEADING_RE = /^##\s*(?:为什么(?:这件事|它)?值得(?:看|关注)|风险边界|企业落地方式|落地方式|仍需观察的问题|未来值得关注|写在最后)\s*$/gim;
const META_CAVEAT_RE = /(?:来源材料|本次材料|现有材料|资料不足以确认|仍需(?:进一步)?确认|来源未提及|材料未提供|无法从(?:材料|来源)确认)/g;
const MECHANICAL_PROSE_RE = /(?:值得注意的是|需要指出的是|不难发现|显而易见|真正重要的是|更稳妥的做法是|从这个角度来看|总体来看|综上所述|这不仅[^。！？]{0,36}更[^。！？]{0,36})/g;
const PROCESS_LEAK_RE = /(?:用户|系统|提示词)(?:要求|指示)我|我(?:需要|将|会)(?:先|首先)?(?:分析|整理|撰写|审校|核查|生成|改写)|作为(?:一个)?AI助手|作为(?:一个)?(?:语言)?模型[，,]?(?:我|本助手)/i;
// 「史上最大 IPO」这类可核验的纪录表述不算诱饵，由事实引用门禁负责；这里
// 只拦真正的营销模板词。
const CLICKBAIT_TITLE_RE = /(?:一文读懂|全面解析|重磅|震撼|必看|揭秘|颠覆|终极指南)/i;
const GENERIC_LEAD_RE = /^(?:随着[^\u3002！？]{0,80}(?:发展|进步|普及)|在(?:当今|当下|这个)[^\u3002！？]{0,60}(?:时代|背景下)|近年来|众所周知|本文将|这组资料|这一话题值得关注)/i;
const FACT_ACTION_RE = /(?:发布|宣布|确认|披露|表示|指出|报告|报道|规定|要求|批准|签署|推出|上线|下线|开放|关闭|增长|下降|增加|减少|上涨|下跌|上升|回落|升至|跌至|达到|高达|攀升|飙升|净流入|净流出|流入|流出|撤出|收购|投资|裁员|完成|开始|结束|计划|预计|发生|显示|发现|迁移|实施|执行|提交|回应|announc(?:e|ed|es|ing)|confirm(?:ed|s|ing)?|report(?:ed|s|ing)?|publish(?:ed|es|ing)?|launch(?:ed|es|ing)?|increase(?:d|s|ing)?|decrease(?:d|s|ing)?|rise|rose|risen|fall|fell|fallen|reach(?:ed|es|ing)?|flow(?:ed|s|ing)?|outflow|inflow|withdraw(?:n|s|ing)?|acquir(?:e|ed|es|ing)|invest(?:ed|s|ing)?|require(?:d|s|ing)?|approve(?:d|s|ing)?|show(?:ed|s|ing)?|find(?:s|ing)?|found)/i;
// 无数字的“重大动作”同样可能是模型编造的事实，但不能把“公告列出条件”
// “文章指出边界”这类一般说明全部误判。这里只覆盖会实质改变公司、政策或交易
// 状态的窄谓词；普通发布/分析用语仍由数字、引语和来源列表门禁处理。
const ATTRIBUTABLE_ACTION_RE = /(?:(?:[\p{Script=Han}]{0,18}(?:公司|集团|政府|财政部|央行|银行|法院|委员会|交易所|部长|总统|总理|董事会)|[A-Z][\p{L}\p{N}.&·_-]{1,30}|三星|华为|苹果|微软|谷歌)[^。！？!?\r\n]{0,24}(?:收购|合并|裁员|关闭|停产|破产|撤出|通过|否决|批准|签署)|[\p{Script=Han}A-Z][\p{Script=Han}\p{L}\p{N}.&·_\-\s]{1,28}(?:已经|已|正式|宣布|决定|确认)[^。！？!?\r\n]{0,20}(?:收购|合并|裁员|关闭|停产|破产|撤出|通过|否决|批准|签署)|(?:company|group|government|ministry|minister|court|bank|board|Samsung|Microsoft|Apple|Google|OpenAI)[^.?!\r\n]{0,32}(?:acquir(?:e|ed|es|ing)|merge(?:d|s|ing)?|layoffs?|clos(?:e|ed|es|ing)|shutdown|bankruptcy|withdraw(?:n|s|ing)?|approv(?:e|ed|es|ing)|reject(?:ed|s|ing)?|sign(?:ed|s|ing)?))/iu;
const MAJOR_ACTION_WORD_RE = /(?:收购|合并|裁员|关闭|停产|破产|撤出|通过|否决|批准|签署|acquir(?:e|ed|es|ing)|merge(?:d|s|ing)?|layoffs?|clos(?:e|ed|es|ing)|shutdown|bankruptcy|withdraw(?:n|s|ing)?|approv(?:e|ed|es|ing)|reject(?:ed|s|ing)?|sign(?:ed|s|ing)?)/iu;
const HYPOTHETICAL_ACTION_RE = /(?:如果|若(?:是|果)?|假如|假设|一旦|是否|可能|或许|可考虑|举例|例如|通常|一般而言|if\b|could\b|might\b|would\b|for example)/i;
const PRECISE_FACT_RE = /(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|％|美元|万美元|亿美元|兆美元|元|万元|亿元|万亿元|韩元|万韩元|亿韩元|万亿韩元|点|倍|基点|股|人|家|项|次|天|周|月|年|日|小时|分钟)|\d{4}[年\-/]\d{1,2}|百分之[零〇一二三四五六七八九十百千万\d]+|(?:今天|昨日|昨天|明天|明年|今年|上周|本周|下周|上月|本月|下月)|\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s*(?:percent|points?|basis\s+points?|times?|shares?|won|krw|people|companies|days?|weeks?|months?|years?|hours?|minutes?|million|billion|trillion|usd|rmb)\b)/i;
// 金额、比例、数量等即使没有“宣布/显示”这类动作词，仍然是最容易被模型
// 编造且最需要逐段核验的事实。例如“据报道净撤出 708 亿美元”不能仅凭
// “据报道”三个字绕过引用门禁。
const PRECISE_QUANTITY_RE = /(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|％|美元|万美元|亿美元|兆美元|元|万元|亿元|万亿元|韩元|万韩元|亿韩元|万亿韩元|点|倍|基点|股|人|家|项|次|小时|分钟)|百分之[零〇一二三四五六七八九十百千万\d]+|\b\d+(?:\.\d+)?\s*(?:percent|points?|basis\s+points?|times?|shares?|won|krw|people|companies|hours?|minutes?|million|billion|trillion|usd|rmb)\b)/i;
// 引号也可能只是文章自定义的概念标签（如“本地推理等于零成本”），不能一概
// 当成精确引语。只有同时出现明确说话动作时，才按高风险引语要求就近引用。
const ATTRIBUTED_QUOTE_RE = /(?:(?:表示|指出|称|认为|强调|写道|声称|承认|警告|said|stated|wrote|according\s+to)[^。！？!?\r\n]{0,100}[“「『\"'][^”」』\"'\r\n]{2,160}[”」』\"']|[“「『\"'][^”」』\"'\r\n]{2,160}[”」』\"'][^。！？!?\r\n]{0,80}(?:表示|指出|称|认为|强调|写道|声称|承认|警告|said|stated|wrote))/i;
// 段落明确把数字标注为“转述/复述已公开信息”时，它不是模型凭空捏造的新事实，
// 而是对全文已引来源的归纳解读。这类段落即使不带就近链接也应放行，否则会把
// “区分事实与判断”“据报道/发布会披露”这类高质量分析段整篇打回。
const citationMarkdown = new Marked({ gfm: true, breaks: true });

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

/** Only body-level material may be used to support facts in a generated article. */
export function isBodyLevelEvidence(
  item: Pick<EvidenceItem, "summary" | "materialKind" | "discoveryMethod">,
  minInformationChars = 140
) {
  const length = informationLength(uniqueEvidenceText(item.summary));
  if (length < minInformationChars) return false;
  if (item.materialKind === "fulltext") return true;
  if (item.discoveryMethod === "exa") return length >= Math.max(300, minInformationChars * 2);
  // Keep compatibility with older rows written before materialKind existed.
  return item.materialKind === undefined && length >= 900;
}

/**
 * Return the exact evidence set admitted by the quality gate. Generation,
 * citation allowlists and media attachment must all use this same set; a
 * boolean-only assessment would otherwise let rejected snippets, navigation
 * pages or duplicate copies leak back into the prompt.
 */
export function selectSubstantiveEvidenceItems<
  T extends Pick<EvidenceItem, "title" | "summary" | "url"> & {
    materialKind?: "fulltext" | "excerpt";
    discoveryMethod?: "exa" | "rss" | "google-news";
  }
>(items: T[], options: { minItemInformationChars?: number } = {}): T[] {
  const minItem = options.minItemInformationChars ?? 140;
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const accepted: T[] = [];

  for (const item of filterUsableEvidenceItems(items)) {
    const key = normalizeUrl(item.url) || item.url;
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);
    if (!isBodyLevelEvidence(item, minItem)) continue;
    const uniqueText = uniqueEvidenceText(item.summary);
    const contentKey = evidenceFingerprint(uniqueText);
    if (!contentKey || seenContent.has(contentKey)) continue;
    const assessment = assessSourceSufficiency(
      { url: item.url, title: item.title, markdown: item.summary },
      { minInformationChars: minItem }
    );
    if (!assessment.ok) continue;
    seenContent.add(contentKey);
    accepted.push(item);
  }
  return accepted;
}

export function assessEvidenceSufficiency<
  T extends Pick<EvidenceItem, "title" | "summary" | "url"> & {
    materialKind?: "fulltext" | "excerpt";
    discoveryMethod?: "exa" | "rss" | "google-news";
  }
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
  const accepted = selectSubstantiveEvidenceItems(items, { minItemInformationChars: minItem });
  const lengths = accepted.map((item) => informationLength(uniqueEvidenceText(item.summary)));
  const bodyLevelItems = accepted.length;

  const total = lengths.reduce((sum, length) => sum + Math.min(length, 2000), 0);
  const strongest = lengths.length ? Math.max(...lengths) : 0;
  if (bodyLevelItems < minFullTextItems) {
    return { ok: false, reason: `只有 ${bodyLevelItems} 条正文级资料，至少需要 ${minFullTextItems} 条` };
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
  const diagnosticReason = generationPublicationBlockReason({ content: markdown, generatedArtifact: true });
  if (diagnosticReason) {
    return { ok: false, reason: `生成诊断稿不可发布：${diagnosticReason}` };
  }
  if (/^INVALID_SOURCE$/i.test(markdown.trim())) {
    return { ok: false, reason: "AI 判定来源无效" };
  }
  if (INSUFFICIENT_EVIDENCE_RE.test(markdown.trim())) {
    return { ok: false, reason: markdown.trim().slice(0, 240) };
  }

  const text = normalizeWhitespace(stripMarkdown(markdown));
  if (!text) return { ok: false, reason: "AI 生成内容为空" };

  // “错误页解释稿”的两个信号必须落在同一段里才能定性：治理/审核/防欺诈
  // 题材的真实文章会分散地提到「验证码」「无法核验」等词，不能整篇联合匹配。
  if (looksLikeErrorExplanationDraft(markdown, text)) {
    return { ok: false, reason: "AI 生成结果只是错误页/无效来源说明，不能作为文章发布" };
  }

  const firstLine = markdown.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
  if (!/^#\s+\S/.test(firstLine)) {
    return { ok: false, reason: "成稿缺少置于首行的 Markdown 一级标题" };
  }
  const title = firstLine.replace(/^#\s+/, "").trim();
  if (CLICKBAIT_TITLE_RE.test(title)) {
    return { ok: false, reason: "标题使用了点击诱饵或夸张模板" };
  }

  const referencesMatch = markdown.match(/^##\s*参考来源\s*$/im);
  if (!referencesMatch || referencesMatch.index === undefined) {
    return { ok: false, reason: "成稿缺少文末“参考来源”章节" };
  }
  const body = markdown.slice(0, referencesMatch.index);
  const references = markdown.slice(referencesMatch.index + referencesMatch[0].length);
  const minimumBodyInformationChars = Math.max(120, options.minimumBodyInformationChars ?? 350);
  if (informationLength(stripMarkdown(body)) < minimumBodyInformationChars) {
    return { ok: false, reason: "正文有效信息过少，不能作为完整博客发布" };
  }
  if (options.requireSectionHeadings !== false && !/^##\s+\S+/m.test(body)) {
    return { ok: false, reason: "正文没有任何有意义的二级小节" };
  }
  const sectionCount = body.match(/^##\s+\S+/gm)?.length || 0;
  // “结构过碎”的真实信号是小节数多且平均信息量低（提纲式），而不是绝对
  // 数量：周报/合集覆盖一周事件时 7—9 个充实小节是正常结构。
  if (sectionCount > 10) {
    return { ok: false, reason: `正文分成了 ${sectionCount} 个二级小节，结构过碎且像提纲` };
  }
  if (sectionCount > 4) {
    const averageSectionInformation = informationLength(stripMarkdown(body)) / sectionCount;
    if (averageSectionInformation < 220) {
      return { ok: false, reason: `正文分成了 ${sectionCount} 个二级小节且平均信息量过低，结构过碎且像提纲` };
    }
  }

  const proseBlocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(block));
  const lead = proseBlocks.find((block) => informationLength(stripMarkdown(block)) >= 30);
  if (lead && GENERIC_LEAD_RE.test(normalizeWhitespace(stripMarkdown(lead)))) {
    return { ok: false, reason: "导语仍从空泛时代背景开始，没有直接进入具体事实或矛盾" };
  }
  const wallParagraphs = proseBlocks.filter((block) => informationLength(stripMarkdown(block)) > 900).length;
  if (wallParagraphs >= 2) {
    return { ok: false, reason: "成稿包含多个超长段落，阅读节奏过于密集" };
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
    const minimumDistinctSources = Math.max(1, options.minimumDistinctInlineSources ?? 1);
    if (bodyUrlSet.size < minimumDistinctSources) {
      return {
        ok: false,
        reason: `正文只实际使用了 ${bodyUrlSet.size} 个独立来源，本任务至少需要 ${minimumDistinctSources} 个`
      };
    }
    const referenceUrlSet = new Set(referenceUrls.map(normalizeUrl));
    // 文末允许保留已核验、且位于白名单内的补充来源。硬门禁关注的是正文至少
    // 实际使用了足够多的来源，以及正文链接均进入参考列表；不再仅因参考列表
    // 比正文多一条相关资料而让整篇文章报废。
    const unindexedBodySource = bodyUrls.find((url) => !referenceUrlSet.has(normalizeUrl(url)));
    if (unindexedBodySource) return { ok: false, reason: `正文来源未列入参考来源：${unindexedBodySource}` };
    const uncitedFactParagraph = findUncitedPrecisionFactParagraph(body);
    if (uncitedFactParagraph) {
      return { ok: false, reason: `包含精确事实的段落缺少就近来源链接：${uncitedFactParagraph}` };
    }
  }

  const auditedMarkdown = options.allowTrustedLocalMediaFigures
    ? stripTrustedLocalMediaFigures(markdown)
    : markdown;
  const unsafeHref = findUnsafeRenderedHref(auditedMarkdown);
  if (unsafeHref) {
    return { ok: false, reason: `成稿包含不安全或不受支持的链接协议：${unsafeHref}` };
  }

  if (options.allowedSourceUrls?.length) {
    const allowed = new Set(options.allowedSourceUrls.map(normalizeUrl).filter(Boolean));
    const invented = [...extractHttpUrls(auditedMarkdown), ...extractRawHtmlHttpUrls(auditedMarkdown)]
      .find((url) => !allowed.has(normalizeUrl(url)));
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

/**
 * 只有当「错误页词汇」与「无效生成说明」出现在同一段，或全文本身就是一份
 * 简短的失败说明时，才把成稿定性为“错误页解释稿”。讨论内容审核、验证码、
 * 事实核验等主题的真实文章会在不同段落分散出现这两类词，不能整篇联合匹配。
 */
function looksLikeErrorExplanationDraft(markdown: string, normalizedText: string) {
  if (ERROR_PAGE_RE.test(normalizedText) && GENERATED_INVALID_RE.test(normalizedText) && informationLength(normalizedText) < 600) {
    return true;
  }
  for (const paragraph of markdown.split(/\n\s*\n/)) {
    const text = normalizeWhitespace(stripMarkdown(paragraph));
    if (!text) continue;
    if (ERROR_PAGE_RE.test(text) && GENERATED_INVALID_RE.test(text)) return true;
  }
  return false;
}

function findUncitedPrecisionFactParagraph(body: string) {
  // Always inspect every section. Two legitimate links near the beginning do
  // not authorize unsupported figures or predictions later in the article.
  // A precise claim must cite in the same/preceding paragraph, unless it is
  // explicitly framed as a restatement of already cited information.
  type Para = { text: string; hasUrl: boolean; prevHasUrl: boolean; isHeading: boolean };
  type Section = { paras: Para[] };
  const sections: Section[] = [{ paras: [] }];
  let prevHasUrl = false;
  for (const rawParagraph of body.split(/\n\s*\n/)) {
    const trimmed = rawParagraph.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      const headingHasUrl = extractHttpUrls(trimmed).length > 0;
      const headingText = normalizeWhitespace(stripMarkdown(trimmed.replace(/^#{1,6}\s+/, "")));
      const section = { paras: [] as Para[] };
      if (informationLength(headingText) >= 4) {
        section.paras.push({ text: headingText, hasUrl: headingHasUrl, prevHasUrl: false, isHeading: true });
      }
      sections.push(section);
      prevHasUrl = false;
      continue;
    }
    // Consecutive Markdown list items share one blank-line block, but a source
    // in item 1 must not authorize fabricated facts in items 2 and 3.
    const units = rawParagraph.split(/\r?\n(?=\s*(?:[-*+]\s+|\d+[.)]\s+))/u);
    for (const unit of units) {
      const isListItem = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(unit);
      const hasUrl = extractHttpUrls(unit).length > 0;
      const text = normalizeWhitespace(stripMarkdown(unit));
      const section = sections[sections.length - 1];
      // Short sentences can still contain a complete high-impact claim (for
      // example “韩国政府通过新法案”). Do not make length a citation bypass.
      if (informationLength(text) >= 4) {
        section.paras.push({ text, hasUrl, prevHasUrl: isListItem ? false : prevHasUrl, isHeading: false });
      }
      prevHasUrl = isListItem ? false : hasUrl;
    }
  }

  for (const section of sections) {
    for (let index = 0; index < section.paras.length; index++) {
      const para = section.paras[index];
      // A heading can state the claim summarized by the first sourced paragraph
      // immediately below it. Citations farther away do not authorize it.
      const hasNearbyUrl = para.hasUrl || para.prevHasUrl
        || (para.isHeading && Boolean(section.paras[index + 1]?.hasUrl));
      for (const segment of highRiskGeneratedClaimSegments(para.text)) {
        if (!hasNearbyUrl) {
          return segment.slice(0, 100);
        }
      }
    }
  }
  return null;
}

/**
 * 生成稿正文和摘要共用的高风险事实识别。摘要本身不适合塞入链接，因此发布
 * 时要求这里返回的每项都能在已经通过正文引用门禁的可见正文中找到。
 */
export function highRiskGeneratedClaimSegments(value: string) {
  return value
    .split(/(?<=[。！？!?])|[；，;]|,(?!\d)/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((segment) => {
      if (ATTRIBUTED_QUOTE_RE.test(segment)) return true;
      const numericHighRisk = PRECISE_FACT_RE.test(segment)
        && (FACT_ACTION_RE.test(segment) || PRECISE_QUANTITY_RE.test(segment));
      return numericHighRisk || hasHighRiskAttributableAction(segment);
    });
}

function hasHighRiskAttributableAction(text: string) {
  for (const sentence of text.split(/(?<=[。！？!?])|[；;]\s*/u)) {
    let offset = 0;
    while (offset < sentence.length) {
      const remainder = sentence.slice(offset);
      const match = ATTRIBUTABLE_ACTION_RE.exec(remainder);
      if (!match || match.index === undefined) break;
      const action = MAJOR_ACTION_WORD_RE.exec(match[0]);
      if (!action || action.index === undefined) break;
      // Modality only excuses the matching action. Continue scanning so an
      // earlier hypothetical acquisition cannot hide a later definite approval.
      const absoluteAction = offset + match.index + action.index;
      const beforeAction = remainder.slice(0, match.index + action.index).slice(-36);
      if (!HYPOTHETICAL_ACTION_RE.test(beforeAction)) return true;
      offset = absoluteAction + Math.max(1, action[0].length);
    }
  }
  return false;
}

function stripHiddenCitationRegions(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    // Indented code and link definitions do not render as a clickable source
    // beside the claim, so neither can satisfy the citation gate.
    .replace(/^(?:(?: {4}|\t).*?(?:\r?\n|$))+/gm, " ")
    .replace(/^\s{0,3}\[[^\]\r\n]+]:\s*\S+.*$/gm, " ")
    .replace(/`[^`\r\n]*`/g, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

function stripNonCitationRegions(value: string) {
  // Raw HTML attributes are not reader-visible prose. Removing tags here also
  // prevents data-source/style attributes from leaking into fact detection.
  return stripHiddenCitationRegions(value).replace(/<[^>]+>/g, " ");
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
  // Traverse the renderer's Markdown token tree. URLs in HTML attributes,
  // comments, code, images, or unused definitions never become Link tokens,
  // so they cannot spoof a visible, clickable citation beside a claim.
  const seen = new WeakSet<object>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const token = node as Record<string, unknown>;
    const type = typeof token.type === "string" ? token.type : "";
    if (type === "link") {
      const href = typeof token.href === "string" ? trimBareUrlPunctuation(token.href) : "";
      const label = containsCitationTokenType(token.tokens, "html") ? "" : visibleCitationLabel(token.tokens);
      if (/^https?:\/\//i.test(href) && hasVisibleCitationLabel(label)) urls.push(href);
      return;
    }
    if (type === "image" || type === "html" || type === "code" || type === "codespan") return;
    for (const [key, child] of Object.entries(token)) {
      if (key === "raw" || key === "text" || key === "href") continue;
      if (child && typeof child === "object") walk(child);
    }
  };
  walk(citationMarkdown.lexer(value));
  return urls;
}

function extractRawHtmlHttpUrls(value: string) {
  const urls: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const token = node as Record<string, unknown>;
    if (token.type === "html") {
      const raw = typeof token.raw === "string" ? token.raw : "";
      for (const match of raw.matchAll(/https?:\/\/[^\s"'<>`]+/gi)) {
        const url = trimBareUrlPunctuation(match[0]);
        if (url) urls.push(url);
      }
      return;
    }
    for (const [key, child] of Object.entries(token)) {
      if (key !== "raw" && child && typeof child === "object") walk(child);
    }
  };
  walk(citationMarkdown.lexer(value));
  return urls;
}

/** Reject links that the renderer could make clickable but that are neither
 * HTTP(S) citations nor safe same-site navigation. This closes `//host`, FTP,
 * javascript/data and custom-scheme bypasses that are invisible to the source
 * allowlist. */
function findUnsafeRenderedHref(value: string) {
  const isSafe = (href: string) =>
    /^https?:\/\//i.test(href)
    || (/^\/(?!\/)/.test(href))
    || href.startsWith("#");
  const seen = new WeakSet<object>();
  let unsafe = "";
  const walk = (node: unknown) => {
    if (unsafe || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const token = node as Record<string, unknown>;
    if (token.type === "link") {
      const href = typeof token.href === "string" ? token.href.trim() : "";
      if (href && !isSafe(href)) unsafe = href.slice(0, 180);
      return;
    }
    if (token.type === "html") {
      const raw = typeof token.raw === "string" ? token.raw : "";
      for (const match of raw.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
        const href = (match[1] || match[2] || match[3] || "").trim();
        if (href && !isSafe(href)) {
          unsafe = href.slice(0, 180);
          break;
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(token)) {
      if (key !== "raw" && child && typeof child === "object") walk(child);
    }
  };
  walk(citationMarkdown.lexer(value));
  return unsafe || null;
}

/**
 * Strip only the exact HTML shape emitted by buildArticleImageFigureHtml and
 * only when its image points at this application's local image store. Any extra
 * tag/attribute or remote image leaves the block in place for normal auditing.
 */
function stripTrustedLocalMediaFigures(value: string) {
  const safeText = `[^"'<>]*`;
  const localImage = `\/uploads\/image\/[A-Za-z0-9._\/-]+`;
  const sourceLink = `(?:<a href="https?:\/\/${safeText}" target="_blank" rel="noreferrer">${safeText}<\/a>)?`;
  const pattern = new RegExp(
    `<figure class="article-media article-image"><img src="${localImage}" alt="${safeText}" loading="lazy" decoding="async"><figcaption><span>${safeText}<\\/span>${sourceLink}<\\/figcaption><\\/figure>`,
    "gi"
  );
  return value.replace(pattern, " ");
}

function containsCitationTokenType(node: unknown, expectedType: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((item) => containsCitationTokenType(item, expectedType));
  const token = node as Record<string, unknown>;
  if (token.type === expectedType) return true;
  return Object.entries(token).some(([key, child]) =>
    key !== "raw" && child !== null && typeof child === "object" && containsCitationTokenType(child, expectedType)
  );
}

function visibleCitationLabel(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(visibleCitationLabel).join(" ");
  const token = node as Record<string, unknown>;
  const type = typeof token.type === "string" ? token.type : "";
  if (type === "image" || type === "html") return "";
  if (Array.isArray(token.tokens)) return visibleCitationLabel(token.tokens);
  return typeof token.text === "string" ? token.text : "";
}

function hasVisibleCitationLabel(value: string) {
  // Marked preserves some character entities in token.text. Strip all entities
  // plus Unicode formatting/separator characters, then require at least two
  // letters or numbers that a reader can actually identify.
  const visible = value
    .replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, "")
    .replace(/[\p{Cf}\p{Z}\s]/gu, "");
  return (visible.match(/[\p{L}\p{N}]/gu) || []).length >= 1;
}

function trimBareUrlPunctuation(value: string) {
  const cjkBoundary = value.search(/[，。；：！？、（）［］｛｝【】《》「」“”‘’]/u);
  let url = (cjkBoundary >= 0 ? value.slice(0, cjkBoundary) : value).replace(/[.,;:!?]+$/g, "");
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
