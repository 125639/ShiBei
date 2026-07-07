/**
 * 快速美化（Quick Style）——不进设置页的轻量外观微调。
 * 与 themes.ts 的「重设置」（主题/字体/密度/风格）正交：
 * 这里全部是 CSS 变量/属性级的即时覆盖，存 localStorage，
 * 由 UserPreferencesScript 预注水应用，防止首屏闪烁。
 */

export type WallpaperMode = "default" | "aurora" | "plain";
export type PostsLayoutMode = "default" | "grid" | "list";

export type QuickStyle = {
  /** 主题色相 0-360；null = 跟随主题原色 */
  hue: number | null;
  wallpaper: WallpaperMode;
  postsLayout: PostsLayoutMode;
  /** Firefly 风格的壁纸横幅开关 */
  ffBanner: boolean;
};

export const DEFAULT_QUICK_STYLE: QuickStyle = {
  hue: null,
  wallpaper: "default",
  postsLayout: "default",
  ffBanner: true
};

export const QUICK_STYLE_KEYS = {
  hue: "shibei.qs.hue",
  wallpaper: "shibei.qs.wallpaper",
  postsLayout: "shibei.qs.postsLayout",
  ffBanner: "shibei.qs.ffBanner"
} as const;

export function isWallpaperMode(value: string | null | undefined): value is WallpaperMode {
  return value === "default" || value === "aurora" || value === "plain";
}

export function isPostsLayoutMode(value: string | null | undefined): value is PostsLayoutMode {
  return value === "default" || value === "grid" || value === "list";
}

export function clampHue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(360, Math.max(0, Math.round(value)));
}

export function readQuickStyle(): QuickStyle {
  if (typeof window === "undefined") return DEFAULT_QUICK_STYLE;
  try {
    const rawHue = localStorage.getItem(QUICK_STYLE_KEYS.hue);
    const hue = rawHue !== null && rawHue !== "" && Number.isFinite(Number(rawHue)) ? clampHue(Number(rawHue)) : null;
    const wallpaper = localStorage.getItem(QUICK_STYLE_KEYS.wallpaper);
    const postsLayout = localStorage.getItem(QUICK_STYLE_KEYS.postsLayout);
    const ffBanner = localStorage.getItem(QUICK_STYLE_KEYS.ffBanner);
    return {
      hue,
      wallpaper: isWallpaperMode(wallpaper) ? wallpaper : "default",
      postsLayout: isPostsLayoutMode(postsLayout) ? postsLayout : "default",
      ffBanner: ffBanner === null ? true : ffBanner !== "off"
    };
  } catch {
    return DEFAULT_QUICK_STYLE;
  }
}

/** 将快速美化状态落到 <html> 的 data-* 属性与 CSS 变量（与预注水脚本保持一致）。 */
export function applyQuickStyle(qs: QuickStyle) {
  const doc = document.documentElement;
  if (qs.hue !== null) {
    doc.setAttribute("data-hue", "on");
    doc.style.setProperty("--user-hue", String(qs.hue));
  } else {
    doc.removeAttribute("data-hue");
    doc.style.removeProperty("--user-hue");
  }
  if (qs.wallpaper !== "default") doc.setAttribute("data-wallpaper", qs.wallpaper);
  else doc.removeAttribute("data-wallpaper");
  if (qs.postsLayout !== "default") doc.setAttribute("data-posts-layout", qs.postsLayout);
  else doc.removeAttribute("data-posts-layout");
  if (!qs.ffBanner) doc.setAttribute("data-ff-banner", "off");
  else doc.removeAttribute("data-ff-banner");
}

export function persistQuickStyle(qs: QuickStyle) {
  try {
    if (qs.hue !== null) localStorage.setItem(QUICK_STYLE_KEYS.hue, String(qs.hue));
    else localStorage.removeItem(QUICK_STYLE_KEYS.hue);
    if (qs.wallpaper !== "default") localStorage.setItem(QUICK_STYLE_KEYS.wallpaper, qs.wallpaper);
    else localStorage.removeItem(QUICK_STYLE_KEYS.wallpaper);
    if (qs.postsLayout !== "default") localStorage.setItem(QUICK_STYLE_KEYS.postsLayout, qs.postsLayout);
    else localStorage.removeItem(QUICK_STYLE_KEYS.postsLayout);
    if (!qs.ffBanner) localStorage.setItem(QUICK_STYLE_KEYS.ffBanner, "off");
    else localStorage.removeItem(QUICK_STYLE_KEYS.ffBanner);
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
}
