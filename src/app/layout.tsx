import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";
import { UserPreferencesScript } from "@/components/UserPreferencesScript";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "@/lib/themes";
import { CustomCursor } from "@/components/CustomCursor";

export const metadata: Metadata = {
  title: "拾贝 信息博客",
  description: "抓取信息、AI 整理、人工审核发布的个人博客。"
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let defaultTheme: string = DEFAULT_THEME;
  let defaultFont: string = DEFAULT_FONT;
  const defaultDensity: string = DEFAULT_DENSITY;
  let defaultLanguage: string = DEFAULT_LANGUAGE;
  let defaultSettingsUI: string = "classic";

  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
    if (settings) {
      const dt = (settings as { defaultTheme?: string }).defaultTheme;
      const df = (settings as { defaultFont?: string }).defaultFont;
      const dl = (settings as { defaultLanguage?: string }).defaultLanguage;
      const ui = (settings as { defaultSettingsUI?: string }).defaultSettingsUI;
      if (dt) defaultTheme = dt;
      if (df) defaultFont = df;
      if (dl) defaultLanguage = dl;
      if (ui) defaultSettingsUI = ui;
    }
  } catch {
    // DB may not yet be migrated; fall back to compile-time defaults.
  }

  return (
    <html lang={defaultLanguage === "en" ? "en" : "zh-CN"} data-theme={defaultTheme} data-font={defaultFont} data-density={defaultDensity} data-language={defaultLanguage} data-ui={defaultSettingsUI}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#9f4f2f" />
        <UserPreferencesScript
          defaultTheme={defaultTheme}
          defaultFont={defaultFont}
          defaultDensity={defaultDensity}
          defaultLanguage={defaultLanguage}
          defaultSettingsUI={defaultSettingsUI}
        />
      </head>
      <body>
        {children}
        <CustomCursor />
      </body>
    </html>
  );
}
