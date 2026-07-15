"use client";

import { useEffect, useRef, useState } from "react";
import { I18nText } from "@/components/I18nText";
import { isUiStyleKey } from "@/lib/themes";
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

/**
 * 快速美化面板：主题色相 / 壁纸模式 / 文章布局 / Firefly 横幅，
 * 全部即点即变（CSS 变量 + data-* 属性），不用进设置页。
 * 大型调整（主题/字体/风格/语言）仍在 /settings。
 */
export function QuickStylePanel({ defaultUi = "classic" }: { defaultUi?: string }) {
  const [open, setOpen] = useState(false);
  const [qs, setQs] = useState<QuickStyle>(DEFAULT_QUICK_STYLE);
  const [hydrated, setHydrated] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { prefs, hydrated: prefsHydrated } = useUserPrefs();
  const isEnglish = prefsHydrated && prefs.language === "en";

  // 当前生效的界面风格：决定是否显示「横幅设置」（仅 Firefly 有横幅）。
  const effectiveUi = prefs.ui === "system"
    ? (isUiStyleKey(defaultUi) ? defaultUi : "classic")
    : prefs.ui;

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
  }

  const isDefault =
    qs.hue === null && qs.wallpaper === "default" && qs.postsLayout === "default" && qs.ffBanner;

  return (
    <div className="theme-switcher quick-style" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-switcher-trigger"
        aria-expanded={open}
        aria-controls="quick-style-menu"
        aria-label={isEnglish ? "Quick style" : "快速美化"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="quick-style-trigger-dot" aria-hidden />
        <span className="theme-switcher-label">
          <I18nText zh="美化" en="Style" />
        </span>
      </button>

      <div id="quick-style-menu" className="quick-style-menu" hidden={!open}>
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
