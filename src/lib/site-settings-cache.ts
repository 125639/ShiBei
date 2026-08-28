import { unstable_cache } from "next/cache";
import { DEFAULT_LANGUAGE } from "./language";
import { prisma } from "./prisma";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "./themes";

const FALLBACK_SITE_CHROME_SETTINGS = {
  name: "ShiBei",
  description: "抓取、整理、发布信息",
  defaultTheme: DEFAULT_THEME,
  defaultFont: DEFAULT_FONT,
  defaultDensity: DEFAULT_DENSITY,
  defaultLanguage: DEFAULT_LANGUAGE,
  defaultSettingsUI: "classic",
  musicEnabledDefault: false
};

export const getCachedSiteChromeSettings = unstable_cache(
  async () => {
    if (!process.env.DATABASE_URL) return FALLBACK_SITE_CHROME_SETTINGS;

    const settings = await prisma.siteSettings.findUnique({
      where: { id: "site" },
      select: {
        name: true,
        description: true,
        defaultTheme: true,
        defaultFont: true,
        defaultLanguage: true,
        defaultSettingsUI: true,
        musicEnabledDefault: true
      }
    }).catch(() => null);

    return {
      ...FALLBACK_SITE_CHROME_SETTINGS,
      name: settings?.name || FALLBACK_SITE_CHROME_SETTINGS.name,
      description: settings?.description || FALLBACK_SITE_CHROME_SETTINGS.description,
      defaultTheme: settings?.defaultTheme || FALLBACK_SITE_CHROME_SETTINGS.defaultTheme,
      defaultFont: settings?.defaultFont || FALLBACK_SITE_CHROME_SETTINGS.defaultFont,
      defaultLanguage: settings?.defaultLanguage || FALLBACK_SITE_CHROME_SETTINGS.defaultLanguage,
      defaultSettingsUI: settings?.defaultSettingsUI || FALLBACK_SITE_CHROME_SETTINGS.defaultSettingsUI,
      musicEnabledDefault:
        typeof settings?.musicEnabledDefault === "boolean"
          ? settings.musicEnabledDefault
          : FALLBACK_SITE_CHROME_SETTINGS.musicEnabledDefault
    };
  },
  ["site-chrome-settings"],
  { revalidate: 60, tags: ["site-settings"] }
);

/** 视频功能总开关：统计页等只需要这一个布尔值时用这个小缓存。 */
export const getCachedVideosEnabled = unstable_cache(
  async () => {
    if (!process.env.DATABASE_URL) return false;
    const settings = await prisma.siteSettings
      .findUnique({ where: { id: "site" }, select: { videosEnabled: true } })
      .catch(() => null);
    return settings?.videosEnabled === true;
  },
  ["videos-enabled"],
  { revalidate: 60, tags: ["site-settings"] }
);
