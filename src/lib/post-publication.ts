import { generationPublicationBlockReason, stripNonPublishableGenerationMarker } from "./publication-policy";
import {
  assessGeneratedArticle,
  highRiskGeneratedClaimSegments,
  normalizeUrl
} from "./source-quality";
import { extractTrustedEvidenceManifest } from "./post-repair";

export type PostPublicationAssessment =
  | { ok: true; clearPublicationBlock: boolean }
  | { ok: false; reason: string };

/** VIDEO RawItems are curated embeds, not AI-written research articles. */
export function requiresGeneratedArticleGate(input: {
  hasRawItem: boolean;
  artifactKind?: string | null;
  sourceType?: string | null;
}) {
  return input.hasRawItem && input.artifactKind !== "VIDEO" && input.sourceType !== "VIDEO";
}

/**
 * Manual posts keep the existing editorial workflow. A worker-blocked post,
 * however, can only be published after its diagnostic text is removed and the
 * replacement article passes the same source/citation gate as generated output.
 */
export function assessPostPublicationRequest(input: {
  requestedStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publicationBlockedReason?: string | null;
  title: string;
  summary: string;
  content: string;
  allowedSourceUrls?: string[];
  generatedArtifact?: boolean;
}): PostPublicationAssessment {
  if (input.requestedStatus !== "PUBLISHED") {
    return { ok: true, clearPublicationBlock: false };
  }

  const reviewContent = input.publicationBlockedReason
    ? stripNonPublishableGenerationMarker(input.content)
    : input.content;
  const diagnosticReason = generationPublicationBlockReason({
    summary: input.summary,
    content: reviewContent,
    generatedArtifact: input.generatedArtifact
  });
  if (diagnosticReason) {
    return { ok: false, reason: `这仍是生成失败后的研究草稿：${diagnosticReason}` };
  }

  // Hand-written posts keep the lightweight editorial flow. Every RawItem
  // artifact, including an initially valid autoPublish=false draft, is checked
  // again because an administrator or AI Assist may have changed it since the
  // worker's original gate.
  if (!input.publicationBlockedReason && !input.generatedArtifact) {
    return { ok: true, clearPublicationBlock: false };
  }

  const allowedSourceUrls = [...new Set((input.allowedSourceUrls || [])
    .map((url) => normalizeUrl(url))
    .filter((url): url is string => Boolean(url) && /^https?:\/\//i.test(url)))];
  if (!allowedSourceUrls.length) {
    // A manually created post can recover from a historical false positive once
    // its diagnostic-looking text is removed. Worker artifacts must be rerun or
    // retain their trusted source whitelist before the block can be released.
    if (!input.generatedArtifact) return { ok: true, clearPublicationBlock: true };
    return { ok: false, reason: "该草稿没有可核验的原始来源，不能解除发布阻断" };
  }
  const article = assessGeneratedArticle(reviewContent, {
    allowedSourceUrls,
    requireInlineCitation: true,
    requireSectionHeadings: false,
    minimumDistinctInlineSources: Math.min(2, allowedSourceUrls.length),
    minimumBodyInformationChars: 180,
    allowTrustedLocalMediaFigures: true
  });
  if (!article.ok) {
    return { ok: false, reason: `改写稿仍未通过发布检查：${article.reason}` };
  }
  if (input.generatedArtifact) {
    const metadata = assessGeneratedPostMetadata(input.title, input.summary, reviewContent);
    if (!metadata.ok) return metadata;
  }
  return { ok: true, clearPublicationBlock: Boolean(input.publicationBlockedReason) };
}

function assessGeneratedPostMetadata(title: string, summary: string, markdown: string): PostPublicationAssessment {
  const firstLine = markdown.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
  const markdownTitle = firstLine.match(/^#\s+(.+?)\s*#*\s*$/)?.[1] || "";
  const titleKey = normalizeVisibleClaim(title);
  const markdownTitleKey = normalizeVisibleClaim(markdownTitle);
  if (!titleKey || !markdownTitleKey || titleKey !== markdownTitleKey) {
    return { ok: false, reason: "文章标题与 Markdown 首行一级标题不一致，生成稿不能发布" };
  }

  const highRiskSummaryClaims = highRiskGeneratedClaimSegments(summary);
  if (!highRiskSummaryClaims.length) return { ok: true, clearPublicationBlock: false };

  const bodyBlocks = generatedArticleProseBlocks(markdown);
  for (const claim of highRiskSummaryClaims) {
    const claimKey = normalizeVisibleClaim(claim);
    if (!claimKey || !bodyBlocks.some((block) => block.some((variant) => variant.includes(claimKey)))) {
      return {
        ok: false,
        reason: `摘要中的高风险事实未在已核验正文中出现：${claim.slice(0, 80)}`
      };
    }
  }
  return { ok: true, clearPublicationBlock: false };
}

function generatedArticleProseBlocks(markdown: string) {
  const references = markdown.match(/^##\s*参考来源\s*$/im);
  const body = references?.index === undefined ? markdown : markdown.slice(0, references.index);
  const visibleBody = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/`[^`\r\n]*`/g, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line) && !/^\s{0,3}\[[^\]\r\n]+]:\s*\S+/.test(line))
    .join("\n");

  return visibleBody
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const withoutLinks = block.replace(/\[([^\]]+)]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1");
      const withoutLinkLabels = block.replace(/\[[^\]]+]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ");
      return [...new Set([normalizeVisibleClaim(withoutLinks), normalizeVisibleClaim(withoutLinkLabels)])]
        .filter(Boolean);
    });
}

function normalizeVisibleClaim(value: string) {
  return decodeBasicEntities(typeof value === "string" ? value : "")
    .normalize("NFKC")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/[^\s<>'"`]+/gi, " ")
    .replace(/[`*_~]/g, " ")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function decodeBasicEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
    if (decimal || hex) {
      const codePoint = decimal ? Number(decimal) : Number.parseInt(hex, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    }
    return entities[String(name).toLowerCase()] ?? match;
  });
}

export function extractResearchSourceUrls(markdown?: string | null, sourceUrl?: string | null) {
  // WEB/RSS summaries were generated from exactly one canonical page. Links
  // and images embedded inside that page's Markdown are not independent fact
  // sources and must never inflate the release threshold or whitelist.
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) return [sourceUrl];

  // Keyword/digest artifacts use the worker-written machine manifest. The
  // readable excerpts may legally contain H2s and numbered links, and are not
  // safe to reinterpret as a source whitelist.
  return extractTrustedEvidenceManifest(markdown).map((item) => item.url);
}
