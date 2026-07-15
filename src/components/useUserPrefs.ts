"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_DENSITY,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FONT,
  DEFAULT_TOC_ACCENT,
  DEFAULT_THEME,
  CursorStyleKey,
  DensityKey,
  FontKey,
  PREF_KEYS,
  ThemeKey,
  UiStyleKey,
  isCursorStyleKey,
  isDensityKey,
  isFontKey,
  isThemeKey,
  isUiStyleKey
} from "@/lib/themes";
import { DEFAULT_LANGUAGE, isLanguageKey, type LanguageKey } from "@/lib/language";

export type UserPrefs = {
  theme: ThemeKey;
  font: FontKey;
  density: DensityKey;
  language: LanguageKey;
  ui: "system" | UiStyleKey;
  customCursor: boolean;
  cursorStyle: CursorStyleKey;
  tocAccent: string;
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
  tocAccent: DEFAULT_TOC_ACCENT,
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
    const tocAccent = localStorage.getItem(PREF_KEYS.tocAccent);
    const musicEnabled = localStorage.getItem(PREF_KEYS.musicEnabled);
    const musicTrackId = localStorage.getItem(PREF_KEYS.musicTrackId);
    const musicVolume = localStorage.getItem(PREF_KEYS.musicVolume);
    return {
      theme: isThemeKey(theme) ? theme : systemAwareThemeFallback(fallback.theme),
      font: isFontKey(font) ? font : fallback.font,
      density: isDensityKey(density) ? density : fallback.density,
      language: isLanguageKey(language) ? language : fallback.language,
      ui: isUiStyleKey(ui) ? ui : fallback.ui,
      customCursor: customCursor === null ? fallback.customCursor : customCursor === "true",
      cursorStyle: isCursorStyleKey(cursorStyle) ? cursorStyle : fallback.cursorStyle,
      tocAccent: isHexColor(tocAccent) ? tocAccent : fallback.tocAccent,
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

function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/** 未保存主题偏好时与 UserPreferencesScript 一致：亮色默认 + 系统深色 → dark */
function systemAwareThemeFallback(theme: ThemeKey): ThemeKey {
  if (theme === "dark" || theme === "midnight") return theme;
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    /* ignore */
  }
  return theme;
}

const PREF_EVENT = "shibei:prefs-change";

export function useUserPrefs(siteDefaults?: Partial<UserPrefs>) {
  const [prefs, setPrefsState] = useState<UserPrefs>(() => ({ ...DEFAULT_PREFS, ...(siteDefaults || {}) }));
  const [hydrated, setHydrated] = useState(false);

  // siteDefaults 是从 server 传下来的对象，引用每次渲染都新；用其 JSON 串当 stable key 来
  // 避免 effect/callback 误重跑。提取到独立变量是为了让 eslint 的 exhaustive-deps 能静态识别。
  const siteDefaultsKey = JSON.stringify(siteDefaults || {});

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      setPrefsState(readPrefs(siteDefaults));
      setHydrated(true);
    }, 0);
    const handler = () => setPrefsState(readPrefs(siteDefaults));
    window.addEventListener(PREF_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.clearTimeout(hydrateTimer);
      window.removeEventListener(PREF_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteDefaultsKey]);

  const update = useCallback((partial: Partial<UserPrefs>) => {
    const defaults = { ...DEFAULT_PREFS, ...(siteDefaults || {}) };
    setPrefsState((prev) => {
      const next = { ...prev, ...partial };
      // React may invoke a state updater while rendering. Persisting and
      // synchronously dispatching here made sibling preference consumers call
      // setState during that render. Defer all external effects to a microtask.
      window.queueMicrotask(() => persistAndApplyPrefs(partial, next, defaults));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- siteDefaults 以 JSON key 稳定化
  }, [siteDefaultsKey]);

  const reset = useCallback(() => {
    try {
      Object.values(PREF_KEYS).forEach((k) => localStorage.removeItem(k));
      window.dispatchEvent(new CustomEvent(PREF_EVENT));
    } catch {
      /* ignore */
    }
    const defaults = { ...DEFAULT_PREFS, ...(siteDefaults || {}) };
    setPrefsState(defaults);
    document.documentElement.removeAttribute("data-cursor");
    document.documentElement.removeAttribute("data-cursor-style");
    const defaultUi = defaults.ui === "system" ? "classic" : defaults.ui;
    document.documentElement.setAttribute("data-ui", defaultUi);
    document.documentElement.setAttribute("data-theme", defaults.theme);
    document.documentElement.setAttribute("data-font", defaults.font);
    document.documentElement.setAttribute("data-density", defaults.density);
    document.documentElement.setAttribute("data-language", defaults.language);
    document.documentElement.style.removeProperty("--toc-accent");
    document.documentElement.lang = defaults.language === "en" ? "en" : "zh-CN";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteDefaultsKey]);

  return { prefs, update, reset, hydrated };
}

function persistAndApplyPrefs(partial: Partial<UserPrefs>, next: UserPrefs, defaults: UserPrefs) {
  try {
    if (partial.theme !== undefined) localStorage.setItem(PREF_KEYS.theme, next.theme);
    if (partial.font !== undefined) localStorage.setItem(PREF_KEYS.font, next.font);
    if (partial.density !== undefined) localStorage.setItem(PREF_KEYS.density, next.density);
    if (partial.language !== undefined) localStorage.setItem(PREF_KEYS.language, next.language);
    if (partial.ui !== undefined) localStorage.setItem(PREF_KEYS.ui, next.ui);
    if (partial.customCursor !== undefined) localStorage.setItem(PREF_KEYS.customCursor, String(next.customCursor));
    if (partial.cursorStyle !== undefined) localStorage.setItem(PREF_KEYS.cursorStyle, next.cursorStyle);
    if (partial.tocAccent !== undefined && isHexColor(next.tocAccent)) localStorage.setItem(PREF_KEYS.tocAccent, next.tocAccent);
    if (partial.musicEnabled !== undefined) localStorage.setItem(PREF_KEYS.musicEnabled, String(next.musicEnabled));
    if (partial.musicTrackId !== undefined) localStorage.setItem(PREF_KEYS.musicTrackId, next.musicTrackId || "");
    if (partial.musicVolume !== undefined) localStorage.setItem(PREF_KEYS.musicVolume, String(next.musicVolume));
    document.documentElement.setAttribute("data-theme", next.theme);
    document.documentElement.setAttribute("data-font", next.font);
    document.documentElement.setAttribute("data-density", next.density);
    document.documentElement.setAttribute("data-language", next.language);
    document.documentElement.style.setProperty("--toc-accent", next.tocAccent);
    const effectiveUi = next.ui === "system" ? (defaults.ui === "system" ? "classic" : defaults.ui) : next.ui;
    document.documentElement.setAttribute("data-ui", effectiveUi);
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
}
