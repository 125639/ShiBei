"use client";

import { useState, useEffect } from "react";
import type { AdminUser, ContentStyle, ModelConfig, SiteSettings } from "@prisma/client";
import { ConfirmButton } from "@/components/ConfirmButton";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { SubmitButton } from "@/components/SubmitButton";
import { CONTENT_MODE_OPTIONS, contentModeLabel } from "@/lib/content-style";
import { LANGUAGE_OPTIONS, CONTENT_LANGUAGE_MODE_OPTIONS } from "@/lib/language";
import { MODEL_PROVIDER_PRESETS, providerLabel } from "@/lib/model-providers";
import { FONTS, THEMES, UI_STYLES } from "@/lib/themes";

const SETTINGS_TABS = [
  { key: "site", zh: "基础展示", en: "Site" },
  { key: "content", zh: "内容生产", en: "Content" },
  { key: "models", zh: "模型", en: "Models" },
  { key: "prompts", zh: "提示词", en: "Prompts" },
  { key: "media", zh: "媒体视频", en: "Media" },
  { key: "storage", zh: "存储清理", en: "Storage" },
  { key: "external", zh: "外部服务", en: "External" },
  { key: "account", zh: "账号", en: "Account" }
] as const;

// Plain Unicode glyphs (□ ✎ ◆ ❝ ⚙ ...) come from unrelated Unicode blocks and
// render at inconsistent sizes/baselines across fonts — no CSS alignment fixes
// that, since the mismatch is baked into each glyph's own metrics. A small
// shared SVG set with one viewBox/stroke-width guarantees they all line up.
const TAB_ICON_PROPS = {
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

const TAB_ICONS: Record<(typeof SETTINGS_TABS)[number]["key"], React.ReactNode> = {
  site: (
    <svg {...TAB_ICON_PROPS}>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <line x1="2.5" y1="7" x2="15.5" y2="7" />
    </svg>
  ),
  content: (
    <svg {...TAB_ICON_PROPS}>
      <path d="M11.5 3.5l3 3L6 15H3v-3z" />
    </svg>
  ),
  models: (
    <svg {...TAB_ICON_PROPS}>
      <path d="M9 2.5L15.5 9 9 15.5 2.5 9z" />
    </svg>
  ),
  prompts: (
    <svg {...TAB_ICON_PROPS}>
      <rect x="3" y="6" width="4" height="5" rx="1" />
      <rect x="11" y="6" width="4" height="5" rx="1" />
    </svg>
  ),
  media: (
    <svg {...TAB_ICON_PROPS}>
      <path d="M6 4l8 5-8 5V4z" />
    </svg>
  ),
  storage: (
    <svg {...TAB_ICON_PROPS}>
      <circle cx="9" cy="9" r="2.6" />
      <path d="M9 2.8v2M9 12.2v2M2.8 9h2M13.2 9h2M4.5 4.5l1.4 1.4M12.1 12.1l1.4 1.4M4.5 13.5l1.4-1.4M12.1 5.9l1.4-1.4" />
    </svg>
  ),
  external: (
    <svg {...TAB_ICON_PROPS}>
      <path d="M2.5 6.5h11M10.5 3.5l3 3-3 3" />
      <path d="M15.5 11.5h-11M7.5 14.5l-3-3 3-3" />
    </svg>
  ),
  account: (
    <svg {...TAB_ICON_PROPS}>
      <circle cx="9" cy="6.2" r="3" />
      <path d="M3 15c0-3 2.7-5 6-5s6 2 6 5" />
    </svg>
  )
};

type SettingsTab = typeof SETTINGS_TABS[number]["key"];

const SITE_FORM_TABS = new Set<SettingsTab>(["site", "content", "models", "media", "storage", "external"]);

type SettingsSite = Partial<Pick<
  SiteSettings,
  | "name"
  | "description"
  | "ownerName"
  | "defaultTheme"
  | "defaultFont"
  | "defaultLanguage"
  | "defaultSettingsUI"
  | "autoPublish"
  | "contentLanguageMode"
  | "globalPromptPrefix"
  | "contentModelConfigId"
  | "assistantModelConfigId"
  | "writingModelConfigId"
  | "translationModelConfigId"
  | "autoImageSearchEnabled"
  | "textOnlyMode"
  | "videosEnabled"
  | "musicEnabledDefault"
  | "maxStorageMb"
  | "cleanupAfterDays"
  | "cleanupCustomEnabled"
  | "exaEnabled"
  | "exaApiKeyEnc"
>>;

type ModelConfigItem = Pick<
  ModelConfig,
  "id" | "provider" | "name" | "baseUrl" | "model" | "temperature" | "maxTokens" | "stream" | "isDefault"
>;

type ContentStyleItem = Pick<
  ContentStyle,
  "id" | "name" | "contentMode" | "tone" | "length" | "focus" | "outputStructure" | "customInstructions" | "isDefault"
>;

type AdminItem = Pick<AdminUser, "username"> | null;

type StorageSummary = {
  uploadsBytes: string;
  imageBytes: string;
  musicBytes: string;
  videoBytes: string;
  postCount: number;
  rawItemCount: number;
  fetchJobCount: number;
  approxDbBytesEstimate: string;
  maxStorageMb: number;
  cleanupAfterDays: number;
} | null;

function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

export function SettingsClient({
  site,
  modelConfigs,
  styles,
  admin,
  storage,
  initialTab = "site",
  savedFlag = false
}: {
  site: SettingsSite | null;
  modelConfigs: ModelConfigItem[];
  styles: ContentStyleItem[];
  admin: AdminItem;
  storage: StorageSummary;
  initialTab?: string;
  savedFlag?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(isSettingsTab(initialTab) ? initialTab : "site");
  const [savedVisible, setSavedVisible] = useState<boolean>(savedFlag);

  // 切换标签时同步到 ?tab=，这样刷新 / 分享链接不会丢当前所在的设置页。
  // 用 replaceState 而不是 router.replace：纯 URL 记录，不需要触发服务端重取。
  function switchTab(next: SettingsTab) {
    setActiveTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      url.searchParams.delete("saved");
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* URL 操作失败不影响功能 */
    }
  }

  // 让"已保存"提示在 ~2.5s 后淡出，避免一直占着视野。
  // savedFlag 由 server 根据 ?saved=1 query 传入，刷新页面只在保存后那一次显示。
  useEffect(() => {
    if (!savedFlag) return;
    const t = setTimeout(() => setSavedVisible(false), 2500);
    return () => clearTimeout(t);
  }, [savedFlag]);

  const s: SettingsSite = site || {};

  return (
    <div className="settings-layout">
      <aside
        className="settings-side-nav"
        aria-label="Settings sections"
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={(event) => {
          const order: SettingsTab[] = SETTINGS_TABS.map((t) => t.key);
          const idx = order.indexOf(activeTab);
          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            switchTab(order[(idx + 1) % order.length]);
          } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            switchTab(order[(idx - 1 + order.length) % order.length]);
          } else if (event.key === "Home") {
            event.preventDefault();
            switchTab(order[0]);
          } else if (event.key === "End") {
            event.preventDefault();
            switchTab(order[order.length - 1]);
          }
        }}
      >
        <div className="settings-side-nav-header">
          <I18nText zh="导航" en="Sections" />
        </div>
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`settings-tab-${tab.key}`}
              aria-controls={`settings-panel-${tab.key}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={isActive ? "active" : ""}
              onClick={() => switchTab(tab.key)}
            >
              <span className="settings-side-nav-icon" aria-hidden="true">{TAB_ICONS[tab.key]}</span>
              <I18nText zh={tab.zh} en={tab.en} />
            </button>
          );
        })}
      </aside>

      <main className="settings-content-pane">
        {savedVisible ? (
          <div className="settings-saved-pill" role="status" aria-live="polite">
            <span aria-hidden="true">✓</span>
            <I18nText zh="已保存" en="Saved" />
          </div>
        ) : null}

        {SITE_FORM_TABS.has(activeTab) ? (
        <form className="form-card form-stack" action="/api/admin/settings/site" method="post">
          <input type="hidden" name="settingsTab" value={activeTab} />

          <section id="settings-panel-site" role="tabpanel" aria-labelledby="settings-tab-site" hidden={activeTab !== "site"}>
            <SectionTitle title={<I18nText zh="站点基础信息" en="Site Basics" />} />
            <div className="field">
              <label htmlFor="name"><I18nText zh="站点名称" en="Site Name" /></label>
              <input id="name" name="name" defaultValue={String(s?.name ?? "拾贝 信息博客")} required />
            </div>
            <div className="field">
              <label htmlFor="description"><I18nText zh="站点简介" en="Site Description" /></label>
              <textarea id="description" name="description" defaultValue={String(s?.description ?? "")} required />
            </div>
            <div className="field">
              <label htmlFor="ownerName"><I18nText zh="管理员显示名" en="Admin Display Name" /></label>
              <input id="ownerName" name="ownerName" defaultValue={String(s?.ownerName ?? "管理员")} required />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="defaultTheme"><I18nText zh="默认主题" en="Default Theme" /></label>
                <select id="defaultTheme" name="defaultTheme" defaultValue={String(s?.defaultTheme ?? "apple")}>
                  {THEMES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label} - {t.desc}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="defaultFont"><I18nText zh="默认字体" en="Default Font" /></label>
                <select id="defaultFont" name="defaultFont" defaultValue={String(s?.defaultFont ?? "sans-cjk")}>
                  {FONTS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label} - {f.desc}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="defaultLanguage"><I18nText zh="默认语种" en="Default Language" /></label>
                <select id="defaultLanguage" name="defaultLanguage" defaultValue={String(s?.defaultLanguage ?? "zh")}>
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="defaultSettingsUI"><I18nText zh="默认界面风格" en="Default UI Style" /></label>
                <select id="defaultSettingsUI" name="defaultSettingsUI" defaultValue={String(s?.defaultSettingsUI ?? "classic")}>
                  {UI_STYLES.map((style) => (
                    <option key={style.key} value={style.key}>{style.zh}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section id="settings-panel-content" role="tabpanel" aria-labelledby="settings-tab-content" hidden={activeTab !== "content"}>
            <SectionTitle title={<I18nText zh="内容生产策略" en="Content Production" />} />
            <div className="settings-check-list">
              <label>
                <input type="checkbox" name="autoPublish" value="true" defaultChecked={Boolean(s?.autoPublish)} />{" "}
                <I18nText zh="AI 生成后自动发布" en="Auto-publish AI generated posts" />
              </label>
            </div>
            <div className="field">
              <label htmlFor="contentLanguageMode"><I18nText zh="内容语言模式" en="Content Language Mode" /></label>
              <select id="contentLanguageMode" name="contentLanguageMode" defaultValue={String(s?.contentLanguageMode ?? "default-language")}>
                {CONTENT_LANGUAGE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small className="muted">
                <I18nText zh="控制文章页是否按用户语言偏好生成英文版本。" en="Controls whether article pages generate English versions by user preference." />
              </small>
            </div>
            <div className="field">
              <label htmlFor="globalPromptPrefix"><I18nText zh="全局提示词前缀" en="Global Prompt Prefix" /></label>
              <textarea
                id="globalPromptPrefix"
                name="globalPromptPrefix"
                placeholder="例如：不臆测；引用要附上链接；事实和观点分开写。"
                defaultValue={String(s?.globalPromptPrefix ?? "")}
              />
              <small className="muted">
                <I18nText zh="在此填写所有写作风格都必须遵守的通用规则,如来源引用、口径要求等。" en="Hard rules every writing style must follow (e.g. citation, tone constraints)." />
              </small>
            </div>
          </section>

          <section role="group" aria-label="模型基础配置" hidden={activeTab !== "models"}>
            <SectionTitle title={<I18nText zh="各任务使用的模型" en="Task Models" />} />
            <div className="field-row">
              <ModelSelect id="contentModelConfigId" label={<I18nText zh="内容生成模型" en="Content Model" />} value={String(s?.contentModelConfigId ?? "")} configs={modelConfigs} />
              <ModelSelect id="assistantModelConfigId" label={<I18nText zh="前台助手模型" en="Assistant Model" />} value={String(s?.assistantModelConfigId ?? "")} configs={modelConfigs} />
            </div>
            <div className="field-row">
              <ModelSelect id="writingModelConfigId" label={<I18nText zh="用户写作模型" en="Writing Model" />} value={String(s?.writingModelConfigId ?? "")} configs={modelConfigs} />
              <ModelSelect id="translationModelConfigId" label={<I18nText zh="英文翻译模型" en="Translation Model" />} value={String(s?.translationModelConfigId ?? "")} configs={modelConfigs} />
            </div>
          </section>

          <section id="settings-panel-media" role="tabpanel" aria-labelledby="settings-tab-media" hidden={activeTab !== "media"}>
            <SectionTitle title={<I18nText zh="媒体与视频策略" en="Media & Video" />} />
            <div className="settings-check-list">
              <label>
                <input type="checkbox" name="videosEnabled" value="true" defaultChecked={Boolean(s?.videosEnabled)} />{" "}
                <I18nText zh="启用视频功能（默认关闭：前台不展示任何视频，自动抓取也不收集视频链接）" en="Enable videos (off by default: nothing renders publicly and crawls skip video links)" />
              </label>
              <label>
                <input type="hidden" name="autoImageSearchEnabled" value="false" />
                <input type="checkbox" name="autoImageSearchEnabled" value="true" defaultChecked={s?.autoImageSearchEnabled !== false} />{" "}
                <I18nText zh="自动搜索并插入相关图片" en="Automatically search and insert related images" />
              </label>
              <label>
                <input type="checkbox" name="textOnlyMode" value="true" defaultChecked={Boolean(s?.textOnlyMode)} />{" "}
                <I18nText zh="关闭自动视频链接识别（保留纯文本）" en="Disable automatic video link discovery" />
              </label>
              <label>
                <input type="checkbox" name="musicEnabledDefault" value="true" defaultChecked={Boolean(s?.musicEnabledDefault)} />{" "}
                <I18nText zh="默认开启背景音乐" en="Enable background music by default" />
              </label>
            </div>
            <p className="muted-block">
              <I18nText
                zh="视频没有独立页面，只以短代码嵌入在文章正文中。开启视频功能后，自动流程会把识别到的视频以原平台链接形式挂进文章；管理员可在「视频库」把某条视频下载到本地，之后文章内直接用本地播放器播放。"
                en="Videos have no standalone page; they only embed inside posts via shortcodes. With videos enabled, automatic runs attach discovered videos as links to their original platform; from the Videos library the admin can download one locally so the post plays it with a local player."
              />
            </p>
          </section>

          <section role="group" aria-label="存储清理基础配置" hidden={activeTab !== "storage"}>
            <SectionTitle title={<I18nText zh="存储与清理规则" en="Storage Cleanup Rules" />} />
            <div className="field-row">
              <div className="field">
                <label htmlFor="maxStorageMb"><I18nText zh="最大可用空间（MB）" en="Max Space (MB)" /></label>
                <input id="maxStorageMb" name="maxStorageMb" type="number" min={64} max={102400} defaultValue={Number(s?.maxStorageMb ?? 2048)} />
              </div>
              <div className="field">
                <label htmlFor="cleanupAfterDays"><I18nText zh="清理几天前的任务数据" en="Cleanup Jobs Older Than Days" /></label>
                <input id="cleanupAfterDays" name="cleanupAfterDays" type="number" min={1} max={3650} defaultValue={Number(s?.cleanupAfterDays ?? 30)} />
              </div>
            </div>
            <label>
              <input type="checkbox" name="cleanupCustomEnabled" value="true" defaultChecked={Boolean(s?.cleanupCustomEnabled)} />{" "}
              <I18nText zh="空间超限时自动归档旧文章并回收本地视频" en="Archive old posts and reclaim local videos when space is exceeded" />
            </label>
          </section>

          <section id="settings-panel-external" role="tabpanel" aria-labelledby="settings-tab-external" hidden={activeTab !== "external"}>
            <SectionTitle title={<I18nText zh="外部研究服务" en="External Research Services" />} />
            <label>
              <input type="checkbox" name="exaEnabled" value="true" defaultChecked={Boolean(s?.exaEnabled)} />{" "}
              <I18nText zh="启用 Exa 作为研究信息源" en="Enable Exa as research source" />
            </label>
            <div className="field">
              <label htmlFor="exaApiKey"><I18nText zh="Exa API Key（留空不修改）" en="Exa API Key (leave blank to keep)" /></label>
              <input id="exaApiKey" name="exaApiKey" type="password" placeholder={s?.exaApiKeyEnc ? "已配置（输入新值覆盖）" : ""} />
            </div>
          </section>

          <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}>
            <I18nText zh="保存当前设置" en="Save Settings" />
          </SubmitButton>
        </form>
      ) : null}

      {activeTab === "models" ? (
        <div className="settings-two-column" id="settings-panel-models" role="tabpanel" aria-labelledby="settings-tab-models">
          <form className="form-card form-stack" action="/api/admin/model-configs" method="post">
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增模型配置" en="New Model Config" /></h2>
            <div className="field">
              <label htmlFor="provider"><I18nText zh="模型服务商预设" en="Model Provider Preset" /></label>
              <select id="provider" name="provider" defaultValue="custom">
                {MODEL_PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.model ? `${preset.label} · ${preset.model}` : preset.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="modelName"><I18nText zh="配置名称" en="Config Name" /></label>
              <input id="modelName" name="name" required placeholder="例如：我的模型" />
            </div>
            <div className="field">
              <label htmlFor="baseUrl">Base URL</label>
              <input id="baseUrl" name="baseUrl" required placeholder="https://api.example.com/v1" />
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input id="model" name="model" required placeholder="模型名，例如 gpt-4o-mini" />
            </div>
            <div className="field">
              <label htmlFor="apiKey">API Key</label>
              <input id="apiKey" name="apiKey" type="password" required />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="temperature">Temperature</label>
                <input id="temperature" name="temperature" type="number" step="0.1" min="0" max="2" defaultValue="0.3" />
              </div>
              <div className="field">
                <label htmlFor="maxTokens">Max Tokens</label>
                <input id="maxTokens" name="maxTokens" type="number" defaultValue="8000" />
              </div>
            </div>
            <label><input type="checkbox" name="stream" value="true" /> <I18nText zh="启用流式生成" en="Enable Streaming" /></label>
            <label><input type="checkbox" name="isDefault" value="true" defaultChecked /> <I18nText zh="设为默认模型" en="Set as Default Model" /></label>
            <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存模型配置" en="Save Model Config" /></SubmitButton>
          </form>

          <section className="admin-panel">
            <h2 style={{ marginTop: 0 }}><I18nText zh="已有模型配置" en="Existing Models" /></h2>
            <div className="table-list">
              {modelConfigs.map((config) => (
                <div className="table-item model-config-row" key={config.id}>
                  <form className="model-config-form" action={`/api/admin/model-configs/${config.id}`} method="post">
                    <div className="meta-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <strong>{config.name}</strong>
                        <div className="muted">{providerLabel(config.provider)} · {config.baseUrl} · {config.model}</div>
                      </div>
                      <span className="tag">{config.isDefault ? <I18nText zh="默认" en="Default" /> : <I18nText zh="备用" en="Backup" />}</span>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`model-name-${config.id}`}><I18nText zh="名称" en="Name" /></label>
                        <input id={`model-name-${config.id}`} name="name" defaultValue={config.name} required />
                      </div>
                      <div className="field">
                        <label htmlFor={`model-id-${config.id}`}>Model</label>
                        <input id={`model-id-${config.id}`} name="model" defaultValue={config.model} required />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={`base-url-${config.id}`}>Base URL</label>
                      <input id={`base-url-${config.id}`} name="baseUrl" defaultValue={config.baseUrl} required />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`temperature-${config.id}`}>Temperature</label>
                        <input id={`temperature-${config.id}`} name="temperature" type="number" step="0.1" min="0" max="2" defaultValue={config.temperature} />
                      </div>
                      <div className="field">
                        <label htmlFor={`max-tokens-${config.id}`}>Max Tokens</label>
                        <input id={`max-tokens-${config.id}`} name="maxTokens" type="number" min="1" defaultValue={config.maxTokens} />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={`api-key-${config.id}`}><I18nText zh="替换 API Key" en="Replace API Key" /></label>
                      <input id={`api-key-${config.id}`} name="apiKey" type="password" placeholder="留空则不修改；解密失败时在这里重新填写" />
                    </div>
                    <div className="meta-row" style={{ alignItems: "center" }}>
                      <label><input type="checkbox" name="stream" value="true" defaultChecked={config.stream} /> <I18nText zh="流式" en="Streaming" /></label>
                      <label><input type="checkbox" name="isDefault" value="true" defaultChecked={config.isDefault} /> <I18nText zh="设为默认" en="Default" /></label>
                      <SubmitButton className="button secondary" pendingLabel={<I18nText zh="更新中…" en="Updating…" />}><I18nText zh="更新此模型" en="Update Model" /></SubmitButton>
                    </div>
                  </form>
                </div>
              ))}
              {modelConfigs.length === 0 ? <p className="muted"><I18nText zh="暂无配置。" en="No configs." /></p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "prompts" ? (
        <div className="settings-two-column" id="settings-panel-prompts" role="tabpanel" aria-labelledby="settings-tab-prompts">
          <form className="form-card form-stack" action="/api/admin/content-styles" method="post">
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增内容风格" en="New Content Style" /></h2>
            <div className="field">
              <label htmlFor="styleName"><I18nText zh="名称" en="Name" /></label>
              <input id="styleName" name="name" required placeholder="例如：教程指南 / 深度分析" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="contentMode"><I18nText zh="内容体裁" en="Content Mode" /></label>
                <select id="contentMode" name="contentMode" defaultValue="analysis">
                  {CONTENT_MODE_OPTIONS.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label} - {mode.description}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tone"><I18nText zh="输出风格" en="Tone" /></label>
                <select id="tone" name="tone" defaultValue="客观">
                  <option>客观</option>
                  <option>深度分析</option>
                  <option>科普解读</option>
                  <option>个人评论</option>
                  <option>实用指南</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="length"><I18nText zh="篇幅偏好" en="Length" /></label>
                <select id="length" name="length" defaultValue="中">
                  <option>短</option>
                  <option>中</option>
                  <option>长</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="focus"><I18nText zh="关注重点" en="Focus" /></label>
                <input id="focus" name="focus" defaultValue="核心事实, 行业影响, 背景脉络, 多方观点" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="outputStructure"><I18nText zh="输出结构" en="Output Structure" /></label>
              <input id="outputStructure" name="outputStructure" defaultValue="标题 -> 导语 -> 正文分章节叙述 -> 背景分析 -> 参考来源" />
            </div>
            <div className="field">
              <label htmlFor="customInstructions"><I18nText zh="自定义提示词" en="Custom Instructions" /></label>
              <textarea id="customInstructions" name="customInstructions" defaultValue="写一篇有深度的中文博客文章，要求正式标题、导语段落、分章节连贯叙述，禁止写成摘要或要点列表。" />
            </div>
            <label><input type="checkbox" name="isDefault" value="true" /> <I18nText zh="设为默认风格" en="Set as Default Style" /></label>
            <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存内容风格" en="Save Content Style" /></SubmitButton>
          </form>

          <section className="admin-panel">
            <h2 style={{ marginTop: 0 }}><I18nText zh="已有内容风格" en="Existing Styles" /></h2>
            <div className="table-list">
              {styles.map((style) => (
                <div className="table-item" key={style.id} style={{ display: "block" }}>
                  <form className="form-stack" action={`/api/admin/content-styles/${style.id}`} method="post">
                    <div className="meta-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <strong>{style.name}</strong>
                        <div className="muted">{contentModeLabel(style.contentMode)} · {style.tone} · {style.length} · {style.focus}</div>
                      </div>
                      <span className="tag">{style.isDefault ? <I18nText zh="默认" en="Default" /> : <I18nText zh="备用" en="Backup" />}</span>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`style-name-${style.id}`}><I18nText zh="名称" en="Name" /></label>
                        <input id={`style-name-${style.id}`} name="name" defaultValue={style.name} required />
                      </div>
                      <div className="field">
                        <label htmlFor={`style-mode-${style.id}`}><I18nText zh="内容体裁" en="Content mode" /></label>
                        <select id={`style-mode-${style.id}`} name="contentMode" defaultValue={style.contentMode || "report"}>
                          {CONTENT_MODE_OPTIONS.map((mode) => (
                            <option key={mode.value} value={mode.value}>{mode.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`style-tone-${style.id}`}><I18nText zh="输出风格" en="Tone" /></label>
                        <input id={`style-tone-${style.id}`} name="tone" defaultValue={style.tone} />
                      </div>
                      <div className="field">
                        <label htmlFor={`style-length-${style.id}`}><I18nText zh="篇幅" en="Length" /></label>
                        <select id={`style-length-${style.id}`} name="length" defaultValue={style.length || "中"}>
                          <option>短</option>
                          <option>中</option>
                          <option>长</option>
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={`style-focus-${style.id}`}><I18nText zh="关注重点" en="Focus" /></label>
                      <input id={`style-focus-${style.id}`} name="focus" defaultValue={style.focus} />
                    </div>
                    <div className="field">
                      <label htmlFor={`style-output-${style.id}`}><I18nText zh="输出结构" en="Output structure" /></label>
                      <input id={`style-output-${style.id}`} name="outputStructure" defaultValue={style.outputStructure} />
                    </div>
                    <div className="field">
                      <label htmlFor={`style-custom-${style.id}`}><I18nText zh="自定义提示词" en="Custom instructions" /></label>
                      <textarea id={`style-custom-${style.id}`} name="customInstructions" defaultValue={style.customInstructions || ""} />
                    </div>
                    <div className="meta-row" style={{ alignItems: "center" }}>
                      <label><input type="checkbox" name="isDefault" value="true" defaultChecked={style.isDefault} /> <I18nText zh="设为默认" en="Default" /></label>
                      <SubmitButton className="button secondary" pendingLabel="更新中…">更新风格</SubmitButton>
                      <ConfirmButton
                        message={`确定删除写作风格「${style.name}」?此操作无法撤销。`}
                        name="_intent"
                        value="delete"
                      >
                        删除
                      </ConfirmButton>
                    </div>
                  </form>
                </div>
              ))}
              {styles.length === 0 ? <p className="muted"><I18nText zh="暂无风格。" en="No styles." /></p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "storage" && storage ? (
        <section className="admin-panel" id="settings-panel-storage" role="tabpanel" aria-labelledby="settings-tab-storage" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="当前存储占用" en="Current Storage Usage" /></h2>
          <div className="admin-grid-3" style={{ marginTop: 16 }}>
            <MetricCard label={<I18nText zh="上传目录总和" en="Uploads Total" />} value={String(storage.uploadsBytes)} />
            <MetricCard label={<I18nText zh="图片缓存" en="Image Cache" />} value={String(storage.imageBytes)} />
            <MetricCard label={<I18nText zh="音乐占用" en="Music Usage" />} value={String(storage.musicBytes)} />
            <MetricCard label={<I18nText zh="视频占用" en="Video Usage" />} value={String(storage.videoBytes)} />
            <MetricCard label={<I18nText zh="文章数量" en="Post Count" />} value={String(storage.postCount)} />
            <MetricCard label={<I18nText zh="原始素材" en="Raw Items" />} value={String(storage.rawItemCount)} />
            <MetricCard label={<I18nText zh="任务数量" en="Fetch Jobs" />} value={String(storage.fetchJobCount)} />
            <MetricCard label={<I18nText zh="DB 估算" en="DB Estimate" />} value={String(storage.approxDbBytesEstimate)} />
            <MetricCard label={<I18nText zh="空间上限" en="Space Limit" />} value={`${storage.maxStorageMb} MB`} />
            <MetricCard label={<I18nText zh="清理阈值" en="Cleanup Threshold" />} value={`> ${storage.cleanupAfterDays} days`} />
          </div>
          <form action="/api/admin/storage/cleanup" method="post" style={{ marginTop: 16 }}>
            <SubmitButton className="button secondary" pendingLabel={<I18nText zh="清理中…" en="Cleaning…" />}><I18nText zh="立即按当前规则清理" en="Clean Up Now" /></SubmitButton>
          </form>
        </section>
      ) : null}

      {activeTab === "account" ? (
        <form className="form-card form-stack" id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" action="/api/admin/settings/admin" method="post" style={{ maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="管理员账号" en="Admin Account" /></h2>
          <div className="field">
            <label htmlFor="username"><I18nText zh="用户名" en="Username" /></label>
            <input id="username" name="username" defaultValue={admin?.username} required />
          </div>
          <div className="field">
            <label htmlFor="password"><I18nText zh="新密码" en="New Password" /></label>
            <input id="password" name="password" type="password" placeholder="留空则不修改" />
          </div>
          <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存账号" en="Save Account" /></SubmitButton>
        </form>
      ) : null}
      </main>
    </div>
  );
}

function SectionTitle({ title }: { title: React.ReactNode }) {
  return <h2 style={{ marginTop: 0 }}>{title}</h2>;
}

function ModelSelect({ id, label, value, configs }: { id: string; label: React.ReactNode; value: string; configs: ModelConfigItem[] }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={id} defaultValue={value}>
        <option value="">使用默认模型</option>
        {configs.map((config) => (
          <option key={config.id} value={config.id}>{config.name} · {config.model}</option>
        ))}
      </select>
    </div>
  );
}
