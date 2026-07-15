import { createHash } from "node:crypto";
import type { EvidenceItem } from "./ai";
import { isResearchDepth, isResearchScope, parseKeywordResearchUrl } from "./research";
import { normalizeUrl } from "./source-quality";

export const POST_REPAIR_MAX_ATTEMPTS = 3;
export const POST_REPAIR_RESULT_PREFIX = "SHIBEI_POST_REPAIR_RESULT:";
const TRUSTED_EVIDENCE_MANIFEST_PREFIX = "shibei:trusted-evidence-v1:";
const TRUSTED_EVIDENCE_MANIFEST_MAX_ENCODED_CHARS = 512_000;

export type PostRepairDraft = {
  title: string;
  summary: string;
  content: string;
};

export type PostRepairAssessment =
  | { ok: true; clearPublicationBlock?: boolean }
  | { ok: false; reason: string };

export type PostRepairRound = {
  round: number;
  action: "audit" | "regenerate" | "repair";
  reason: string;
};

export type PostRepairResult = {
  version: 1;
  postId: string;
  title: string;
  state: "QUEUED" | "RUNNING" | "PUBLISHED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  message: string;
  reason: string | null;
  guidance: string | null;
  rounds: PostRepairRound[];
};

export type PostRepairLoopResult = {
  ok: boolean;
  draft: PostRepairDraft;
  attempts: number;
  reason: string | null;
  rounds: PostRepairRound[];
};

type RevisionResult = {
  draft: PostRepairDraft;
  action: "regenerate" | "repair";
  /** A protected-media/protocol rejection becomes the next round's exact feedback. */
  rejectionReason?: string;
  /** Evidence insufficiency is a hard boundary: further wording retries cannot fix it. */
  stopReason?: string;
};

/**
 * Deterministic bounded repair state machine. The model callback never decides
 * whether a post may be published: every candidate comes back through the same
 * caller-supplied publication assessment.
 */
export async function runPostRepairRounds(input: {
  initialDraft: PostRepairDraft;
  assess: (draft: PostRepairDraft) => PostRepairAssessment;
  revise: (draft: PostRepairDraft, reason: string, round: number) => Promise<RevisionResult>;
  maxAttempts?: number;
  onRound?: (result: {
    draft: PostRepairDraft;
    attempts: number;
    reason: string;
    rounds: PostRepairRound[];
  }) => Promise<void> | void;
}): Promise<PostRepairLoopResult> {
  const maxAttempts = Math.min(Math.max(Math.floor(input.maxAttempts ?? POST_REPAIR_MAX_ATTEMPTS), 1), POST_REPAIR_MAX_ATTEMPTS);
  let draft = input.initialDraft;
  let assessment = input.assess(draft);
  const rounds: PostRepairRound[] = [];

  if (assessment.ok) {
    return { ok: true, draft, attempts: 0, reason: null, rounds };
  }

  let reason = assessment.reason;
  for (let round = 1; round <= maxAttempts; round += 1) {
    const revision = await input.revise(draft, reason, round);
    draft = revision.draft;

    if (revision.stopReason) {
      reason = revision.stopReason;
      rounds.push({ round, action: revision.action, reason });
      await input.onRound?.({ draft, attempts: round, reason, rounds: [...rounds] });
      return { ok: false, draft, attempts: round, reason, rounds };
    }

    assessment = revision.rejectionReason
      ? { ok: false, reason: revision.rejectionReason }
      : input.assess(draft);
    reason = assessment.ok ? "已通过完整发布检查" : assessment.reason;
    rounds.push({ round, action: revision.action, reason });
    await input.onRound?.({ draft, attempts: round, reason, rounds: [...rounds] });

    if (assessment.ok) {
      return { ok: true, draft, attempts: round, reason: null, rounds };
    }
  }

  return { ok: false, draft, attempts: maxAttempts, reason, rounds };
}

