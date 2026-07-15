export type PendingPostRevision = {
  title: string;
  titleEn: string | null;
  summary: string;
  summaryEn: string | null;
  content: string;
  contentEn: string | null;
  sourceUrl: string | null;
  sortOrder: number;
  tags: string[];
  gateReason: string;
  savedAt: string;
};

export function failedPublicationStorage(status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  return status === "PUBLISHED" ? "pending" as const : "draft" as const;
}

export function revisionMediaBlockedRedirect(path: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}revisionMediaBlocked=1`;
}

export function parsePendingPostRevision(value: unknown): PendingPostRevision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.title !== "string"
    || typeof row.summary !== "string"
    || typeof row.content !== "string"
    || typeof row.sortOrder !== "number"
    || !Number.isFinite(row.sortOrder)
    || !Array.isArray(row.tags)
    || row.tags.some((tag) => typeof tag !== "string")
    || typeof row.gateReason !== "string"
    || typeof row.savedAt !== "string"
  ) return null;

  return {
    title: row.title,
    titleEn: optionalString(row.titleEn),
    summary: row.summary,
    summaryEn: optionalString(row.summaryEn),
    content: row.content,
    contentEn: optionalString(row.contentEn),
    sourceUrl: optionalString(row.sourceUrl),
    sortOrder: Math.trunc(row.sortOrder),
    tags: [...new Set((row.tags as string[]).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
    gateReason: row.gateReason.slice(0, 500),
    savedAt: row.savedAt
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
