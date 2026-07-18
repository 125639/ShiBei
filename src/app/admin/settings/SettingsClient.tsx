"use client";

import { useState, useEffect } from "react";
import type { AdminUser, ContentStyle, ModelConfig, SiteSettings } from "@prisma/client";
import { ConfirmButton } from "@/components/ConfirmButton";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { SubmitButton } from "@/components/SubmitButton";
import { ModelConfigManager } from "@/components/admin/ModelConfigManager";
import { StorageCleanupControls } from "@/components/admin/StorageCleanupControls";
import { CONTENT_MODE_OPTIONS, DEFAULT_BLOG_STYLE, contentModeLabel } from "@/lib/content-style";
import { LANGUAGE_OPTIONS, CONTENT_LANGUAGE_MODE_OPTIONS } from "@/lib/language";
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

const SITE_FORM_TABS = new Set<SettingsTab>(["site", "content", "media", "storage", "external"]);
const FRONTEND_SETTINGS_TABS = new Set<SettingsTab>(["site", "media", "storage", "account"]);

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
  | "youtubeSearchEnabled"
  | "bilibiliSearchEnabled"
  | "videoAttachMode"
  | "commentsEnabled"
  | "musicEnabledDefault"
  | "maxStorageMb"
  | "cleanupAfterDays"
  | "cleanupCustomEnabled"
  | "exaEnabled"
>> & { exaConfigured?: boolean };

type ModelConfigItem = Pick<
  ModelConfig,
  "id" | "provider" | "name" | "baseUrl" | "model" | "temperature" | "maxTokens" | "isEnabled" | "isDefault"
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