export function buildPostRepairUrl(input: {
  postId: string;
  expectedUpdatedAt: Date | string;
  evidenceRevision: string;
}) {
  const url = new URL("post-repair://publish");
  url.searchParams.set("postId", input.postId);
  url.searchParams.set(
    "revision",
    input.expectedUpdatedAt instanceof Date ? input.expectedUpdatedAt.toISOString() : input.expectedUpdatedAt
  );
  url.searchParams.set("evidence", input.evidenceRevision);
  return url.toString();
}

export function parsePostRepairUrl(value: string) {
  if (!value.startsWith("post-repair://publish")) return null;
  try {
    const url = new URL(value);
    const postId = url.searchParams.get("postId")?.trim() || "";
    const revision = url.searchParams.get("revision")?.trim() || "";
    const evidenceRevision = url.searchParams.get("evidence")?.trim() || "";
    const expectedUpdatedAt = new Date(revision);
    if (!postId || postId.length > 120 || !Number.isFinite(expectedUpdatedAt.getTime())) return null;
    if (!/^[a-f0-9]{32}$/i.test(evidenceRevision)) return null;
    return { postId, expectedUpdatedAt, evidenceRevision };
  } catch {
    return null;
  }
}

export function postRepairEvidenceRevision(input: {
  rawItemId?: string | null;
  title?: string | null;
  url?: string | null;
  content?: string | null;
  markdown?: string | null;
  artifactKind?: string | null;
  sourceType?: string | null;
  fetchSourceUrl?: string | null;
}) {
  return createHash("sha256")
    .update(input.rawItemId || "")
    .update("\0")
    .update(input.title || "")
    .update("\0")
    .update(input.url || "")
    .update("\0")
    .update(input.content || "")
    .update("\0")
    .update(input.markdown || "")
    .update("\0")
    .update(input.artifactKind || "")
    .update("\0")
    .update(input.sourceType || "")
    .update("\0")
    .update(input.fetchSourceUrl || "")
    .digest("hex")
    .slice(0, 32);
}

type SerializedEvidenceItem = {
  title: string;
  url: string;
  sourceName: string;
  summary: string;
  publishedAt: string | null;
  materialKind: "fulltext" | "excerpt" | null;
  discoveryMethod: "exa" | "rss" | "google-news" | null;
};

/**
 * Persist the worker-admitted evidence as an unambiguous machine-only header.
 * Source excerpts may contain arbitrary headings and numbered Markdown links,
 * so the human-readable inventory is never used as the trust boundary.
 */
export function buildTrustedEvidenceManifest(items: EvidenceItem[]) {
  if (items.length > 16) throw new Error("可信来源条目超过安全存储上限");
  if (items.some((item) => item.url.length > 8000)) {
    throw new Error("可信来源 URL 超过安全存储上限");
  }
  let encoded = "";
  for (const summaryLimit of [6000, 4000, 2500, 1200, 600]) {
    const payload = {
      version: 1,
      items: items.map((item): SerializedEvidenceItem => ({
        title: item.title.slice(0, 300),
        url: item.url,
        sourceName: item.sourceName.slice(0, 300),
        summary: item.summary.slice(0, summaryLimit),
        publishedAt: item.publishedAt && Number.isFinite(item.publishedAt.getTime())
          ? item.publishedAt.toISOString()
          : null,
        materialKind: item.materialKind || null,
        discoveryMethod: item.discoveryMethod || null
      }))
    };
    encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    if (encoded.length <= TRUSTED_EVIDENCE_MANIFEST_MAX_ENCODED_CHARS) break;
  }
  if (encoded.length > TRUSTED_EVIDENCE_MANIFEST_MAX_ENCODED_CHARS) {
    throw new Error("可信来源清单超过安全存储上限");
  }
  return `<!-- ${TRUSTED_EVIDENCE_MANIFEST_PREFIX}${encoded} -->`;
}

