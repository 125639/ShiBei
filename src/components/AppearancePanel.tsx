"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { I18nText } from "@/components/I18nText";
import { DEFAULT_LANGUAGE, isLanguageKey } from "@/lib/language";
import {
  DEFAULT_DENSITY,
  DEFAULT_FONT,
  DEFAULT_THEME,
  THEMES,
  UI_STYLES,
  isDensityKey,
  isFontKey,
  isThemeKey,
  isUiStyleKey,
  type ThemeKey
} from "@/lib/themes";
import {
  DEFAULT_QUICK_STYLE,
  applyQuickStyle,
  clampHue,
  persistQuickStyle,
  readQuickStyle,
  type PostsLayoutMode,
  type QuickStyle,
  type WallpaperMode
} from "@/lib/quick-style";
import { useUserPrefs } from "./useUserPrefs";
import { useDismissableOverlay } from "./useDismissableOverlay";

type AppearanceDefaults = {
  theme?: string;
  font?: string;
  density?: string;
  language?: string;
  ui?: string;
};

/**
 * 外观面板：原「主题」（颜色主题切换）与「美化」（色相/壁纸/布局/横幅）
 * 两个头部入口合并成一个，减少重复心智。所有调整仍即点即变；
 * 大型设置（字体/风格/语言）继续放在 /settings。
 */