type CleanupResult =
  | {
      status: "success";
      fetchJobsDeleted: number;
      rawItemsDeleted: number;
      archivedPosts: number;
      videoFilesDeleted: number;
      bytesFreed: string;
    }
  | { status: "error" };

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
  savedFlag = false,
  modelStatus,
  modelError,
  accountError,
  cleanupResult,
  workerEnabled = true
}: {
  site: SettingsSite | null;
  modelConfigs: ModelConfigItem[];
  styles: ContentStyleItem[];
  admin: AdminItem;
  storage: StorageSummary;
  initialTab?: string;
  savedFlag?: boolean;
  modelStatus?: string;
  modelError?: string;
  accountError?: string;
  cleanupResult?: CleanupResult;
  workerEnabled?: boolean;
}) {
  const visibleTabs = workerEnabled
    ? SETTINGS_TABS
    : SETTINGS_TABS.filter((tab) => FRONTEND_SETTINGS_TABS.has(tab.key));
  const initialTabAvailable = isSettingsTab(initialTab)
    && visibleTabs.some((tab) => tab.key === initialTab);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTabAvailable ? initialTab : "site");
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

  function switchTabFromKeyboard(next: SettingsTab) {
    switchTab(next);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next}`)?.focus());
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
          const order: SettingsTab[] = visibleTabs.map((t) => t.key);
          const idx = order.indexOf(activeTab);
          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            switchTabFromKeyboard(order[(idx + 1) % order.length]);
          } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            switchTabFromKeyboard(order[(idx - 1 + order.length) % order.length]);
          } else if (event.key === "Home") {
            event.preventDefault();
            switchTabFromKeyboard(order[0]);
          } else if (event.key === "End") {
            event.preventDefault();
            switchTabFromKeyboard(order[order.length - 1]);
          }
        }}
      >
        <div className="settings-side-nav-header">
          <I18nText zh="导航" en="Sections" />
        </div>
        {visibleTabs.map((tab) => {
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

      <div className="settings-content-pane">
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

          <section id="settings-panel-media" role="tabpanel" aria-labelledby="settings-tab-media" hidden={activeTab !== "media"}>
            <SectionTitle title={<I18nText zh="媒体与视频策略" en="Media & Video" />} />
            <div className="settings-check-list">
              <label>
                <input type="checkbox" name="videosEnabled" value="true" defaultChecked={Boolean(s?.videosEnabled)} />{" "}
                <I18nText zh="启用视频功能（默认关闭：前台不展示任何视频，自动抓取也不收集视频链接）" en="Enable videos (off by default: nothing renders publicly and crawls skip video links)" />
              </label>
              <label>
                <input type="checkbox" name="bilibiliSearchEnabled" value="true" defaultChecked={s?.bilibiliSearchEnabled !== false} />{" "}
                <I18nText zh="自动搜索 Bilibili 相关视频（默认开启；B 站播放器国内可直连，优先于 YouTube 使用）" en="Auto-search related Bilibili videos (on by default; the Bilibili player loads directly in mainland China and is preferred over YouTube)" />
              </label>
              <label>
                <input type="checkbox" name="youtubeSearchEnabled" value="true" defaultChecked={s?.youtubeSearchEnabled !== false} />{" "}
                <I18nText zh="自动搜索 YouTube 相关视频（默认开启，作为 Bilibili 无结果时的兜底；服务器无法访问 YouTube 时请关闭，避免每篇文章白等搜索超时）" en="Auto-search related YouTube videos (on by default as the fallback when Bilibili has no match; turn off if the server cannot reach YouTube to avoid a per-article search timeout)" />
              </label>
            </div>
            <div className="field" style={{ marginTop: 12, maxWidth: 520 }}>
              <label htmlFor="videoAttachMode"><I18nText zh="自动挂载视频的默认模式" en="Default video attach mode" /></label>
              <select id="videoAttachMode" name="videoAttachMode" defaultValue={s?.videoAttachMode || "embed"}>
                <option value="embed">外链嵌入播放器 / Embed external player</option>
                <option value="link">仅链接卡片 / Link card only</option>
                <option value="download">下载到本地（480p）/ Download locally (480p)</option>
                <option value="off">不自动挂视频 / No automatic videos</option>
              </select>
              <small className="muted">
                <I18nText
                  zh="读者无法直连 YouTube 等平台时选「下载到本地」：自动挂载的视频随即缓存为 480p 本地副本，用本站播放器播放。每次生成任务可在表单里按单覆盖。"
                  en="Pick “Download locally” when readers cannot reach YouTube etc.: attached videos are cached as 480p local copies and play from this site. Each generation form can override per job."
                />
              </small>
            </div>
            <div className="settings-check-list" style={{ marginTop: 12 }}>
              <label>
                <input type="checkbox" name="commentsEnabled" value="true" defaultChecked={Boolean(s?.commentsEnabled)} />{" "}
                <I18nText zh="启用评论功能（默认关闭；开启后仅注册会员可评论，注册凭邀请码）" en="Enable comments (off by default; only registered members can comment, registration by invite code)" />
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
                <label htmlFor="cleanupAfterDays"><I18nText zh="独立已完成任务 / 孤儿素材保留天数" en="Standalone Completed Job / Orphan Retention Days" /></label>
                <input id="cleanupAfterDays" name="cleanupAfterDays" type="number" min={1} max={3650} defaultValue={Number(s?.cleanupAfterDays ?? 30)} />
              </div>
            </div>
            <label>
              <input type="checkbox" name="cleanupCustomEnabled" value="true" defaultChecked={Boolean(s?.cleanupCustomEnabled)} />{" "}
              <I18nText zh="启用后台自动清理（每 6 小时按保留天数清理已完成的非批次任务和孤儿素材；仅在空间超限时归档旧文章并回收其本地视频）" en="Enable background cleanup (every 6 hours, remove old standalone completed jobs and orphaned material; archive old posts and reclaim their local videos only when over quota)" />
            </label>
            <small className="muted">
              <I18nText zh="关闭后，定时任务不会写库或删除文件。失败任务、运行中任务以及 AI 管理员批次历史不会被自动清理。" en="When disabled, scheduled cleanup does not write to the database or delete files. Failed/in-flight jobs and AI admin batch history are never removed automatically." />
            </small>
          </section>

          <section id="settings-panel-external" role="tabpanel" aria-labelledby="settings-tab-external" hidden={activeTab !== "external"}>
            <SectionTitle title={<I18nText zh="外部研究服务" en="External Research Services" />} />
            <label>
              <input type="checkbox" name="exaEnabled" value="true" defaultChecked={Boolean(s?.exaEnabled)} />{" "}
              <I18nText zh="启用 Exa 作为研究信息源" en="Enable Exa as research source" />
            </label>
            <div className="field">
              <label htmlFor="exaApiKey"><I18nText zh="Exa API Key（留空不修改）" en="Exa API Key (leave blank to keep)" /></label>
              <input id="exaApiKey" name="exaApiKey" type="password" placeholder={s?.exaConfigured ? "已配置（输入新值覆盖）" : ""} />
            </div>
            <small className="muted">
              <I18nText
                zh="Exa 是可选项。未配置时，研究与核验会改用 Google News + Bing News 搜索发现链接并抓取原网页正文：新闻/时事类选题效果接近；但博客、文档、论文类来源基本搜不到，技术深挖选题的资料明显变薄，事实核验也更容易要求补充来源。配置 Exa（神经网络全网搜索）可以覆盖这类来源并跳过逐页抓取，研究更快更全。"
                en="Exa is optional. Without it, research and verification fall back to Google News + Bing News discovery plus fetching each page body: news-style topics work almost as well, but blogs, docs, and papers are largely invisible, so deep technical topics get much thinner material and fact-checks ask for sources more often. Configuring Exa (neural web search) covers those sources and skips per-page scraping, making research faster and broader."
              />
            </small>
          </section>

          <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}>
            <I18nText zh="保存当前设置" en="Save Settings" />
          </SubmitButton>
        </form>
      ) : null}

      {activeTab === "models" ? (
        <div id="settings-panel-models" role="tabpanel" aria-labelledby="settings-tab-models">
          <ModelConfigManager
            configs={modelConfigs}
            assignments={{
              contentModelConfigId: String(s?.contentModelConfigId ?? ""),
              assistantModelConfigId: String(s?.assistantModelConfigId ?? ""),
              writingModelConfigId: String(s?.writingModelConfigId ?? ""),
              translationModelConfigId: String(s?.translationModelConfigId ?? "")
            }}
            status={modelStatus}
            error={modelError}
          />
        </div>
      ) : null}

      {activeTab === "prompts" ? (
        <div className="settings-two-column" id="settings-panel-prompts" role="tabpanel" aria-labelledby="settings-tab-prompts">
          <form className="form-card form-stack" action="/api/admin/content-styles" method="post">
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增内容风格" en="New Content Style" /></h2>
            <div className="field">
              <label htmlFor="styleName"><I18nText zh="名称" en="Name" /></label>
              <input id="styleName" name="name" required placeholder="例如：教程指南 / 深度分析" defaultValue={DEFAULT_BLOG_STYLE.name} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="contentMode"><I18nText zh="内容体裁" en="Content Mode" /></label>
                <select id="contentMode" name="contentMode" defaultValue={DEFAULT_BLOG_STYLE.contentMode}>
                  {CONTENT_MODE_OPTIONS.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label} - {mode.description}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tone"><I18nText zh="输出风格" en="Tone" /></label>
                <select id="tone" name="tone" defaultValue={DEFAULT_BLOG_STYLE.tone}>
                  <option>{DEFAULT_BLOG_STYLE.tone}</option>
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
                <select id="length" name="length" defaultValue={DEFAULT_BLOG_STYLE.length}>
                  <option>短</option>
                  <option>中</option>
                  <option>长</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="focus"><I18nText zh="关注重点" en="Focus" /></label>
                <input id="focus" name="focus" defaultValue={DEFAULT_BLOG_STYLE.focus} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="outputStructure"><I18nText zh="输出结构" en="Output Structure" /></label>
              <input id="outputStructure" name="outputStructure" defaultValue={DEFAULT_BLOG_STYLE.outputStructure} />
            </div>
            <div className="field">
              <label htmlFor="customInstructions"><I18nText zh="自定义提示词" en="Custom Instructions" /></label>
              <textarea id="customInstructions" name="customInstructions" defaultValue={DEFAULT_BLOG_STYLE.customInstructions} />
              <small className="muted">
                <I18nText
                  zh="这里控制选题和文风；事实边界、证据不足不成文、禁止凑字数等发布规则始终优先。"
                  en="This controls angle and voice. Evidence, no-padding, and publication-safety rules always take precedence."
                />
              </small>
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
          {cleanupResult?.status === "success" ? (
            <p className="muted-block" role="status">
              <I18nText
                zh={`清理完成：删除 ${cleanupResult.fetchJobsDeleted} 个已完成任务和 ${cleanupResult.rawItemsDeleted} 条孤儿素材，归档 ${cleanupResult.archivedPosts} 篇旧文章，删除 ${cleanupResult.videoFilesDeleted} 个本地视频文件，释放约 ${cleanupResult.bytesFreed}。`}
                en={`Cleanup completed: removed ${cleanupResult.fetchJobsDeleted} completed jobs and ${cleanupResult.rawItemsDeleted} orphan items, archived ${cleanupResult.archivedPosts} old posts, deleted ${cleanupResult.videoFilesDeleted} local video files, and freed about ${cleanupResult.bytesFreed}.`}
              />
            </p>
          ) : cleanupResult?.status === "error" ? (
            <p className="form-error" role="alert">
              <I18nText
                zh="清理未完整执行。系统已停止后续步骤并记录错误；请查看服务日志，解决后再重试。"
                en="Cleanup did not complete. Later steps were stopped and the error was logged; inspect service logs before retrying."
              />
            </p>
          ) : null}
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
            <MetricCard label={<I18nText zh="保留期限" en="Retention Period" />} value={`${storage.cleanupAfterDays} days`} />
          </div>
          <StorageCleanupControls retentionDays={storage.cleanupAfterDays} />
        </section>
      ) : null}

      {activeTab === "account" ? (
        <form className="form-card form-stack" id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" action="/api/admin/settings/admin" method="post" style={{ maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="管理员账号" en="Admin Account" /></h2>
          {accountError ? (
            <p className="form-error" role="alert">
              <I18nText zh={accountErrorMessage(accountError).zh} en={accountErrorMessage(accountError).en} />
            </p>
          ) : null}
          <p className="muted-block" id="admin-account-security-note">
            <I18nText
              zh={<>
                设置新密码会立即吊销所有设备（包括当前页面）的管理员会话，保存后需要重新登录。部署环境中的 <code>ADMIN_USERNAME</code> / <code>ADMIN_PASSWORD</code> 是启动 seed 的权威配置；若与数据库不同，重启或再次 seed 可能恢复密码或另建环境变量指定的管理员。要永久修改，请同步更新部署环境变量。
              </>}
              en={<>
                Setting a new password immediately revokes every admin session, including this one, and requires a fresh sign-in. <code>ADMIN_USERNAME</code> / <code>ADMIN_PASSWORD</code> remain authoritative during deployment seeding; a restart or seed may restore that password or recreate the environment-defined administrator. Update the deployment variables as well for a persistent change.
              </>}
            />
          </p>
          <div className="field">
            <label htmlFor="username"><I18nText zh="用户名" en="Username" /></label>
            <input
              id="username"
              name="username"
              defaultValue={admin?.username}
              required
              minLength={3}
              maxLength={80}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="admin-account-security-note"
            />
          </div>
          <div className="field">
            <label htmlFor="password"><I18nText zh="新密码" en="New Password" /></label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={12}
              maxLength={100}
              autoComplete="new-password"
              aria-describedby="admin-account-security-note admin-password-requirements"
              placeholder="留空则不修改"
            />
            <small className="muted" id="admin-password-requirements">
              <I18nText
                zh="至少 12 位，并包含大写字母、小写字母、数字、符号中的至少三类；不能包含账号名。"
                en="At least 12 characters and three of uppercase, lowercase, digits, and symbols; must not contain the username."
              />
            </small>
          </div>
          <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存账号" en="Save Account" /></SubmitButton>
        </form>
      ) : null}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: React.ReactNode }) {
  return <h2 style={{ marginTop: 0 }}>{title}</h2>;
}

function accountErrorMessage(code: string) {
  const messages: Record<string, { zh: string; en: string }> = {
    invalid_username: {
      zh: "用户名需为 3–80 个字符，且不能包含控制字符。",
      en: "The username must be 3–80 characters and contain no control characters."
    },
    weak_password: {
      zh: "新密码不符合下方强度要求，账号未修改。",
      en: "The new password does not meet the requirements below; the account was not changed."
    },
    same_password: {
      zh: "新密码不能与当前密码相同。",
      en: "The new password must differ from the current password."
    },
    username_taken: {
      zh: "该用户名已被其他管理员使用。",
      en: "That username is already used by another administrator."
    },
    session_changed: {
      zh: "当前管理员会话已失效或账号刚被修改，请重新登录。",
      en: "This admin session is no longer current; sign in again."
    }
  };
  return messages[code] || {
    zh: "账号设置未保存，请检查输入后重试。",
    en: "The account settings were not saved. Check the input and try again."
  };
}