export function extractTrustedEvidenceManifest(markdown?: string | null): EvidenceItem[] {
  const value = markdown || "";
  // Only the artifact header is authoritative. Source bodies begin at the
  // first H2 and therefore cannot smuggle another manifest into this region.
  const firstSection = value.search(/^##\s/m);
  const header = firstSection < 0 ? value : value.slice(0, firstSection);
  const matches = [...header.matchAll(/<!--\s*shibei:trusted-evidence-v1:([A-Za-z0-9_-]+)\s*-->/g)];
  if (matches.length !== 1 || matches[0][1].length > TRUSTED_EVIDENCE_MANIFEST_MAX_ENCODED_CHARS) return [];

  try {
    const parsed = JSON.parse(Buffer.from(matches[0][1], "base64url").toString("utf8")) as {
      version?: unknown;
      items?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > 16) return [];

    const evidence: EvidenceItem[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.items) {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Partial<SerializedEvidenceItem>;
      if (
        typeof item.title !== "string" || !item.title.trim() || item.title.length > 300 ||
        typeof item.url !== "string" || item.url.length > 8000 || !/^https?:\/\//i.test(item.url) ||
        typeof item.sourceName !== "string" || !item.sourceName.trim() || item.sourceName.length > 300 ||
        typeof item.summary !== "string" || !item.summary.trim() || item.summary.length > 6000 ||
        (item.materialKind !== null && item.materialKind !== "fulltext" && item.materialKind !== "excerpt") ||
        (item.discoveryMethod !== null && item.discoveryMethod !== "exa" && item.discoveryMethod !== "rss" && item.discoveryMethod !== "google-news") ||
        (item.publishedAt !== null && typeof item.publishedAt !== "string")
      ) return [];

      const key = normalizeUrl(item.url);
      if (!key || seen.has(key)) continue;
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
      if (item.publishedAt && !Number.isFinite(publishedAt?.getTime())) return [];
      seen.add(key);
      evidence.push({
        title: item.title.trim(),
        url: item.url,
        sourceName: item.sourceName.trim(),
        summary: item.summary,
        ...(item.materialKind ? { materialKind: item.materialKind } : {}),
        ...(item.discoveryMethod ? { discoveryMethod: item.discoveryMethod } : {}),
        ...(publishedAt ? { publishedAt } : {})
      });
    }
    return evidence;
  } catch {
    return [];
  }
}

type ResearchArtifactForDiscoveryFallback = {
  id: string;
  fetchSourceUrl?: string | null;
  markdown?: string | null;
};

/**
 * Return URL discovery hints from trusted sibling artifacts only when their
 * machine-readable research identity exactly matches the target. `count` is
 * intentionally not part of that identity: it controls article fan-out, while
 * keyword/scope/depth determine the evidence request itself.
 *
 * No archived title, source label, date or body crosses this boundary. Callers
 * must fetch every returned URL again and pass the fresh material through the
 * normal selector and sufficiency gate before admitting it.
 */
export function matchingTrustedResearchDiscoveryUrls(input: {
  targetRawItemId: string;
  targetFetchSourceUrl?: string | null;
  artifactsNewestFirst: readonly ResearchArtifactForDiscoveryFallback[];
  limit?: number;
}) {
  const target = safeParseKeywordResearchUrl(input.targetFetchSourceUrl);
  if (!target) return [];
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 8), 0), 16);
  if (!limit) return [];

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const artifact of input.artifactsNewestFirst) {
    if (artifact.id === input.targetRawItemId) continue;
    const sibling = safeParseKeywordResearchUrl(artifact.fetchSourceUrl);
    if (
      !sibling ||
      sibling.keyword !== target.keyword ||
      sibling.scope !== target.scope ||
      sibling.depth !== target.depth
    ) continue;

    for (const item of extractTrustedEvidenceManifest(artifact.markdown)) {
      try {
        const parsed = new URL(item.url);
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) continue;
      } catch {
        continue;
      }
      const key = normalizeUrl(item.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      urls.push(item.url);
      if (urls.length >= limit) return urls;
    }
  }
  return urls;
}

