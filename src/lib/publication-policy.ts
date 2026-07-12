/** A failed or diagnostic generation can never inherit the site's auto-publish flag. */
export function publicationData(autoPublish: boolean, publishable: boolean, now = new Date()) {
  const shouldPublish = autoPublish && publishable;
  return {
    status: shouldPublish ? "PUBLISHED" as const : "DRAFT" as const,
    publishedAt: shouldPublish ? now : null
  };
}
