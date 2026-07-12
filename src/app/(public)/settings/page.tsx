import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { UserSettingsClient } from "@/components/UserSettingsClient";
import { DEFAULT_LANGUAGE, isLanguageKey, type LanguageKey } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_DENSITY,
  DEFAULT_FONT,
  DEFAULT_THEME,
  isFontKey,
  isThemeKey,
  isUiStyleKey,
  type DensityKey,
  type FontKey,
  type ThemeKey,
  type UiStyleKey
} from "@/lib/themes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "设置",
  description: "个性化主题、字体、密度、语言与背景音乐，只保存在你的浏览器中。",
  robots: { index: false },
  alternates: { canonical: "/settings" }
};

type SettingsUi = "system" | UiStyleKey;

export default async function SettingsPage() {
  let theme: ThemeKey = DEFAULT_THEME;
  let font: FontKey = DEFAULT_FONT;
  const density: DensityKey = DEFAULT_DENSITY;
  let language: LanguageKey = DEFAULT_LANGUAGE;
  let ui: SettingsUi = "classic";
  let musicEnabled = false;

  try {
    const settings = await prisma.siteSettings.findUnique({
      where: { id: "site" },
      select: {
        defaultTheme: true,
        defaultFont: true,
        defaultLanguage: true,
        defaultSettingsUI: true,
        musicEnabledDefault: true
      }
    });
    if (settings) {
      const dt = (settings as { defaultTheme?: string }).defaultTheme;
      const df = (settings as { defaultFont?: string }).defaultFont;
      const dl = (settings as { defaultLanguage?: string }).defaultLanguage;
      const dui = (settings as { defaultSettingsUI?: string }).defaultSettingsUI;
      const me = (settings as { musicEnabledDefault?: boolean }).musicEnabledDefault;
      if (isThemeKey(dt)) theme = dt;
      if (isFontKey(df)) font = df;
      if (isLanguageKey(dl)) language = dl;
      if (isSettingsUi(dui)) ui = dui;
      if (typeof me === "boolean") musicEnabled = me;
    }
  } catch {
    /* DB may not be migrated yet */
  }

  return (
    <main className="container bento-page settings-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">User</p>
        <h1 className="page-title"><I18nText zh="设置" en="Settings" /></h1>
        <p className="muted-block">
          <I18nText
            zh="这些选择只保存在你自己的浏览器中（localStorage）。如要恢复管理员设定，点击底部的「恢复默认」。"
            en="These choices live only in your browser (localStorage). Use “Reset to defaults” at the bottom to restore the admin presets."
          />
        </p>
      </section>
      {/* 全部界面风格共用同一套设置页：风格差异由 data-ui 全局样式承担，
          切换风格时设置页结构与控件尺寸保持稳定。 */}
      <UserSettingsClient siteDefaults={{ theme, font, density, language, ui, musicEnabled }} />
    </main>
  );
}

function isSettingsUi(value: string | null | undefined): value is SettingsUi {
  return value === "system" || isUiStyleKey(value);
}
