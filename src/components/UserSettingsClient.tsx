"use client";

import Link from "next/link";
import { Fragment, useState, useEffect } from "react";
import { useUserPrefs } from "./useUserPrefs";
import { LANGUAGE_OPTIONS, languageLabel } from "@/lib/language";
import { useTranslation } from "@/lib/i18n";
import { CURSOR_STYLES, FONTS, THEMES, DENSITIES, UI_STYLES, DEFAULT_THEME, DEFAULT_FONT, DEFAULT_DENSITY } from "@/lib/themes";

export function UserSettingsClient({
  siteDefaults,
}: {
  siteDefaults: {
    theme: string;
    font: string;
    density: string;
    language: string;
    ui: string;
    musicEnabled: boolean;
  };
}) {
  const { prefs, update, reset, hydrated } = useUserPrefs();
  const [tracks, setTracks] = useState<Array<Record<string, string>>>([]);
  const t = useTranslation(prefs.language || "zh");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch("/api/public/music", { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { tracks?: Array<Record<string, string>> }) => {
        setTracks(Array.isArray(data?.tracks) ? data.tracks : []);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  if (!hydrated) {
    // hydration 前渲染占位骨架，避免整页只有一行文字导致的布局跳动。
    return (
      <div className="settings-shell" aria-busy="true">
        <p className="muted" role="status">{t("loading")}</p>
        <div className="option-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="option-card" style={{ minHeight: 96, opacity: 0.4, pointerEvents: "none" }} />
          ))}
        </div>
      </div>
    );
  }

  const defaultTheme = siteDefaults.theme || DEFAULT_THEME;
  const defaultFont = siteDefaults.font || DEFAULT_FONT;
  const defaultDensity = siteDefaults.density || DEFAULT_DENSITY;
  const defaultLanguage = siteDefaults.language || "zh";

  return (
    <div className="settings-shell">
      <section>
        <p className="eyebrow">{t("interface")}</p>
        <h2>{t("uiStyle")}</h2>
        <p className="muted-block">
          {t("sysDefault")}：<strong>{uiStyleLabel(siteDefaults.ui, prefs.language)}</strong>
        </p>
        <div className="option-grid" role="group" aria-label={t("uiStyle")}>
          {UI_STYLES.map((style) => {
            const currentUI = prefs.ui === "system" ? siteDefaults.ui : prefs.ui;
            const isActive = currentUI === style.key;
            const isEn = prefs.language === "en";
            return (
              <button
                key={style.key}
                type="button"
                aria-pressed={isActive}
                className={`option-card ui-style-card${isActive ? " active" : ""}`}
                onClick={() => update({ ui: style.key })}
              >
                <span className={`ui-style-preview ui-preview-${style.key}`} aria-hidden>
                  <span className="ui-preview-bar" />
                  <span className="ui-preview-block" />
                </span>
                <span className="option-label">
                  {isEn ? style.en : style.zh}
                  {style.key === siteDefaults.ui ? `（${t("sysDefault")}）` : ""}
                </span>
                <span className="option-meta">{isEn ? style.enDesc : style.zhDesc}</span>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 24 }}>
          <label className="row">
            <input
              type="checkbox"
              checked={prefs.customCursor}
              onChange={(e) => update({ customCursor: e.target.checked })}
            />
            <span>{t("customCursor")}</span>
          </label>
          <p className="muted-block" style={{ marginTop: 6, marginLeft: 28 }}>
            {t("customCursorDesc")}
          </p>
          {prefs.customCursor ? (
            <div className="option-grid cursor-style-grid" role="group" aria-label={t("cursorStyle")} style={{ marginTop: 14 }}>
              {CURSOR_STYLES.map((style) => (
                <button
                  key={style.key}
                  type="button"
                  aria-pressed={prefs.cursorStyle === style.key}
                  className={`option-card cursor-style-card${prefs.cursorStyle === style.key ? " active" : ""}`}
                  onClick={() => update({ cursorStyle: style.key, customCursor: true })}
                >
                  <span className={`cursor-style-preview cursor-${style.key}`} aria-hidden />
                  <span className="option-label">{t(`cursor.${style.key}.label`) || style.label}</span>
                  <span className="option-meta">{t(`cursor.${style.key}.desc`) || style.desc}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("language")}</p>
        <h2>{t("localeMode")}</h2>
        <p className="muted-block">
          {t("sysDefault")}：<strong>{languageLabel(defaultLanguage)}</strong>
        </p>
        <div className="option-grid" role="group" aria-label={t("localeMode")}>
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={prefs.language === opt.value}
              className={`option-card${prefs.language === opt.value ? " active" : ""}`}
              onClick={() => update({ language: opt.value })}
            >
              <span className="option-label">
                {t(`lang.${opt.value}.label`) || opt.label}
                {opt.value === defaultLanguage ? `（${t("sysDefault")}）` : ""}
              </span>
              <span className="option-meta">{t(`lang.${opt.value}.desc`) || opt.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("appearance")}</p>
        <h2>{t("colorPalette")}</h2>
        <p className="muted-block">
          {t("sysDefault")}：<strong>{THEMES.find((thm) => thm.key === defaultTheme)?.label || defaultTheme}</strong>。
        </p>
        <div className="option-grid" role="group" aria-label={t("colorPalette")}>
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              aria-pressed={prefs.theme === theme.key}
              className={`option-card${prefs.theme === theme.key ? " active" : ""}`}
              onClick={() => update({ theme: theme.key })}
            >
              <div className="theme-swatch" aria-hidden>
                {theme.swatch.map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </div>
              <span className="option-label">
                {t(`theme.${theme.key}.label`) || theme.label}
                {theme.key === defaultTheme ? `（${t("sysDefault")}）` : ""}
              </span>
              <span className="option-meta">{t(`theme.${theme.key}.desc`) || theme.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>{t("typography")}</h2>
        <p className="muted-block">
          {t("sysDefault")}：<strong>{FONTS.find((f) => f.key === defaultFont)?.label || defaultFont}</strong>。
        </p>
        <div className="option-grid" role="group" aria-label={t("typography")}>
          {FONTS.map((font) => (
            <button
              key={font.key}
              type="button"
              aria-pressed={prefs.font === font.key}
              className={`option-card${prefs.font === font.key ? " active" : ""}`}
              onClick={() => update({ font: font.key })}
            >
              <span className="font-preview" style={{ fontFamily: font.family }}>
                {font.preview}
                <small>ShiBei Blog</small>
              </span>
              <span className="option-label">
                {t(`font.${font.key}.label`) || font.label}
                {font.key === defaultFont ? `（${t("sysDefault")}）` : ""}
              </span>
              <span className="option-meta">{t(`font.${font.key}.desc`) || font.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("layout")}</p>
        <h2>{t("densityConfig")}</h2>
        <p className="muted-block">
          {t("sysDefault")}：<strong>{DENSITIES.find((d) => d.key === defaultDensity)?.label || defaultDensity}</strong>。
        </p>
        <div className="option-grid" role="group" aria-label={t("densityConfig")}>
          {DENSITIES.map((density) => (
            <button
              key={density.key}
              type="button"
              aria-pressed={prefs.density === density.key}
              className={`option-card${prefs.density === density.key ? " active" : ""}`}
              onClick={() => update({ density: density.key })}
            >
              <span className="option-label">{t(`density.${density.key}.label`) || density.label}</span>
              <span className="option-meta">{t(`density.${density.key}.desc`) || density.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("audio")}</p>
        <h2>{t("bgm")}</h2>
        {tracks.length === 0 ? (
          <p className="muted-block">{t("noTracks")}</p>
        ) : (
          <Fragment>
            <label className="row" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={prefs.musicEnabled}
                onChange={(e) => update({ musicEnabled: e.target.checked })}
              />
              <span>{t("enableAudio")}</span>
            </label>
            <p className="muted-block">
              {prefs.language === "en"
                ? `${tracks.length} track(s) available. Browsers require at least one user interaction (click / scroll) before audio can play.`
                : `共 ${tracks.length} 首可选。浏览器策略要求播放需要至少一次用户交互（点击 / 滚动）。`}
            </p>
            <div className="option-grid" role="group" aria-label={t("bgm")}>
              {tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  aria-pressed={prefs.musicTrackId === track.id}
                  className={`option-card${prefs.musicTrackId === track.id ? " active" : ""}`}
                  onClick={() => update({ musicTrackId: track.id, musicEnabled: true })}
                >
                  <span className="option-label">{track.title}</span>
                  <span className="option-meta">{track.artist || t("unknownArtist")}</span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 14, alignItems: "center" }}>
              <label className="muted" htmlFor="music-volume">{t("vol")}</label>
              <input
                id="music-volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.musicVolume}
                onChange={(e) => update({ musicVolume: parseFloat(e.target.value) })}
                style={{ flex: 1, maxWidth: 280 }}
              />
              <span className="muted">{Math.round(100 * prefs.musicVolume)}%</span>
            </div>
          </Fragment>
        )}
      </section>

      <hr className="divider" />
      <div className="row between">
        <Link className="text-link" href="/">
          {t("returnHome")}
        </Link>
        <button
          type="button"
          className="button ghost"
          onClick={() => {
            const message =
              prefs.language === "en"
                ? "Restore all preferences (theme, font, language, music, etc.) to defaults?"
                : "确定把主题、字体、语言、音乐等全部偏好恢复为默认值吗？";
            if (window.confirm(message)) reset();
          }}
        >
          {t("restoreDefault")}
        </button>
      </div>
    </div>
  );
}

function uiStyleLabel(key: string, language: string) {
  const style = UI_STYLES.find((item) => item.key === key);
  if (!style) return key;
  return language === "en" ? style.en : style.zh;
}
