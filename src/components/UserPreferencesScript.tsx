import { DEFAULT_LANGUAGE } from "@/lib/language";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME, PREF_KEYS } from "@/lib/themes";

/**
 * Pre-hydration script: applies stored theme/font/density to <html> before
 * React mounts, so users don't see a flash of the wrong theme.
 *
 * Receives the admin-configured default theme as a prop so first-visit users
 * see the admin's choice, while returning users see their saved preference.
 */
export function UserPreferencesScript({
  defaultTheme = DEFAULT_THEME,
  defaultFont = DEFAULT_FONT,
  defaultDensity = DEFAULT_DENSITY,
  defaultLanguage = DEFAULT_LANGUAGE,
  defaultSettingsUI = "classic"
}: {
  defaultTheme?: string;
  defaultFont?: string;
  defaultDensity?: string;
  defaultLanguage?: string;
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
      language: ${JSON.stringify(defaultLanguage)},
      ui: ${JSON.stringify(defaultSettingsUI)}
    };
    var theme = localStorage.getItem(k.theme) || def.theme;
    var font = localStorage.getItem(k.font) || def.font;
    var density = localStorage.getItem(k.density) || def.density;
    var language = localStorage.getItem(k.language) || def.language;
    var ui = localStorage.getItem(k.ui);
    if (ui !== 'classic' && ui !== 'cyber' && ui !== 'dynamic') ui = def.ui;
    
    doc.setAttribute('data-theme', theme);
    doc.setAttribute('data-font', font);
    doc.setAttribute('data-density', density);
    doc.setAttribute('data-language', language);
    doc.setAttribute('data-ui', ui);
    doc.lang = language === 'en' ? 'en' : 'zh-CN';
  } catch (e) { /* localStorage may be blocked; defaults still apply via CSS */ }
})();
`.trim();

  return <script dangerouslySetInnerHTML={{ __html: inline }} />;
}
