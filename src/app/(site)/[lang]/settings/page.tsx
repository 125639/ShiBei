import { localizedAlternates } from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";
import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { UserSettingsClient } from "@/components/UserSettingsClient";
import { DEFAULT_LANGUAGE, isLanguageKey, type LanguageKey } from "@/lib/language";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
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

// 站点默认值来自共享的 site-chrome 缓存（site-settings 标签，保存即失效）；
// 整页 ISR 复用 HTML，不再每请求查库。
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const language = setRequestLanguage((await params).lang);
  return {
    title: "设置",
    description: "个性化主题、字体、密度、语言与背景音乐，只保存在你的浏览器中。",
    robots: { index: false },
    alternates: localizedAlternates(language, "/settings")
  };
}

type SettingsUi = "system" | UiStyleKey;

export default async function SettingsPage() {
  let theme: ThemeKey = DEFAULT_THEME;
  let font: FontKey = DEFAULT_FONT;
  const density: DensityKey = DEFAULT_DENSITY;
  let language: LanguageKey = DEFAULT_LANGUAGE;
  let ui: SettingsUi = "classic";
  let musicEnabled = false;

  try {
    const settings = await getCachedSiteChromeSettings();
    const dt = settings.defaultTheme as string | undefined;
    const df = settings.defaultFont as string | undefined;
    const dl = settings.defaultLanguage as string | undefined;
    const dui = settings.defaultSettingsUI as string | undefined;
    if (isThemeKey(dt)) theme = dt;
    if (isFontKey(df)) font = df;
    if (isLanguageKey(dl)) language = dl;
    if (isSettingsUi(dui)) ui = dui;
    musicEnabled = settings.musicEnabledDefault === true;
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
