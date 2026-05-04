export function buildAudienceEstimateUrl(sourceId: string) {
  return `audience://estimate?sourceId=${encodeURIComponent(sourceId)}`;
}

export function parseAudienceEstimateUrl(value: string) {
  if (!value.startsWith("audience://estimate")) return null;
  try {
    const url = new URL(value);
    const sourceId = url.searchParams.get("sourceId");
    if (!sourceId) return null;
    return { sourceId };
  } catch {
    return null;
  }
}
