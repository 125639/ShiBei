import { AdminLanguageScope } from "@/components/AdminLanguageScope";
import { ADMIN_LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE, isLanguageKey } from "@/lib/language";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const rawDefaultLanguage = settings?.defaultLanguage;
  const siteDefaultLanguage = isLanguageKey(rawDefaultLanguage)
    ? rawDefaultLanguage
    : DEFAULT_LANGUAGE;

  // 后台界面语言使用独立的 shibei.admin.language，覆盖 <head> 里
  // UserPreferencesScript 按前台访客偏好（shibei.language）设置的 data-language。
  // 内联脚本保证整页加载时在绘制前生效（不闪错语言）；客户端路由进入 /admin 时
  // 由 AdminLanguageScope 的 effect 接管，离开后台时再恢复前台语言。
  const inline = `
(function() {
  try {
    var doc = document.documentElement;
    var lang = localStorage.getItem(${JSON.stringify(ADMIN_LANGUAGE_STORAGE_KEY)});
    if (lang !== "zh" && lang !== "en") lang = ${JSON.stringify(siteDefaultLanguage)};
    doc.setAttribute("data-language", lang);
    doc.lang = lang === "en" ? "en" : "zh-CN";
  } catch (e) { /* localStorage may be blocked; site default still applies */ }
})();
`.trim();

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: inline }} />
      <AdminLanguageScope siteDefaultLanguage={siteDefaultLanguage} />
      {children}
    </>
  );
}
