export type ResearchScope = "all" | "domestic" | "international";
export type ResearchDepth = "standard" | "long" | "deep";
export type DigestKind = "DAILY_DIGEST" | "WEEKLY_ROUNDUP";

export function buildKeywordResearchUrl(keyword: string, scope: ResearchScope, count = 1, depth: ResearchDepth = "long") {
  const url = new URL("keyword://research");
  url.searchParams.set("q", keyword.trim());
  url.searchParams.set("scope", scope);
  url.searchParams.set("count", String(clampArticleCount(count)));
  url.searchParams.set("depth", depth);
  return url.toString();
}

// RawItem.url 用的是更简单的 keyword://<编码后的关键词> 形式（见
// src/worker/index.ts 的 createDraftFromKeyword/upsertResearchRawItem）——
// 没有 research 路径段也没有 scope/count/depth 参数，这些参数只存在于
// 它所属 FetchJob 的 sourceUrl 上。跟 parseKeywordResearchUrl 分开是因为
// 两种 URL 形状本来就不兼容，硬塞进一个函数只会让两边的判断都变脆弱。
export function parseRawItemKeywordUrl(value: string) {
  if (!value.startsWith("keyword://") || value.startsWith("keyword://research")) return null;
  try {
    const keyword = decodeURIComponent(value.slice("keyword://".length)).trim();
    return keyword ? { keyword } : null;
  } catch {
    return null;
  }
}

export function parseKeywordResearchUrl(value: string) {
  if (!value.startsWith("keyword://research")) return null;

  const url = new URL(value);
  const keyword = url.searchParams.get("q")?.trim();
  const scope = url.searchParams.get("scope") || "all";
  const count = Number(url.searchParams.get("count") || 1);
  const depth = url.searchParams.get("depth") || "long";

  if (!keyword) return null;

  return {
    keyword,
    scope: isResearchScope(scope) ? scope : "all",
    count: clampArticleCount(count),
    depth: isResearchDepth(depth) ? depth : "long"
  };
}

export function buildDigestUrl(topicId: string, kind: DigestKind) {
  const url = new URL("digest://topic");
  url.searchParams.set("topicId", topicId);
  url.searchParams.set("kind", kind);
  return url.toString();
}

export function parseDigestUrl(value: string) {
  if (!value.startsWith("digest://topic")) return null;

  try {
    const url = new URL(value);
    const topicId = url.searchParams.get("topicId");
    const kind = url.searchParams.get("kind");
    if (!topicId) return null;
    if (kind !== "DAILY_DIGEST" && kind !== "WEEKLY_ROUNDUP") return null;
    return { topicId, kind: kind as DigestKind };
  } catch {
    return null;
  }
}

export function digestWindowLabel(kind: DigestKind) {
  return kind === "WEEKLY_ROUNDUP" ? "过去 7 天" : "过去 24 小时";
}

export function digestWindowMs(kind: DigestKind) {
  return kind === "WEEKLY_ROUNDUP" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export function researchScopeLabel(scope: ResearchScope) {
  if (scope === "domestic") return "国内";
  if (scope === "international") return "国外";
  return "国内+国外";
}

export function researchDepthLabel(depth: ResearchDepth) {
  if (depth === "standard") return "标准";
  if (depth === "deep") return "深度长文";
  return "长文";
}

export function isResearchScope(value: string): value is ResearchScope {
  return value === "all" || value === "domestic" || value === "international";
}

export function isResearchDepth(value: string): value is ResearchDepth {
  return value === "standard" || value === "long" || value === "deep";
}

export function isCompileKind(value: string): value is CompileKind {
  return value === "SINGLE_ARTICLE" || value === "DAILY_DIGEST" || value === "WEEKLY_ROUNDUP";
}

export type CompileKind = "SINGLE_ARTICLE" | DigestKind;

function clampArticleCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), 5);
}
