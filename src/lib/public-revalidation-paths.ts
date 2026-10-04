import { normalizePublicRevalidationPath } from "./internal-revalidation";
import { isLanguageExemptPath, stripLanguagePrefix, SUPPORTED_LANGUAGES, withLanguagePrefix } from "./language";

/** ISR entries are keyed by the actual localized URL, not its redirect alias. */
export function publicRevalidationPaths(extra: Array<string | null | undefined> = []) {
  const paths = new Set<string>();
  for (const value of ["/", "/posts", "/stats", "/feed.xml", "/sitemap.xml", ...extra]) {
    const safe = value ? normalizePublicRevalidationPath(value) : null;
    if (!safe) continue;
    const bare = normalizePublicRevalidationPath(stripLanguagePrefix(safe));
    if (!bare) continue;
    paths.add(safe);
    paths.add(bare);
    if (isLanguageExemptPath(bare)) continue;
    for (const language of SUPPORTED_LANGUAGES) paths.add(withLanguagePrefix(language, bare));
  }
  return [...paths];
}
