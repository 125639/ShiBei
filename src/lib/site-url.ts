export function siteOrigin() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function absoluteSiteUrl(path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, siteOrigin()).toString();
}
