import { PublicShell } from "@/components/PublicShell";
import { SettingsPageSwitcher } from "@/components/SettingsPageSwitcher";
import { DEFAULT_LANGUAGE, isLanguageKey, type LanguageKey } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_DENSITY,
  DEFAULT_FONT,
  DEFAULT_THEME,
  isFontKey,
  isThemeKey,
  type DensityKey,
  type FontKey,
  type ThemeKey
} from "@/lib/themes";

export const dynamic = "force-dynamic";

type SettingsUi = "system" | "classic" | "cyber" | "dynamic";

export default async function SettingsPage() {
  let theme: ThemeKey = DEFAULT_THEME;
  let font: FontKey = DEFAULT_FONT;
  const density: DensityKey = DEFAULT_DENSITY;
  let language: LanguageKey = DEFAULT_LANGUAGE;
  let ui: SettingsUi = "classic";
  let musicEnabled = false;

  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
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
    <PublicShell>
      <main className="container" style={{ position: "relative", zIndex: 10 }}>
        <p className="eyebrow" style={ui === "cyber" ? { color: "#00f0ff" } : {}}>User</p>
        <h1 className="page-title">设置</h1>
        <p className="muted-block" style={{ maxWidth: 720, margin: "16px 0 26px" }}>
          这些选择只保存在你自己的浏览器中（localStorage）。
          如要恢复管理员设定，点击底部的「恢复默认」。
        </p>
        <SettingsPageSwitcher
          siteDefaults={{ theme, font, density, language, ui, musicEnabled }}
        />
      </main>
    </PublicShell>
  );
}

function isSettingsUi(value: string | null | undefined): value is SettingsUi {
  return value === "system" || value === "classic" || value === "cyber" || value === "dynamic";
}
