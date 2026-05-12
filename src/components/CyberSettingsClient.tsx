"use client";

import Link from "next/link";
import { Fragment, useState, useEffect } from "react";
import { motion, Variants } from "framer-motion";
import { useUserPrefs } from "./useUserPrefs";
import { LANGUAGE_OPTIONS, languageLabel } from "@/lib/language";
import { useTranslation } from "@/lib/i18n";
import { CURSOR_STYLES, FONTS, THEMES, DENSITIES } from "@/lib/themes";

const containerVars: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVars: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
};

export function CyberSettingsClient({
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
    fetch("/api/public/music")
      .then((res) => res.json())
      .then((data: { tracks?: Array<Record<string, string>> }) => {
        setTracks(Array.isArray(data?.tracks) ? data.tracks : []);
      })
      .catch(() => {});
  }, []);

  // Force global body bg override for cyber UI demonstration if needed, 
  // though we will use the cyber-theme data attribute via CSS.
  useEffect(() => {
    document.documentElement.setAttribute("data-ui", "cyber");
    return () => {
      const currentUi = prefs.ui === "system" ? siteDefaults.ui : prefs.ui;
      document.documentElement.setAttribute("data-ui", currentUi);
    };
  }, [prefs.ui, siteDefaults.ui]);

  if (!hydrated) {
    return <p className="cyber-muted">{t("loading")}</p>;
  }

  const defaultLanguage = siteDefaults.language || "zh";

  return (
    <motion.div 
      className="cyber-settings-shell"
      variants={containerVars}
      initial="hidden"
      animate="visible"
    >
      <motion.section variants={itemVars} className="cyber-panel">
        <p className="cyber-eyebrow">SYS.{t("interface").toUpperCase()}</p>
        <h2 className="cyber-title">{t("uiStyle")}</h2>
        <p className="cyber-desc">
          {t("sysDefault")}: <span className="cyber-highlight">{siteDefaults.ui === 'cyber' ? t("cyber") : siteDefaults.ui === 'dynamic' ? t("dynamic") : t("classic")}</span>
        </p>
        <div className="cyber-grid" role="radiogroup">
          <button
            type="button"
            className={`cyber-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "classic" ? " active" : ""}`}
            onClick={() => update({ ui: "classic" })}
          >
            <div className="cyber-glow"></div>
            <span className="cyber-card-label">{t("classic")}</span>
            <span className="cyber-card-meta">{t("classicDesc")}</span>
          </button>
          <button
            type="button"
            className={`cyber-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "cyber" ? " active" : ""}`}
            onClick={() => update({ ui: "cyber" })}
          >
            <div className="cyber-glow"></div>
            <span className="cyber-card-label">{t("cyber")}</span>
            <span className="cyber-card-meta">{t("cyberDesc")}</span>
          </button>
          <button
            type="button"
            className={`cyber-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "dynamic" ? " active" : ""}`}
            onClick={() => update({ ui: "dynamic" })}
          >
            <div className="cyber-glow"></div>
            <span className="cyber-card-label">{t("dynamic")}</span>
            <span className="cyber-card-meta">{t("dynamicDesc")}</span>
          </button>
        </div>
        <div style={{ marginTop: 24 }}>
          <label className="cyber-checkbox-row">
            <input
              type="checkbox"
              checked={prefs.customCursor}
              onChange={(e) => update({ customCursor: e.target.checked })}
            />
            <span className="cyber-check-label">{t("customCursor")}</span>
          </label>
          <p className="cyber-desc" style={{ marginTop: 6, marginLeft: 28 }}>
            {t("customCursorDesc")}
          </p>
          {prefs.customCursor ? (
            <div className="cyber-grid cursor-style-grid" role="radiogroup" style={{ marginTop: 14 }}>
              {CURSOR_STYLES.map((style) => (
                <button
                  key={style.key}
                  type="button"
                  className={`cyber-card cursor-style-card${prefs.cursorStyle === style.key ? " active" : ""}`}
                  onClick={() => update({ cursorStyle: style.key, customCursor: true })}
                >
                  <div className="cyber-glow"></div>
                  <span className={`cursor-style-preview cursor-${style.key}`} aria-hidden />
                  <span className="cyber-card-label">{t(`cursor.${style.key}.label`) || style.label}</span>
                  <span className="cyber-card-meta">{t(`cursor.${style.key}.desc`) || style.desc}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="cyber-panel">
        <p className="cyber-eyebrow">SYS.{t("language").toUpperCase()}</p>
        <h2 className="cyber-title">{t("localeMode")}</h2>
        <p className="cyber-desc">
          {t("sysDefault")}: <span className="cyber-highlight">{languageLabel(defaultLanguage)}</span>
        </p>
        <div className="cyber-grid" role="radiogroup">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`cyber-card${prefs.language === opt.value ? " active" : ""}`}
              onClick={() => update({ language: opt.value })}
            >
              <div className="cyber-glow"></div>
              <span className="cyber-card-label">{t(`lang.${opt.value}.label`) || opt.label}</span>
              <span className="cyber-card-meta">{t(`lang.${opt.value}.desc`) || opt.description}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="cyber-panel">
        <p className="cyber-eyebrow">SYS.{t("appearance").toUpperCase()}</p>
        <h2 className="cyber-title">{t("colorPalette")}</h2>
        <div className="cyber-grid" role="radiogroup">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              className={`cyber-card${prefs.theme === theme.key ? " active" : ""}`}
              onClick={() => update({ theme: theme.key })}
            >
              <div className="cyber-glow"></div>
              <div className="cyber-theme-swatch">
                {theme.swatch.map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </div>
              <span className="cyber-card-label">{t(`theme.${theme.key}.label`) || theme.label}</span>
              <span className="cyber-card-meta">{t(`theme.${theme.key}.desc`) || theme.desc}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="cyber-panel">
        <h2 className="cyber-title">{t("fontMatrix")}</h2>
        <div className="cyber-grid" role="radiogroup">
          {FONTS.map((font) => (
            <button
              key={font.key}
              type="button"
              className={`cyber-card${prefs.font === font.key ? " active" : ""}`}
              onClick={() => update({ font: font.key })}
            >
              <div className="cyber-glow"></div>
              <span className="cyber-font-preview" style={{ fontFamily: font.family }}>
                {font.preview}
              </span>
              <span className="cyber-card-label">{t(`font.${font.key}.label`) || font.label}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="cyber-panel">
        <h2 className="cyber-title">{t("densityConfig")}</h2>
        <div className="cyber-grid" role="radiogroup">
          {DENSITIES.map((density) => (
            <button
              key={density.key}
              type="button"
              className={`cyber-card${prefs.density === density.key ? " active" : ""}`}
              onClick={() => update({ density: density.key })}
            >
              <div className="cyber-glow"></div>
              <span className="cyber-card-label">{t(`density.${density.key}.label`) || density.label}</span>
              <span className="cyber-card-meta">{t(`density.${density.key}.desc`) || density.desc}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="cyber-panel">
        <p className="cyber-eyebrow">SYS.{t("audio").toUpperCase()}</p>
        <h2 className="cyber-title">{t("bgm")}</h2>
        {tracks.length === 0 ? (
          <p className="cyber-desc">{t("noTracks")}</p>
        ) : (
          <Fragment>
            <label className="cyber-checkbox-row">
              <input
                type="checkbox"
                checked={prefs.musicEnabled}
                onChange={(e) => update({ musicEnabled: e.target.checked })}
              />
              <span className="cyber-check-label">{t("enableAudio")}</span>
            </label>
            <div className="cyber-grid">
              {tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className={`cyber-card${prefs.musicTrackId === track.id ? " active" : ""}`}
                  onClick={() => update({ musicTrackId: track.id, musicEnabled: true })}
                >
                  <div className="cyber-glow"></div>
                  <span className="cyber-card-label">{track.title}</span>
                  <span className="cyber-card-meta">{track.artist || t("unknownArtist")}</span>
                </button>
              ))}
            </div>
            <div className="cyber-range-row">
              <span className="cyber-muted">{t("vol")}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.musicVolume}
                onChange={(e) => update({ musicVolume: parseFloat(e.target.value) })}
                className="cyber-range"
              />
              <span className="cyber-highlight">{Math.round(100 * prefs.musicVolume)}%</span>
            </div>
          </Fragment>
        )}
      </motion.section>

      <motion.div variants={itemVars} className="cyber-footer">
        <Link className="cyber-link" href="/">
          {t("returnHome")}
        </Link>
        <button type="button" className="cyber-btn-ghost" onClick={reset}>
          {t("restoreDefault")}
        </button>
      </motion.div>
    </motion.div>
  );
}