function safeParseKeywordResearchUrl(value?: string | null) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "keyword:" || url.hostname !== "research") return null;
    const rawScope = url.searchParams.get("scope");
    const rawDepth = url.searchParams.get("depth");
    if (rawScope && !isResearchScope(rawScope)) return null;
    if (rawDepth && !isResearchDepth(rawDepth)) return null;
    return parseKeywordResearchUrl(url.toString());
  } catch {
    return null;
  }
}

/** Reconstruct only the evidence inventory explicitly admitted by the worker. */
export function extractTrustedPostRepairEvidence(input: {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  markdown?: string | null;
}): EvidenceItem[] {
  const sourceUrl = input.url?.trim() || "";
  if (/^https?:\/\//i.test(sourceUrl)) {
    const summary = pickRicherText(input.markdown, input.content);
    if (!summary.trim()) return [];
    return [{
      title: input.title?.trim() || sourceUrl,
      url: sourceUrl,
      sourceName: sourceNameFromUrl(sourceUrl),
      summary,
      materialKind: "fulltext"
    }];
  }

  return extractTrustedEvidenceManifest(input.markdown);
}

/**
 * Early research jobs stored every discovery under one `## 研究资料` section.
 * These rows cannot be trusted as-is; callers must pass the parsed candidates
 * through the current relevance + substantive-evidence selector before use.
 */
export function extractLegacyPostRepairEvidence(markdown?: string | null): EvidenceItem[] {
  const modernCandidates = parseEvidenceInventorySection(
    markdown || "",
    /^##\s*可用于写作的正文资料\s*$/im,
    /^##\s*仅供检索的研究线索\s*$/im,
    false
  );
  if (modernCandidates.length) return modernCandidates;
  return parseEvidenceInventorySection(
    markdown || "",
    /^##\s*研究资料\s*$/im,
    null,
    false
  );
}

/** Persist the newly selected whitelist while retaining the old inventory for audit. */
export function buildTrustedResearchInventoryUpgrade(input: {
  markdown: string;
  trustedEvidence: EvidenceItem[];
  allEvidence: EvidenceItem[];
}) {
  const legacyHeading = input.markdown.match(/^##\s*研究资料\s*$/im);
  const modernHeading = input.markdown.match(/^##\s*可用于写作的正文资料\s*$/im);
  const inventoryHeading = legacyHeading || modernHeading;
  if (!inventoryHeading || inventoryHeading.index === undefined) return input.markdown;
  const trusted = new Set(input.trustedEvidence.map((item) => normalizeUrl(item.url) || item.url));
  const clues = input.allEvidence.filter((item) => !trusted.has(normalizeUrl(item.url) || item.url));
  const before = input.markdown
    .slice(0, inventoryHeading.index)
    .replace(/<!--\s*shibei:trusted-evidence-v1:[A-Za-z0-9_-]+\s*-->/g, "")
    .trimEnd();
  const history = legacyHeading && legacyHeading.index !== undefined
    ? input.markdown
      .slice(legacyHeading.index)
      .replace(/^##\s*研究资料\s*$/i, "## 历史研究资料（升级前，仅供审计）")
    : null;
  return [
    buildTrustedEvidenceManifest(input.trustedEvidence),
    "",
    before,
    "",
    "## 可用于写作的正文资料",
    ...formatEvidenceInventory(input.trustedEvidence, 1800),
    "",
    "## 仅供检索的研究线索",
    ...(clues.length ? formatEvidenceInventory(clues, 360) : ["（无）"]),
    ...(history ? ["", history] : [])
  ].join("\n");
}

export function assessPostRepairMediaIntegrity(original: string, revised: string) {
  const protectedGroups: Array<{ label: string; originalValues: string[]; revisedValues: string[] }> = [
    {
      label: "视频挂载点",
      originalValues: original.match(/\[\[video:[^\]\r\n]+]]/g) || [],
      revisedValues: revised.match(/\[\[video:[^\]\r\n]+]]/g) || []
    },
    {
      label: "Markdown 图片",
      originalValues: original.match(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g) || [],
      revisedValues: revised.match(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g) || []
    },
    {
      label: "文章 figure 媒体块",
      originalValues: original.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) || [],
      revisedValues: revised.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) || []
    }
  ];
  for (const group of protectedGroups) {
    const expected = occurrenceCounts(group.originalValues);
    const actual = occurrenceCounts(group.revisedValues);
    let removed = 0;
    let added = 0;
    for (const [token, count] of expected) {
      removed += Math.max(0, count - (actual.get(token) || 0));
    }
    for (const [token, count] of actual) {
      added += Math.max(0, count - (expected.get(token) || 0));
    }
    if (removed || added) {
      const changes = [
        removed ? `删除或改写 ${removed} 个` : "",
        added ? `新增或复制 ${added} 个` : ""
      ].filter(Boolean).join("，");
      return { ok: false as const, reason: `${group.label}与原稿不一致（${changes}），必须逐字且等量保留` };
    }
  }
  return { ok: true as const };
}

