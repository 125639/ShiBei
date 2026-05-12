"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_DENSITY,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FONT,
  DEFAULT_THEME,
  CursorStyleKey,
  DensityKey,
  FontKey,
  PREF_KEYS,
  ThemeKey,
  isCursorStyleKey,
  isDensityKey,
  isFontKey,
  isThemeKey
} from "@/lib/themes";
import { DEFAULT_LANGUAGE, isLanguageKey, type LanguageKey } from "@/lib/language";

export type UserPrefs = {
  theme: ThemeKey;
  font: FontKey;
  density: DensityKey;
  language: LanguageKey;
  ui: "system" | "classic" | "cyber" | "dynamic";
  customCursor: boolean;
  cursorStyle: CursorStyleKey;
  musicEnabled: boolean;
  musicTrackId: string | null;
  musicVolume: number;
};

const DEFAULT_PREFS: UserPrefs = {
  theme: DEFAULT_THEME,
  font: DEFAULT_FONT,
  density: DEFAULT_DENSITY,
  language: DEFAULT_LANGUAGE,
  ui: "system",
  customCursor: false,
  cursorStyle: DEFAULT_CURSOR_STYLE,
  musicEnabled: false,
  musicTrackId: null,
  musicVolume: 0.4
};

function readPrefs(siteDefaults?: Partial<UserPrefs>): UserPrefs {
  if (typeof window === "undefined") {
    return { ...DEFAULT_PREFS, ...(siteDefaults || {}) };
  }
  const fallback = { ...DEFAULT_PREFS, ...(siteDefaults || {}) };
  try {
    const theme = localStorage.getItem(PREF_KEYS.theme);
    const font = localStorage.getItem(PREF_KEYS.font);
    const density = localStorage.getItem(PREF_KEYS.density);
    const language = localStorage.getItem(PREF_KEYS.language);
    const ui = localStorage.getItem(PREF_KEYS.ui);
    const customCursor = localStorage.getItem(PREF_KEYS.customCursor);
    const cursorStyle = localStorage.getItem(PREF_KEYS.cursorStyle);
    const musicEnabled = localStorage.getItem(PREF_KEYS.musicEnabled);
    const musicTrackId = localStorage.getItem(PREF_KEYS.musicTrackId);
    const musicVolume = localStorage.getItem(PREF_KEYS.musicVolume);
    return {
      theme: isThemeKey(theme) ? theme : fallback.theme,
      font: isFontKey(font) ? font : fallback.font,
      density: isDensityKey(density) ? density : fallback.density,
      language: isLanguageKey(language) ? language : fallback.language,
      ui: (ui === "classic" || ui === "cyber" || ui === "dynamic") ? ui : fallback.ui,
      customCursor: customCursor === null ? fallback.customCursor : customCursor === "true",
      cursorStyle: isCursorStyleKey(cursorStyle) ? cursorStyle : fallback.cursorStyle,
      musicEnabled: musicEnabled === null ? fallback.musicEnabled : musicEnabled === "true",
      musicTrackId: musicTrackId || fallback.musicTrackId,
      musicVolume: musicVolume ? clampVolume(parseFloat(musicVolume)) : fallback.musicVolume
    };
  } catch {
    return fallback;
  }
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(Math.max(value, 0), 1);
}

const PREF_EVENT = "shibei:prefs-change";

export function useUserPrefs(siteDefaults?: Partial<UserPrefs>) {
  const [prefs, setPrefsState] = useState<UserPrefs>(() => ({ ...DEFAULT_PREFS, ...(siteDefaults || {}) }));
  const [hydrated, setHydrated] = useState(false);

  // siteDefaults 是从 server 传下来的对象，引用每次渲染都新；用其 JSON 串当 stable key 来
  // 避免 effect/callback 误重跑。提取到独立变量是为了让 eslint 的 exhaustive-deps 能静态识别。
  const siteDefaultsKey = JSON.stringify(siteDefaults || {});

  useEffect(() => {
    setPrefsState(readPrefs(siteDefaults));
    setHydrated(true);
    const handler = () => setPrefsState(readPrefs(siteDefaults));
    window.addEventListener(PREF_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(PREF_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteDefaultsKey]);

  const update = useCallback((partial: Partial<UserPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...partial };
      try {
        if (partial.theme !== undefined) localStorage.setItem(PREF_KEYS.theme, next.theme);
        if (partial.font !== undefined) localStorage.setItem(PREF_KEYS.font, next.font);
        if (partial.density !== undefined) localStorage.setItem(PREF_KEYS.density, next.density);
        if (partial.language !== undefined) localStorage.setItem(PREF_KEYS.language, next.language);
        if (partial.ui !== undefined) localStorage.setItem(PREF_KEYS.ui, next.ui);
        if (partial.customCursor !== undefined)
          localStorage.setItem(PREF_KEYS.customCursor, String(next.customCursor));
        if (partial.cursorStyle !== undefined)
          localStorage.setItem(PREF_KEYS.cursorStyle, next.cursorStyle);
        if (partial.musicEnabled !== undefined)
          localStorage.setItem(PREF_KEYS.musicEnabled, String(next.musicEnabled));
        if (partial.musicTrackId !== undefined)
          localStorage.setItem(PREF_KEYS.musicTrackId, next.musicTrackId || "");
        if (partial.musicVolume !== undefined)
          localStorage.setItem(PREF_KEYS.musicVolume, String(next.musicVolume));
        document.documentElement.setAttribute("data-theme", next.theme);
        document.documentElement.setAttribute("data-font", next.font);
        document.documentElement.setAttribute("data-density", next.density);
        document.documentElement.setAttribute("data-language", next.language);
        if (next.customCursor) {
          document.documentElement.setAttribute("data-cursor", "custom");
          document.documentElement.setAttribute("data-cursor-style", next.cursorStyle);
        } else {
          document.documentElement.removeAttribute("data-cursor");
          document.documentElement.removeAttribute("data-cursor-style");
        }
        document.documentElement.lang = next.language === "en" ? "en" : "zh-CN";
        window.dispatchEvent(new CustomEvent(PREF_EVENT));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      Object.values(PREF_KEYS).forEach((k) => localStorage.removeItem(k));
      window.dispatchEvent(new CustomEvent(PREF_EVENT));
    } catch {
      /* ignore */
    }
    setPrefsState({ ...DEFAULT_PREFS, ...(siteDefaults || {}) });
    document.documentElement.removeAttribute("data-cursor");
    document.documentElement.removeAttribute("data-cursor-style");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteDefaultsKey]);

  return { prefs, update, reset, hydrated };
}