export function AppearancePanel({ siteDefaults }: { siteDefaults?: AppearanceDefaults }) {
  const [open, setOpen] = useState(false);
  const [qs, setQs] = useState<QuickStyle>(DEFAULT_QUICK_STYLE);
  const [hydrated, setHydrated] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const defaults = useMemo(() => normalizeDefaults(siteDefaults), [siteDefaults]);
  const { prefs, update, hydrated: prefsHydrated } = useUserPrefs(defaults);
  const currentTheme = THEMES.find((theme) => theme.key === prefs.theme) || THEMES[0];
  const isEnglish = prefsHydrated && prefs.language === "en";

  // 当前生效的界面风格：决定是否显示「横幅设置」（仅 Firefly 有横幅）。
  const effectiveUi = prefs.ui === "system" ? defaults.ui : prefs.ui;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQs(readQuickStyle());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useDismissableOverlay(open, rootRef, () => setOpen(false), triggerRef);

  function commit(partial: Partial<QuickStyle>) {
    setQs((prev) => {
      const next = { ...prev, ...partial };
      applyQuickStyle(next);
      persistQuickStyle(next);
      return next;
    });
  }

  function resetAll() {
    applyQuickStyle(DEFAULT_QUICK_STYLE);
    persistQuickStyle(DEFAULT_QUICK_STYLE);
    setQs(DEFAULT_QUICK_STYLE);
    update({ theme: defaults.theme });
  }

  const isDefault =
    qs.hue === null &&
    qs.wallpaper === "default" &&
    qs.postsLayout === "default" &&
    qs.ffBanner &&
    prefs.theme === defaults.theme;

  return (
    <div className="theme-switcher quick-style" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-switcher-trigger"
        aria-expanded={open}
        aria-controls="appearance-menu"
        aria-label={isEnglish ? "Appearance" : "外观设置"}
        onClick={() => setOpen((value) => !value)}
      >
        <ThemeSwatch colors={currentTheme.swatch} />
        <span className="theme-switcher-label">
          <I18nText zh="外观" en="Appearance" />
        </span>
      </button>

      <div id="appearance-menu" className="quick-style-menu" hidden={!open}>
        <section className="quick-style-section">
          <div className="quick-style-heading">
            <h4><I18nText zh="颜色主题" en="Color Theme" /></h4>
          </div>
          <div className="quick-style-options appearance-theme-grid" role="group" aria-label={isEnglish ? "Color theme" : "颜色主题"}>
            {THEMES.map((theme) => {
              const active = prefs.theme === theme.key;
              return (
                <button
                  key={theme.key}
                  type="button"
                  aria-pressed={active}
                  className={`quick-style-option${active ? " active" : ""}`}
                  onClick={() => update({ theme: theme.key as ThemeKey })}
                >
                  <ThemeSwatch colors={theme.swatch} />
                  <span>{theme.label}</span>
                  {active ? <span className="quick-style-check" aria-hidden>✓</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="quick-style-section">
          <div className="quick-style-heading">
            <h4><I18nText zh="主题色相" en="Accent Hue" /></h4>
            <span className="quick-style-badge">
              {qs.hue !== null ? `${qs.hue}°` : <I18nText zh="跟随主题" en="Theme" />}
            </span>
          </div>
          <input
            className="quick-style-hue"
            type="range"
            min={0}
            max={360}
            step={1}
            value={qs.hue ?? 210}
            disabled={!hydrated}
            aria-label={isEnglish ? "Accent hue" : "主题色相"}
            aria-valuetext={qs.hue !== null ? `${qs.hue}°` : (isEnglish ? "Follow theme" : "跟随主题")}
            onChange={(event) => commit({ hue: clampHue(Number(event.target.value)) })}
          />
          {qs.hue !== null ? (
            <button type="button" className="quick-style-clear" onClick={() => commit({ hue: null })}>
              <I18nText zh="↺ 恢复主题原色" en="↺ Use theme color" />
            </button>
          ) : null}
        </section>

        <section className="quick-style-section">
          <div className="quick-style-heading">
            <h4><I18nText zh="壁纸模式" en="Wallpaper" /></h4>
          </div>
          <div className="quick-style-options" role="group" aria-label={isEnglish ? "Wallpaper mode" : "壁纸模式"}>
            {([
              { key: "default", zh: "跟随主题", en: "Theme default" },
              { key: "aurora", zh: "光晕壁纸", en: "Aurora glow" },
              { key: "plain", zh: "纯色背景", en: "Plain color" }
            ] as Array<{ key: WallpaperMode; zh: string; en: string }>).map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={qs.wallpaper === option.key}
                className={`quick-style-option${qs.wallpaper === option.key ? " active" : ""}`}
                onClick={() => commit({ wallpaper: option.key })}
              >
                <span><I18nText zh={option.zh} en={option.en} /></span>
                {qs.wallpaper === option.key ? <span className="quick-style-check" aria-hidden>✓</span> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="quick-style-section">
          <div className="quick-style-heading">
            <h4><I18nText zh="文章布局" en="Posts Layout" /></h4>
          </div>
          <div className="quick-style-options quick-style-options-row" role="group" aria-label={isEnglish ? "Posts layout" : "文章布局"}>
            {([
              { key: "default", zh: "默认", en: "Default" },
              { key: "grid", zh: "网格", en: "Grid" },
              { key: "list", zh: "列表", en: "List" }
            ] as Array<{ key: PostsLayoutMode; zh: string; en: string }>).map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={qs.postsLayout === option.key}
                className={`quick-style-option${qs.postsLayout === option.key ? " active" : ""}`}
                onClick={() => commit({ postsLayout: option.key })}
              >
                <span><I18nText zh={option.zh} en={option.en} /></span>
                {qs.postsLayout === option.key ? <span className="quick-style-check" aria-hidden>✓</span> : null}
              </button>
            ))}
          </div>
        </section>

        {effectiveUi === "firefly" ? (
          <section className="quick-style-section">
            <div className="quick-style-heading">
              <h4><I18nText zh="横幅设置" en="Banner" /></h4>
            </div>
            <label className="quick-style-switch">
              <span><I18nText zh="首页壁纸横幅" en="Wallpaper banner" /></span>
              <input
                type="checkbox"
                checked={qs.ffBanner}
                onChange={(event) => commit({ ffBanner: event.target.checked })}
              />
              <span className="quick-style-switch-track" aria-hidden />
            </label>
          </section>
        ) : null}

        <footer className="quick-style-footer">
          <button type="button" className="quick-style-clear" onClick={resetAll} disabled={isDefault}>
            <I18nText zh="全部恢复默认" en="Reset all" />
          </button>
          <a className="quick-style-more" href="/settings">
            <I18nText zh="更多设置 →" en="More settings →" />
          </a>
        </footer>
      </div>
    </div>
  );
}

function ThemeSwatch({ colors }: { colors: readonly string[] }) {
  return (
    <span className="theme-switcher-swatch" aria-hidden="true">
      {colors.slice(0, 4).map((color, index) => (
        <span key={`${color}-${index}`} style={{ background: color }} />
      ))}
    </span>
  );
}

function normalizeDefaults(siteDefaults?: AppearanceDefaults) {
  return {
    theme: isThemeKey(siteDefaults?.theme) ? siteDefaults.theme : DEFAULT_THEME,
    font: isFontKey(siteDefaults?.font) ? siteDefaults.font : DEFAULT_FONT,
    density: isDensityKey(siteDefaults?.density) ? siteDefaults.density : DEFAULT_DENSITY,
    language: isLanguageKey(siteDefaults?.language) ? siteDefaults.language : DEFAULT_LANGUAGE,
    ui: isUiStyleKey(siteDefaults?.ui) ? siteDefaults.ui : UI_STYLES[0].key
  };
}
