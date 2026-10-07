export type LanguageKey = "zh" | "en";
export type ContentLanguageMode = "default-language" | "bilingual";

export const DEFAULT_LANGUAGE: LanguageKey = "zh";

// 管理后台界面语言与前台访客偏好（shibei.language）刻意分离：
// 后台用独立的 localStorage 键保存，互不影响。
export const ADMIN_LANGUAGE_STORAGE_KEY = "shibei.admin.language";
export const ADMIN_LANGUAGE_EVENT = "shibei:admin-language-change";

export const LANGUAGE_OPTIONS: Array<{ value: LanguageKey; label: string; description: string }> = [
  { value: "zh", label: "中文", description: "默认显示中文界面与中文正文。" },
  { value: "en", label: "English", description: "用户打开文章时可自动翻译为英文。" }
];

export const CONTENT_LANGUAGE_MODE_OPTIONS: Array<{ value: ContentLanguageMode; label: string; description: string }> = [
  {
    value: "default-language",
    label: "默认语种模式 / Default language",
    description: "前台默认显示中文；用户可在设置中切换英文，打开文章时按需 AI 翻译。"
  },
  {
    value: "bilingual",
    label: "双语模式 / Bilingual",
    description: "文章页同时展示中文与英文缓存；英文缺失时打开文章会自动生成。"
  }
];

export function isLanguageKey(value: string | null | undefined): value is LanguageKey {
  return value === "zh" || value === "en";
}

// ============ 路由级 i18n ============
// 公开站的每个语种都有独立 URL（/zh/... 与 /en/...），这样英文版才能被搜索
// 引擎单独索引，也才能互发链接。后台 /admin 不参与：它在 robots.txt 里被
// disallow，且有自己的 shibei.admin.language 即时切换器（见 AdminLanguageScope）。

export const SUPPORTED_LANGUAGES: readonly LanguageKey[] = ["zh", "en"];

/** `/zh`、`/en/posts/x` 开头的语言段；`/enigma` 这类同前缀单词不会误命中。 */
const LANGUAGE_PREFIX_RE = /^\/(zh|en)(?=\/|$)/;

/** 从路径中读出语言段；没有语言段返回 null。 */
export function languageFromPath(path: string): LanguageKey | null {
  const matched = LANGUAGE_PREFIX_RE.exec(path);
  return matched && isLanguageKey(matched[1]) ? matched[1] : null;
}

/** 去掉语言段，得到与语言无关的规范路径（`/zh/posts/x` → `/posts/x`，`/zh` → `/`）。 */
export function stripLanguagePrefix(path: string): string {
  const stripped = path.replace(LANGUAGE_PREFIX_RE, "");
  return stripped === "" ? "/" : stripped;
}

/** 给与语言无关的路径加上语言段（`/posts/x` → `/zh/posts/x`，`/` → `/zh`）。 */
export function withLanguagePrefix(language: LanguageKey, path: string): string {
  const bare = stripLanguagePrefix(path.startsWith("/") ? path : `/${path}`);
  return bare === "/" ? `/${language}` : `/${language}${bare}`;
}

/**
 * 不参与语言前缀的路径前缀。
 *
 * /admin 有自己的语言机制（shibei.admin.language，客户端即时切换，不经导航），
 * 且在 robots.txt 里被 disallow，做多语种 URL 零收益。其余是接口、静态资源与
 * 站点级元数据文件，它们没有「语言版本」的概念。
 */
const LANGUAGE_EXEMPT_PREFIXES = [
  "/admin",
  "/api",
  "/uploads",
  "/_next",
  "/feed.xml",
  "/robots.txt",
  "/sitemap.xml"
];

export function isLanguageExemptPath(path: string): boolean {
  return LANGUAGE_EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
  );
}

/**
 * 把站内链接改写到指定语言。用于所有 <Link href>，因此必须对「不该改写的
 * 东西」保持原样：外链、协议相对地址、mailto/tel、纯锚点、查询串开头，
 * 以及 isLanguageExemptPath 覆盖的后台/接口/静态资源路径。
 *
 * 已带语言段的路径会被替换而不是叠加（withLanguagePrefix 保证幂等）。
 */
export function localizeHref(language: LanguageKey, href: string): string {
  if (!href) return href;
  // 外链、协议相对、mailto:/tel:、锚点、查询串：一律不动
  if (!href.startsWith("/") || href.startsWith("//")) return href;

  const boundary = href.search(/[?#]/);
  const pathname = boundary >= 0 ? href.slice(0, boundary) : href;
  const suffix = boundary >= 0 ? href.slice(boundary) : "";
  if (isLanguageExemptPath(pathname)) return href;
  return `${withLanguagePrefix(language, pathname)}${suffix}`;
}

/** Accept-Language 协商：仅在明确更偏好英文时返回 en，其余一律中文。 */
export function negotiateLanguage(acceptLanguage: string | null | undefined): LanguageKey {
  if (!acceptLanguage) return DEFAULT_LANGUAGE;
  let best: { language: LanguageKey; quality: number } | null = null;
  for (const part of acceptLanguage.split(",")) {
    const [tagRaw, ...params] = part.trim().split(";");
    const tag = tagRaw.trim().toLowerCase();
    if (!tag) continue;
    const language: LanguageKey | null = tag === "*"
      ? DEFAULT_LANGUAGE
      : tag.startsWith("zh")
        ? "zh"
        : tag.startsWith("en")
          ? "en"
          : null;
    if (!language) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const quality = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(quality) || quality <= 0) continue;
    // 同权重时保留先出现的：Accept-Language 本身就是按优先级排的。
    if (!best || quality > best.quality) best = { language, quality };
  }
  return best?.language ?? DEFAULT_LANGUAGE;
}

export function isContentLanguageMode(value: string | null | undefined): value is ContentLanguageMode {
  return value === "default-language" || value === "bilingual";
}

export function languageLabel(value: string | null | undefined) {
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label || "中文";
}

export function contentLanguageModeLabel(value: string | null | undefined) {
  return CONTENT_LANGUAGE_MODE_OPTIONS.find((option) => option.value === value)?.label || "默认语种模式";
}

/** Child metadata replaces alternates rather than inheriting the layout's language map. */
export function localizedAlternates(language: LanguageKey, path: string) {
  return {
    canonical: withLanguagePrefix(language, path),
    languages: {
      "zh-CN": withLanguagePrefix("zh", path),
      en: withLanguagePrefix("en", path),
      "x-default": withLanguagePrefix("zh", path)
    }
  };
}