export function encodePostRepairResult(result: PostRepairResult) {
  return `${POST_REPAIR_RESULT_PREFIX}${JSON.stringify(result)}`;
}

export function decodePostRepairResult(value: string | null | undefined): PostRepairResult | null {
  if (!value?.startsWith(POST_REPAIR_RESULT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(POST_REPAIR_RESULT_PREFIX.length)) as Partial<PostRepairResult>;
    if (parsed.version !== 1 || typeof parsed.postId !== "string" || typeof parsed.title !== "string") return null;
    if (!parsed.state || !["QUEUED", "RUNNING", "PUBLISHED", "FAILED"].includes(parsed.state)) return null;
    return {
      version: 1,
      postId: parsed.postId,
      title: parsed.title,
      state: parsed.state,
      attempts: Number.isFinite(parsed.attempts) ? Math.max(0, Number(parsed.attempts)) : 0,
      maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
      message: typeof parsed.message === "string" ? parsed.message : "",
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      guidance: typeof parsed.guidance === "string" ? parsed.guidance : null,
      rounds: Array.isArray(parsed.rounds)
        ? parsed.rounds.filter((round): round is PostRepairRound => Boolean(
          round &&
          Number.isFinite(round.round) &&
          (round.action === "audit" || round.action === "regenerate" || round.action === "repair") &&
          typeof round.reason === "string"
        )).slice(0, POST_REPAIR_MAX_ATTEMPTS)
        : []
    };
  } catch {
    return null;
  }
}

export function postRepairGuidance(reason: string) {
  if (/资料.*(?:不足|未达到)|没有可核验|缺少可信|INSUFFICIENT_EVIDENCE/i.test(reason)) {
    return "需要补充可抓取的正文来源后重跑原生成任务；AI 不能凭空补足事实。";
  }
  if (/API Key|鉴权|401|403|endpoint|端点|模型.*配置/i.test(reason)) {
    return "请到“设置 → 模型”重新验证内容模型的地址、模型名和 API Key，然后点击重试。";
  }
  if (/超时|timeout|限流|429|网关|502|503|504/i.test(reason)) {
    return "模型服务本轮暂时不可用；原稿未被覆盖，可在服务恢复后直接重试。";
  }
  if (/截断|finish_reason=length|max_tokens/i.test(reason)) {
    return "需要提高内容模型输出上限并重跑完整生成，不能发布被截断的半篇文章。";
  }
  if (/并发|已被修改|版本|待审核修改/i.test(reason)) {
    return "返修期间文章或来源发生了变化。请打开最新稿确认后重新执行，系统不会覆盖你的编辑。";
  }
  if (/来源|链接|引用|参考/.test(reason)) {
    return "AI 已按现有来源返修到上限；请打开草稿查看逐轮原因，必要时补充正确来源。";
  }
  return "原稿仍保留为草稿。请打开编辑器查看最终审核原因，再决定补资料或重新生成。";
}

function sourceNameFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "") || "原始来源";
  } catch {
    return "原始来源";
  }
}

function parseEvidenceInventorySection(
  markdown: string,
  startPattern: RegExp,
  endPattern: RegExp | null,
  alreadyTrusted: boolean
) {
  const start = markdown.match(startPattern);
  if (!start || start.index === undefined) return [];
  const bodyStart = start.index + start[0].length;
  const tail = markdown.slice(bodyStart);
  const end = endPattern ? tail.match(endPattern) : null;
  const section = end?.index === undefined ? tail : tail.slice(0, end.index);
  const itemPattern = /^(\d+)[.)]\s+\[([^\]\r\n]+)]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+?)\)\s*\r?\n(?=\s*-\s*来源：)/gim;
  const matches = [...section.matchAll(itemPattern)];
  const evidence: EvidenceItem[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const blockStart = (match.index || 0) + match[0].length;
    const blockEnd = matches[index + 1]?.index ?? section.length;
    const block = section.slice(blockStart, blockEnd).trimEnd();
    const source = block.match(/^\s*-\s*来源：\s*(.+?)\s*$/m)?.[1]?.trim();
    const published = block.match(/^\s*-\s*时间：\s*(.+?)\s*$/m)?.[1]?.trim();
    const excerpt = block.match(/^\s*-\s*摘录：\s*/m);
    if (!excerpt || excerpt.index === undefined) continue;
    const rawSummary = block.slice(excerpt.index + excerpt[0].length);
    const summary = rawSummary
      .replace(/^ {5}/gm, "")
      .trim();
    if (!summary) continue;
    const url = match[3];
    const sourceName = source || sourceNameFromUrl(url);
    const discoveryMethod = /exa/i.test(sourceName)
      ? "exa" as const
      : /news\.google\./i.test(url)
        ? "google-news" as const
        : undefined;
    const publishedAt = published ? new Date(published) : null;
    evidence.push({
      title: match[2].trim(),
      url,
      sourceName,
      summary,
      materialKind: alreadyTrusted
        ? "fulltext"
        : discoveryMethod === "exa" || discoveryMethod === "google-news" || informationLength(summary) < 500
          ? "excerpt"
          : "fulltext",
      discoveryMethod,
      ...(publishedAt && Number.isFinite(publishedAt.getTime()) ? { publishedAt } : {})
    });
  }

  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = normalizeUrl(item.url) || item.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatEvidenceInventory(items: EvidenceItem[], summaryLimit: number) {
  return items.map((item, index) => {
    const summaryLines = item.summary.slice(0, summaryLimit).trim().split(/\r?\n/);
    const first = summaryLines.shift() || "";
    return [
      `${index + 1}. [${item.title.replace(/[\[\]]/g, "")}](${item.url})`,
      `   - 来源：${item.sourceName}`,
      item.publishedAt && Number.isFinite(item.publishedAt.getTime()) ? `   - 时间：${item.publishedAt.toISOString()}` : null,
      `   - 摘录：${first}`,
      ...summaryLines.map((line) => `     ${line}`)
    ].filter((line): line is string => Boolean(line)).join("\n");
  });
}

function pickRicherText(first?: string | null, second?: string | null) {
  const a = first || "";
  const b = second || "";
  return informationLength(a) >= informationLength(b) ? a : b;
}

function informationLength(value: string) {
  return value.match(/[\p{L}\p{N}]/gu)?.length || 0;
}

function occurrenceCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}
