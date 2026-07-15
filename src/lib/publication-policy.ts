export const NON_PUBLISHABLE_GENERATION_MARKER = "<!-- shibei:non-publishable-generation -->";

/** A failed or diagnostic generation can never inherit the site's auto-publish flag. */
export function publicationData(autoPublish: boolean, publishable: boolean, now = new Date()) {
  const shouldPublish = autoPublish && publishable;
  return {
    status: shouldPublish ? "PUBLISHED" as const : "DRAFT" as const,
    publishedAt: shouldPublish ? now : null
  };
}

/**
 * Transitional text detection keeps historical fallback posts blocked after the
 * structured database field is introduced. New worker output also carries the
 * stable marker, so wording changes cannot silently reopen the publish path.
 */
export function generationPublicationBlockReason(input: {
  publicationBlockedReason?: string | null;
  summary?: string | null;
  content?: string | null;
  /** Historical wording is only trusted for a worker-owned RawItem artifact. */
  generatedArtifact?: boolean;
}): string | null {
  const structured = input.publicationBlockedReason?.trim();
  if (structured) return structured;
  const summary = (input.summary || "").trim();
  const content = (input.content || "").trim();
  const text = `${summary}\n${content}`;
  if (text.includes(NON_PUBLISHABLE_GENERATION_MARKER)) return "该内容是生成失败后保留的研究草稿";

  // Do not scan arbitrary prose for legacy phrases. Otherwise a perfectly
  // legitimate hand-written incident report quoting an old error message can
  // become permanently publication-blocked. Historical fallbacks are detected
  // either on a known worker artifact, in a diagnostic summary prefix, or in a
  // top-of-document blockquote (the layouts emitted by old workers).
  const diagnosticPrefix = /^(?:AI\s*(?:内容生成|每日要闻|周报综述|日报|周报)请求未完成|资料未达到(?:定时报)?发布门槛|未配置模型或内容风格)(?:[：:,，]|$)/i;
  const topBlockquote = /^(?:#\s+[^\r\n]+\s*)?(?:<!--[^>]*-->\s*)?>\s*((?:AI\s*(?:内容生成|每日要闻|周报综述|日报|周报)请求未完成|资料未达到(?:定时报)?发布门槛|未配置模型或内容风格)(?:[：:,，]|$))/i;
  const legacyText = input.generatedArtifact
    ? text
    : [diagnosticPrefix.test(summary) ? summary : "", topBlockquote.test(content) ? content.slice(0, 1200) : ""].join("\n");

  if (/资料未达到(?:定时报)?发布门槛(?:[：:]|$)/.test(legacyText)) return "研究资料未达到发布门槛";
  if (/未配置模型或内容风格(?:[，,:：]|$)/.test(legacyText)) return "未配置模型或内容风格";
  if (/AI\s*(?:内容生成|每日要闻|周报综述|日报|周报)请求未完成(?:[：:]|$)/i.test(legacyText)) {
    return "AI 内容生成请求未完成";
  }
  return null;
}

export function markNonPublishableGeneration(content: string) {
  if (content.includes(NON_PUBLISHABLE_GENERATION_MARKER)) return content;
  const value = content.trim();
  const firstBreak = value.indexOf("\n");
  if (firstBreak < 0) return `${value}\n\n${NON_PUBLISHABLE_GENERATION_MARKER}`;
  return `${value.slice(0, firstBreak)}\n\n${NON_PUBLISHABLE_GENERATION_MARKER}${value.slice(firstBreak)}`;
}

export function stripNonPublishableGenerationMarker(content: string) {
  return content
    .replaceAll(NON_PUBLISHABLE_GENERATION_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
