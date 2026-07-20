import { AdminLanguageScope } from "@/components/AdminLanguageScope";
import { AdminUiScope } from "@/components/AdminUiScope";
import { ADMIN_LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE, isLanguageKey } from "@/lib/language";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { isUiStyleKey } from "@/lib/themes";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const rawDefaultLanguage = settings?.defaultLanguage;
  const siteDefaultLanguage = isLanguageKey(rawDefaultLanguage)
    ? rawDefaultLanguage
    : DEFAULT_LANGUAGE;
  const siteDefaultUi = isUiStyleKey(settings?.defaultSettingsUI) ? settings.defaultSettingsUI : "classic";

  // 后台界面语言使用独立的 shibei.admin.language，覆盖 <head> 里
  // UserPreferencesScript 按前台访客偏好（shibei.language）设置的 data-language。
  // 同理，data-ui 固定为 classic：后台是管理员的工作区，不应该被访客在公开页
  // 选的个人外观风格（喵喵/赛博/玻璃…）接管。内联脚本保证整页加载时在绘制前
  // 生效（不闪错语言/风格）；客户端路由进入 /admin 时由 AdminLanguageScope /
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
    <>
      <script dangerouslySetInnerHTML={{ __html: inline }} />
      <AdminLanguageScope siteDefaultLanguage={siteDefaultLanguage} />
      <AdminUiScope siteDefaultUi={siteDefaultUi} />
      {children}
    </>
  );
}
