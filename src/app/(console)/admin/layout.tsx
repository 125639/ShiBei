import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-sc";
import "../../globals.css";
import "../../design-system.css";
import "../../ui-polish.css";
import { AdminLanguageScope } from "@/components/AdminLanguageScope";
import { AdminUiScope } from "@/components/AdminUiScope";
import { NavigationProgress } from "@/components/NavigationProgress";
import { UserPreferencesScript } from "@/components/UserPreferencesScript";
import { ADMIN_LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE, isLanguageKey } from "@/lib/language";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME, isUiStyleKey } from "@/lib/themes";

// 后台是第二个 root layout（公开站是 (site)/[lang]/layout.tsx）。
// 它**不**参与 /zh、/en 路由级 i18n：robots.txt 已 disallow /admin，做多语种
// URL 零 SEO 收益；而且后台的语言切换是客户端即时生效的（不经导航），与
// 「一个 URL 一种语言」的模型天然冲突。这里保留 shibei.admin.language 机制。
export const metadata: Metadata = {
  title: { default: "管理后台", template: "%s · 管理后台" },
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const rawDefaultLanguage = settings?.defaultLanguage;
  const siteDefaultLanguage = isLanguageKey(rawDefaultLanguage)
    ? rawDefaultLanguage
    : DEFAULT_LANGUAGE;
  const siteDefaultUi = isUiStyleKey(settings?.defaultSettingsUI) ? settings.defaultSettingsUI : "classic";
  const defaultTheme = settings?.defaultTheme ?? DEFAULT_THEME;
  const defaultFont = settings?.defaultFont ?? DEFAULT_FONT;

  // 后台界面语言使用独立的 shibei.admin.language。data-ui 固定为 classic：
  // 后台是管理员的工作区，不应该被访客在公开页选的个人外观风格
  // （喵喵/赛博/玻璃…）接管。内联脚本保证整页加载时在绘制前生效
  // （不闪错语言/风格）；客户端路由切换时由 AdminLanguageScope /
  // AdminUiScope 的 effect 接管，离开后台时再恢复前台各自的偏好。
  const inline = `
(function() {
  try {
    var doc = document.documentElement;
    var lang = localStorage.getItem(${JSON.stringify(ADMIN_LANGUAGE_STORAGE_KEY)});
    if (lang !== "zh" && lang !== "en") lang = ${JSON.stringify(siteDefaultLanguage)};
    doc.setAttribute("data-language", lang);
    doc.lang = lang === "en" ? "en" : "zh-CN";
    doc.setAttribute("data-ui", "classic");
  } catch (e) { /* localStorage may be blocked; site default still applies */ }
})();
`.trim();

  return (
    <html
      lang={siteDefaultLanguage === "en" ? "en" : "zh-CN"}
      data-theme={defaultTheme}
      data-font={defaultFont}
      data-density={DEFAULT_DENSITY}
      data-language={siteDefaultLanguage}
      data-ui="classic"
      suppressHydrationWarning
    >
      <head>
        <UserPreferencesScript
          defaultTheme={defaultTheme}
          defaultFont={defaultFont}
          defaultDensity={DEFAULT_DENSITY}
          defaultSettingsUI="classic"
        />
        <script dangerouslySetInnerHTML={{ __html: inline }} />
      </head>
      <body>
        <NavigationProgress />
        <AdminLanguageScope siteDefaultLanguage={siteDefaultLanguage} />
        <AdminUiScope siteDefaultUi={siteDefaultUi} />
        {children}
      </body>
    </html>
  );
}
