import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME, DEFAULT_TOC_ACCENT, PREF_KEYS, UI_STYLE_KEYS } from "@/lib/themes";
import { QUICK_STYLE_KEYS } from "@/lib/quick-style";

/**
 * Pre-hydration script: applies stored theme/font/density to <html> before
 * React mounts, so users don't see a flash of the wrong theme.
 *
 * Receives the admin-configured default theme as a prop so first-visit users
 * see the admin's choice, while returning users see their saved preference.
 *
 * 语言**不在**这里处理：公开站的语言由 URL 的 /zh、/en 段决定，服务端渲染
 * 出来就是最终值。若这里再按 localStorage 覆盖 data-language，就会出现
 * 「URL 是 /en 但 CSS 按 zh 显示」的自相矛盾状态。后台 /admin 的语言由它
 * 自己的 root layout 内联脚本 + AdminLanguageScope 处理。
 */
export function UserPreferencesScript({
  defaultTheme = DEFAULT_THEME,
  defaultFont = DEFAULT_FONT,
  defaultDensity = DEFAULT_DENSITY,
  defaultSettingsUI = "classic"
}: {
  defaultTheme?: string;
  defaultFont?: string;
  defaultDensity?: string;
  defaultSettingsUI?: string;
}) {
  const inline = `
(function() {
  try {
    var doc = document.documentElement;
    var k = ${JSON.stringify(PREF_KEYS)};
    var def = {
      theme: ${JSON.stringify(defaultTheme)},
      font: ${JSON.stringify(defaultFont)},
      density: ${JSON.stringify(defaultDensity)},
      ui: ${JSON.stringify(defaultSettingsUI)}
    };
    var theme = localStorage.getItem(k.theme);
    if (!theme) {
      theme = def.theme;
      // 首次访问且管理员默认是亮色主题时，跟随系统深色模式，避免夜间刺眼。
      // 回退到 panel（与后台同源的深蓝面板色系），品牌一致；dark/midnight 仍可手动选。
      var darkThemes = ['panel', 'dark', 'midnight'];
      if (darkThemes.indexOf(theme) === -1 && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        theme = 'panel';
      }
    }
    var font = localStorage.getItem(k.font) || def.font;
    var density = localStorage.getItem(k.density) || def.density;
    var tocAccent = localStorage.getItem(k.tocAccent);
    var uiKeys = ${JSON.stringify(UI_STYLE_KEYS)};
    var ui = localStorage.getItem(k.ui);
    if (uiKeys.indexOf(ui) === -1) ui = def.ui;

    doc.setAttribute('data-theme', theme);
    doc.setAttribute('data-font', font);
    doc.setAttribute('data-density', density);
    doc.setAttribute('data-ui', ui);
    // Respect a saved animation pause before the first paint (public UI only).
    doc.setAttribute('data-site-motion', localStorage.getItem('shibei.motion') === 'paused' ? 'paused' : 'running');
    doc.style.setProperty('--toc-accent', /^#[0-9a-f]{6}$/i.test(tocAccent || '') ? tocAccent : ${JSON.stringify(DEFAULT_TOC_ACCENT)});

    // 快速美化（色相/壁纸/布局/横幅）：与 lib/quick-style.ts 的 applyQuickStyle 一致
    var qk = ${JSON.stringify(QUICK_STYLE_KEYS)};
    var hue = localStorage.getItem(qk.hue);
    if (hue !== null && hue !== '' && isFinite(Number(hue))) {
      doc.setAttribute('data-hue', 'on');
      doc.style.setProperty('--user-hue', String(Math.min(360, Math.max(0, Math.round(Number(hue))))));
    }
    var wp = localStorage.getItem(qk.wallpaper);
    if (wp === 'aurora' || wp === 'plain') doc.setAttribute('data-wallpaper', wp);
    var pl = localStorage.getItem(qk.postsLayout);
    if (pl === 'grid' || pl === 'list') doc.setAttribute('data-posts-layout', pl);
    if (localStorage.getItem(qk.ffBanner) === 'off') doc.setAttribute('data-ff-banner', 'off');
  } catch (e) { /* localStorage may be blocked; defaults still apply via CSS */ }
})();
`.trim();

  return <script dangerouslySetInnerHTML={{ __html: inline }} />;
}
