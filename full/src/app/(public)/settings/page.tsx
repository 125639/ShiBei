import { PublicShell } from "@/components/PublicShell";
import { SettingsPageSwitcher } from "@/components/SettingsPageSwitcher";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "@/lib/themes";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let theme: string = DEFAULT_THEME;
  let font: string = DEFAULT_FONT;
  const density: string = DEFAULT_DENSITY;
  let language: string = DEFAULT_LANGUAGE;
  let ui: string = "classic";
  let musicEnabled = false;

  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
    if (settings) {
      const dt = (settings as { defaultTheme?: string }).defaultTheme;
      const df = (settings as { defaultFont?: string }).defaultFont;
      const dl = (settings as { defaultLanguage?: string }).defaultLanguage;
      const dui = (settings as { defaultSettingsUI?: string }).defaultSettingsUI;
      const me = (settings as { musicEnabledDefault?: boolean }).musicEnabledDefault;
      if (dt) theme = dt;
      if (df) font = df;
      if (dl) language = dl;
      if (dui) ui = dui;
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
