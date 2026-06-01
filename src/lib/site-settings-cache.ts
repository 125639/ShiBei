import { unstable_cache } from "next/cache";
import { DEFAULT_LANGUAGE } from "./language";
import { prisma } from "./prisma";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "./themes";

export const getCachedSiteChromeSettings = unstable_cache(
  async () => {
    const settings = await prisma.siteSettings.findUnique({
      where: { id: "site" },
      select: {
        name: true,
        description: true,
        defaultTheme: true,
        defaultFont: true,
        defaultLanguage: true,
        defaultSettingsUI: true
      }
    });

    return {
      name: settings?.name || "ShiBei",
      description: settings?.description || "抓取、整理、发布信息",
      defaultTheme: settings?.defaultTheme || DEFAULT_THEME,
      defaultFont: settings?.defaultFont || DEFAULT_FONT,
      defaultDensity: DEFAULT_DENSITY,
      defaultLanguage: settings?.defaultLanguage || DEFAULT_LANGUAGE,
      defaultSettingsUI: settings?.defaultSettingsUI || "classic"
    };
  },
  ["site-chrome-settings"],
  { revalidate: 60, tags: ["site-settings"] }
);
