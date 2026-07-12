"use client";

import { useMemo, useRef, useState } from "react";
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
import { useUserPrefs } from "./useUserPrefs";
import { useDismissableOverlay } from "./useDismissableOverlay";

type ThemeQuickSwitchDefaults = {
  theme?: string;
  font?: string;
  density?: string;
  language?: string;
  ui?: string;
};

export function ThemeQuickSwitch({ siteDefaults }: { siteDefaults?: ThemeQuickSwitchDefaults }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const defaults = useMemo(() => normalizeDefaults(siteDefaults), [siteDefaults]);
  const { prefs, update, hydrated } = useUserPrefs(defaults);
  const currentTheme = THEMES.find((theme) => theme.key === prefs.theme) || THEMES[0];
  const isEnglish = hydrated && prefs.language === "en";

  useDismissableOverlay(open, rootRef, () => setOpen(false), triggerRef);

  function chooseTheme(theme: ThemeKey) {
    update({ theme });
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="theme-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-switcher-trigger"
        aria-expanded={open}
        aria-controls="theme-switcher-menu"
        aria-label={isEnglish ? "Change color theme" : "切换颜色主题"}
        onClick={() => setOpen((value) => !value)}
      >
        <ThemeSwatch colors={currentTheme.swatch} />
        <span className="theme-switcher-label">
          <I18nText zh="主题" en="Theme" />
        </span>
      </button>

      <div
        id="theme-switcher-menu"
        className="theme-switcher-menu"
        role="group"
        aria-label={isEnglish ? "Color theme" : "颜色主题"}
        hidden={!open}
      >
        {THEMES.map((theme) => {
          const active = prefs.theme === theme.key;
          return (
            <button
              key={theme.key}
              type="button"
              aria-pressed={active}
              className={`theme-switcher-option${active ? " active" : ""}`}
              onClick={() => chooseTheme(theme.key)}
            >
              <ThemeSwatch colors={theme.swatch} />
              <span>{theme.label}</span>
            </button>
          );
        })}
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

function normalizeDefaults(siteDefaults?: ThemeQuickSwitchDefaults) {
  return {
    theme: isThemeKey(siteDefaults?.theme) ? siteDefaults.theme : DEFAULT_THEME,
    font: isFontKey(siteDefaults?.font) ? siteDefaults.font : DEFAULT_FONT,
    density: isDensityKey(siteDefaults?.density) ? siteDefaults.density : DEFAULT_DENSITY,
    language: isLanguageKey(siteDefaults?.language) ? siteDefaults.language : DEFAULT_LANGUAGE,
    ui: isUiStyleKey(siteDefaults?.ui) ? siteDefaults.ui : UI_STYLES[0].key
  };
}
