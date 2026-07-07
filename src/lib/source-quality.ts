import type { EvidenceItem } from "./ai";

// 来源质量门禁：在写稿流水线里拦下 401/403/404、验证码、Cloudflare 拦截页等
// "看起来抓到了内容、其实是错误页"的材料，避免 AI 把访问受限提示写成文章。

export type SourceMaterial = {
  title?: string | null;
  content?: string | null;
  markdown?: string | null;
  httpStatus?: number | null;
};

export type SourceAssessment =
  | { ok: true }
  | { ok: false; reason: string };

export class InvalidSourceMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSourceMaterialError";
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
  const assessment = assessSourceMaterial(input);
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

export function assessGeneratedArticle(markdown: string): SourceAssessment {
  if (/^INVALID_SOURCE$/i.test(markdown.trim())) {
    return { ok: false, reason: "AI 判定来源无效" };
  }

  const text = normalizeWhitespace(stripMarkdown(markdown));
  if (!text) return { ok: false, reason: "AI 生成内容为空" };

  if (ERROR_PAGE_RE.test(text) && GENERATED_INVALID_RE.test(text)) {
    return { ok: false, reason: "AI 生成结果只是错误页/无效来源说明，不能作为文章发布" };
  }

  return { ok: true };
}

export function assertPublishableGeneratedArticle(markdown: string) {
  const assessment = assessGeneratedArticle(markdown);
  if (!assessment.ok) throw new InvalidSourceMaterialError(assessment.reason);
}

function normalizeStatus(value: number | null | undefined) {
  if (!Number.isFinite(value)) return null;
  return Math.floor(Number(value));
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
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~#-]+/g, " ");
}
