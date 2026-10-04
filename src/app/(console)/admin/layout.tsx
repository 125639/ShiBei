import type { Metadata, Viewport } from "next";
// 网络字体已移除：字体栈以系统中文字体为准（见 globals.css）。
import "../../globals.css";
import "../../design-system.css";
import "../../ui-polish.css";
import "../../admin-panel.css";
import "../../admin-performance.css";
import { AdminLanguageScope } from "@/components/AdminLanguageScope";
import { AdminUiScope } from "@/components/AdminUiScope";
import { NavigationProgress } from "@/components/NavigationProgress";
import { MobileViewport } from "@/components/mobile/MobileViewport";
import "../../mobile.css";
import { ADMIN_LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE, isLanguageKey } from "@/lib/language";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { DEFAULT_DENSITY, DEFAULT_FONT, isUiStyleKey } from "@/lib/themes";

// 后台专属深色面板主题（KPanel 风格）。token 定义在 admin-panel.css，
// "panel" 不在 lib/themes.ts 的 THEMES 里，因此永远不会被站点设置或
// 访客个人偏好选中——它是后台独有的值。
const ADMIN_THEME = "panel";

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
  viewportFit: "cover",
  interactiveWidget: "resizes-content"
};

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const rawDefaultLanguage = settings?.defaultLanguage;
  const siteDefaultLanguage = isLanguageKey(rawDefaultLanguage)
    ? rawDefaultLanguage
    : DEFAULT_LANGUAGE;
  const siteDefaultUi = isUiStyleKey(settings?.defaultSettingsUI) ? settings.defaultSettingsUI : "classic";
  const defaultFont = settings?.defaultFont ?? DEFAULT_FONT;

  // 后台界面语言使用独立的 shibei.admin.language。data-ui 固定为 classic、
  // data-theme 固定为 panel：后台是管理员的工作区，不应该被访客在公开页
  // 选的个人外观（主题/风格/壁纸…）接管。内联脚本保证整页加载时在绘制前
  // 生效（不闪错语言/风格/主题）；客户端路由切换时由 AdminLanguageScope /
  // AdminUiScope 的 effect 接管，离开后台时再恢复前台各自的偏好。这里刻意
  // 不挂 UserPreferencesScript：它会按 shibei.theme 覆盖 data-theme，让
  // 后台跟着访客的前台主题漂移。
  const inline = `
(function() {
  try {
    var doc = document.documentElement;
    var lang = localStorage.getItem(${JSON.stringify(ADMIN_LANGUAGE_STORAGE_KEY)});
    if (lang !== "zh" && lang !== "en") lang = ${JSON.stringify(siteDefaultLanguage)};
    doc.setAttribute("data-language", lang);
    doc.lang = lang === "en" ? "en" : "zh-CN";
    doc.setAttribute("data-ui", "classic");
    doc.setAttribute("data-theme", ${JSON.stringify(ADMIN_THEME)});
  } catch (e) { /* localStorage may be blocked; site default still applies */ }
})();
`.trim();

  return (
    <html
      lang={siteDefaultLanguage === "en" ? "en" : "zh-CN"}
      data-theme={ADMIN_THEME}
      data-font={defaultFont}
      data-density={DEFAULT_DENSITY}
      data-language={siteDefaultLanguage}
      data-ui="classic"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: inline }} />
      </head>
      <body>
        <MobileViewport />
          <NavigationProgress />
        <AdminLanguageScope siteDefaultLanguage={siteDefaultLanguage} />
        <AdminUiScope siteDefaultUi={siteDefaultUi} />
        {children}
      </body>
    </html>
  );
}
