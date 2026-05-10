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

export function isResearchScope(value: string): value is ResearchScope {
  return value === "all" || value === "domestic" || value === "international";
}

function isResearchDepth(value: string): value is ResearchDepth {
  return value === "standard" || value === "long" || value === "deep";
}

function clampArticleCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), 5);
}
