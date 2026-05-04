"use client";

import Link from "next/link";
import { Fragment, useState, useEffect } from "react";
import { useUserPrefs } from "./useUserPrefs";
import { LANGUAGE_OPTIONS, languageLabel } from "@/lib/language";
import { FONTS, THEMES, DENSITIES, DEFAULT_THEME, DEFAULT_FONT, DEFAULT_DENSITY } from "@/lib/themes";

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

  useEffect(() => {
    fetch("/api/public/music")
      .then((res) => res.json())
      .then((data: { tracks?: Array<Record<string, string>> }) => {
        setTracks(Array.isArray(data?.tracks) ? data.tracks : []);
      })
      .catch(() => {});
  }, []);

  if (!hydrated) {
    return <p className="muted">读取偏好…</p>;
  }

  const defaultTheme = siteDefaults.theme || DEFAULT_THEME;
  const defaultFont = siteDefaults.font || DEFAULT_FONT;
  const defaultDensity = siteDefaults.density || DEFAULT_DENSITY;
  const defaultLanguage = siteDefaults.language || "zh";

  return (
    <div className="settings-shell">
      <section>
        <p className="eyebrow">Interface</p>
        <h2>界面风格 (UI Style)</h2>
        <p className="muted-block">
          管理员默认：<strong>{siteDefaults.ui === 'cyber' ? '科技纪元' : '经典风格'}</strong>
        </p>
        <div className="option-grid" role="radiogroup" aria-label="界面风格">
          <button
            type="button"
            role="radio"
            aria-checked={(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "classic"}
            className={`option-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "classic" ? " active" : ""}`}
            onClick={() => update({ ui: "classic" })}
          >
            <span className="option-label">经典风格 (Classic)</span>
            <span className="option-meta">温和、沉静的默认体验</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "cyber"}
            className={`option-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "cyber" ? " active" : ""}`}
            onClick={() => update({ ui: "cyber" })}
          >
            <span className="option-label">科技纪元 (Cyberpunk)</span>
            <span className="option-meta">暗网格、高光边缘与动态反馈</span>
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow">Language</p>
        <h2>语言模式</h2>
        <p className="muted-block">
          管理员当前默认语种为 <strong>{languageLabel(defaultLanguage)}</strong>。 切换为 English 后，打开新闻正文时会按需生成英文版本。
        </p>
        <div className="option-grid" role="radiogroup" aria-label="语言模式">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={prefs.language === opt.value}
              className={`option-card${prefs.language === opt.value ? " active" : ""}`}
              onClick={() => update({ language: opt.value })}
            >
              <span className="option-label">
                {opt.label}
                {opt.value === defaultLanguage ? "（管理员默认）" : ""}
              </span>
              <span className="option-meta">{opt.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">外观</p>
        <h2>主题</h2>
        <p className="muted-block">
          管理员当前的默认主题为 <strong>{THEMES.find((t) => t.key === defaultTheme)?.label || defaultTheme}</strong>。 你的选择会保存在浏览器，下次访问自动生效。
        </p>
        <div className="option-grid" role="radiogroup" aria-label="主题">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              role="radio"
              aria-checked={prefs.theme === theme.key}
              className={`option-card${prefs.theme === theme.key ? " active" : ""}`}
              onClick={() => update({ theme: theme.key })}
            >
              <div className="theme-swatch" aria-hidden>
                {theme.swatch.map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </div>
              <span className="option-label">
                {theme.label}
                {theme.key === defaultTheme ? "（管理员默认）" : ""}
              </span>
              <span className="option-meta">{theme.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>字体</h2>
        <p className="muted-block">
          全部为免费字体（系统内置或开源）。当前管理员默认：
          <strong>{FONTS.find((f) => f.key === defaultFont)?.label || defaultFont}</strong>。
        </p>
        <div className="option-grid" role="radiogroup" aria-label="字体">
          {FONTS.map((font) => (
            <button
              key={font.key}
              type="button"
              role="radio"
              aria-checked={prefs.font === font.key}
              className={`option-card${prefs.font === font.key ? " active" : ""}`}
              onClick={() => update({ font: font.key })}
            >
              <span className="font-preview" style={{ fontFamily: font.family }}>
                {font.preview}
                <small>ShiBei Blog</small>
              </span>
              <span className="option-label">
                {font.label}
                {font.key === defaultFont ? "（管理员默认）" : ""}
              </span>
              <span className="option-meta">{font.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>密度</h2>
        <p className="muted-block">
          调整全站间距。当前管理员默认：
          <strong>{DENSITIES.find((d) => d.key === defaultDensity)?.label || defaultDensity}</strong>。
        </p>
        <div className="option-grid" role="radiogroup" aria-label="密度">
          {DENSITIES.map((density) => (
            <button
              key={density.key}
              type="button"
              role="radio"
              aria-checked={prefs.density === density.key}
              className={`option-card${prefs.density === density.key ? " active" : ""}`}
              onClick={() => update({ density: density.key })}
            >
              <span className="option-label">{density.label}</span>
              <span className="option-meta">{density.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">背景音乐</p>
        <h2>背景音乐</h2>
        {tracks.length === 0 ? (
          <p className="muted-block">管理员尚未上传任何音乐。</p>
        ) : (
          <Fragment>
            <label className="row" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={prefs.musicEnabled}
                onChange={(e) => update({ musicEnabled: e.target.checked })}
              />
              <span>启用浏览时的背景音乐</span>
            </label>
            <p className="muted-block">
              共 {tracks.length} 首可选。浏览器策略要求播放需要至少一次用户交互（点击 / 滚动）。
            </p>
            <div className="option-grid">
              {tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className={`option-card${prefs.musicTrackId === track.id ? " active" : ""}`}
                  onClick={() => update({ musicTrackId: track.id, musicEnabled: true })}
                >
                  <span className="option-label">{track.title}</span>
                  <span className="option-meta">{track.artist || "未知"}</span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 14, alignItems: "center" }}>
              <span className="muted">音量</span>
              <input
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
          回到首页
        </Link>
        <button type="button" className="button ghost" onClick={reset}>
          恢复默认
        </button>
      </div>
    </div>
  );
}