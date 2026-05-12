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
    transition: { staggerChildren: 0.12 }
  }
};

const itemVars: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 120, damping: 15 } }
};

export function DynamicSettingsClient({
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

  useEffect(() => {
    document.documentElement.setAttribute("data-ui", "dynamic");
    return () => {
      const currentUi = prefs.ui === "system" ? siteDefaults.ui : prefs.ui;
      document.documentElement.setAttribute("data-ui", currentUi);
    };
  }, [prefs.ui, siteDefaults.ui]);

  if (!hydrated) {
    return <p style={{ color: 'white', opacity: 0.7 }}>{t("loading")}</p>;
  }

  const defaultLanguage = siteDefaults.language || "zh";

  const uiLabel = (ui: string) => {
    if (ui === 'cyber') return t("cyber");
    if (ui === 'dynamic') return t("dynamic");
    return t("classic");
  };

  return (
    <motion.div 
      className="dynamic-settings-shell"
      variants={containerVars}
      initial="hidden"
      animate="visible"
    >
      <motion.section variants={itemVars} className="dynamic-panel">
        <p className="dynamic-eyebrow">{t("interface")}</p>
        <h2 className="dynamic-title">{t("uiStyle")}</h2>
        <p className="dynamic-desc">
          {t("sysDefault")}: <span className="dynamic-highlight">{uiLabel(siteDefaults.ui)}</span>
        </p>
        <div className="dynamic-grid" role="radiogroup">
          <button
            type="button"
            className={`dynamic-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "classic" ? " active" : ""}`}
            onClick={() => update({ ui: "classic" })}
          >
            <span className="dynamic-card-label">{t("classic")}</span>
            <span className="dynamic-card-meta">{t("classicDesc")}</span>
          </button>
          <button
            type="button"
            className={`dynamic-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "cyber" ? " active" : ""}`}
            onClick={() => update({ ui: "cyber" })}
          >
            <span className="dynamic-card-label">{t("cyber")}</span>
            <span className="dynamic-card-meta">{t("cyberDesc")}</span>
          </button>
          <button
            type="button"
            className={`dynamic-card${(prefs.ui === "system" ? siteDefaults.ui : prefs.ui) === "dynamic" ? " active" : ""}`}
            onClick={() => update({ ui: "dynamic" })}
          >
            <span className="dynamic-card-label">{t("dynamic")}</span>
            <span className="dynamic-card-meta">{t("dynamicDesc")}</span>
          </button>
        </div>
        <div style={{ marginTop: 24 }}>
          <label className="dynamic-checkbox-row">
            <input
              type="checkbox"
              checked={prefs.customCursor}
              onChange={(e) => update({ customCursor: e.target.checked })}
            />
            <span className="dynamic-check-label">{t("customCursor")}</span>
          </label>
          <p className="dynamic-desc" style={{ marginTop: 6, marginLeft: 28 }}>
            {t("customCursorDesc")}
          </p>
          {prefs.customCursor ? (
            <div className="dynamic-grid cursor-style-grid" role="radiogroup" style={{ marginTop: 14 }}>
              {CURSOR_STYLES.map((style) => (
                <button
                  key={style.key}
                  type="button"
                  className={`dynamic-card cursor-style-card${prefs.cursorStyle === style.key ? " active" : ""}`}
                  onClick={() => update({ cursorStyle: style.key, customCursor: true })}
                >
                  <span className={`cursor-style-preview cursor-${style.key}`} aria-hidden />
                  <span className="dynamic-card-label">{t(`cursor.${style.key}.label`) || style.label}</span>
                  <span className="dynamic-card-meta">{t(`cursor.${style.key}.desc`) || style.desc}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="dynamic-panel">
        <p className="dynamic-eyebrow">{t("language")}</p>
        <h2 className="dynamic-title">{t("localeMode")}</h2>
        <p className="dynamic-desc">
          {t("sysDefault")}: <span className="dynamic-highlight">{languageLabel(defaultLanguage)}</span>
        </p>
        <div className="dynamic-grid" role="radiogroup">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dynamic-card${prefs.language === opt.value ? " active" : ""}`}
              onClick={() => update({ language: opt.value })}
            >
              <span className="dynamic-card-label">{t(`lang.${opt.value}.label`) || opt.label}</span>
              <span className="dynamic-card-meta">{t(`lang.${opt.value}.desc`) || opt.description}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="dynamic-panel">
        <p className="dynamic-eyebrow">{t("appearance")}</p>
        <h2 className="dynamic-title">{t("colorPalette")}</h2>
        <div className="dynamic-grid" role="radiogroup">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              className={`dynamic-card${prefs.theme === theme.key ? " active" : ""}`}
              onClick={() => update({ theme: theme.key })}
            >
              <div className="dynamic-theme-swatch">
                {theme.swatch.map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </div>
              <span className="dynamic-card-label">{t(`theme.${theme.key}.label`) || theme.label}</span>
              <span className="dynamic-card-meta">{t(`theme.${theme.key}.desc`) || theme.desc}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="dynamic-panel">
        <p className="dynamic-eyebrow">{t("typography")}</p>
        <h2 className="dynamic-title">{t("fontMatrix")}</h2>
        <div className="dynamic-grid" role="radiogroup">
          {FONTS.map((font) => (
            <button
              key={font.key}
              type="button"
              className={`dynamic-card${prefs.font === font.key ? " active" : ""}`}
              onClick={() => update({ font: font.key })}
            >
              <span className="dynamic-font-preview" style={{ fontFamily: font.family }}>
                {font.preview}
              </span>
              <span className="dynamic-card-label">{t(`font.${font.key}.label`) || font.label}</span>
              <span className="dynamic-card-meta">{t(`font.${font.key}.desc`) || font.desc}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="dynamic-panel">
        <p className="dynamic-eyebrow">{t("layout")}</p>
        <h2 className="dynamic-title">{t("densityConfig")}</h2>
        <div className="dynamic-grid" role="radiogroup">
          {DENSITIES.map((density) => (
            <button
              key={density.key}
              type="button"
              className={`dynamic-card${prefs.density === density.key ? " active" : ""}`}
              onClick={() => update({ density: density.key })}
            >
              <span className="dynamic-card-label">{t(`density.${density.key}.label`) || density.label}</span>
              <span className="dynamic-card-meta">{t(`density.${density.key}.desc`) || density.desc}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section variants={itemVars} className="dynamic-panel">
        <p className="dynamic-eyebrow">{t("audio")}</p>
        <h2 className="dynamic-title">{t("bgm")}</h2>
        {tracks.length === 0 ? (
          <p className="dynamic-desc">{t("noTracks")}</p>
        ) : (
          <Fragment>
            <label className="dynamic-checkbox-row">
              <input
                type="checkbox"
                checked={prefs.musicEnabled}
                onChange={(e) => update({ musicEnabled: e.target.checked })}
              />
              <span className="dynamic-check-label">{t("enableAudio")}</span>
            </label>
            <div className="dynamic-grid">
              {tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className={`dynamic-card${prefs.musicTrackId === track.id ? " active" : ""}`}
                  onClick={() => update({ musicTrackId: track.id, musicEnabled: true })}
                >
                  <span className="dynamic-card-label">{track.title}</span>
                  <span className="dynamic-card-meta">{track.artist || t("unknownArtist")}</span>
                </button>
              ))}
            </div>
            <div className="dynamic-range-row">
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{t("vol")}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.musicVolume}
                onChange={(e) => update({ musicVolume: parseFloat(e.target.value) })}
                className="dynamic-range"
              />
              <span className="dynamic-highlight" style={{ fontSize: 14 }}>{Math.round(100 * prefs.musicVolume)}%</span>
            </div>
          </Fragment>
        )}
      </motion.section>

      <motion.div variants={itemVars} className="dynamic-footer">
        <Link className="dynamic-link" href="/">
          {t("returnHome")}
        </Link>
        <button type="button" className="dynamic-btn-ghost" onClick={reset}>
          {t("restoreDefault")}
        </button>
      </motion.div>
    </motion.div>
  );
}
