/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import { I18nText } from "@/components/I18nText";
import { LANGUAGE_OPTIONS, NEWS_LANGUAGE_MODE_OPTIONS } from "@/lib/language";
import { MODEL_PROVIDER_PRESETS, providerLabel } from "@/lib/model-providers";
import { FONTS, THEMES } from "@/lib/themes";

const INTERNATIONAL_VIDEO_PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "vimeo", label: "Vimeo" },
  { key: "twitch", label: "Twitch" },
  { key: "dailymotion", label: "Dailymotion" }
];

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

type SettingsTab = typeof SETTINGS_TABS[number]["key"];

const SITE_FORM_TABS = new Set<SettingsTab>(["site", "content", "models", "media", "storage", "external"]);

function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

export function SettingsClient({
  site,
  modelConfigs,
  styles,
  admin,
  storage,
  initialTab = "site"
}: {
  site: any;
  modelConfigs: any[];
  styles: any[];
  admin: any;
  storage: any;
  initialTab?: string;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(isSettingsTab(initialTab) ? initialTab : "site");
  const s = site || {};
  const videoDownloadHostsSet = useMemo(
    () =>
      new Set<string>(
        String(s?.videoDownloadHosts || "")
          .split(/[\s,]+/)
          .map((token: string) => token.trim().toLowerCase())
          .filter(Boolean)
      ),
    [s?.videoDownloadHosts]
  );

  const Stat = ({ label, value }: { label: React.ReactNode; value: string }) => (
    <div className="metric-card">
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--font-display)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );

  return (
    <>
      <div className="topic-tabs settings-tabs" style={{ marginBottom: 24 }}>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            <I18nText zh={tab.zh} en={tab.en} />
          </button>
        ))}
      </div>

      {SITE_FORM_TABS.has(activeTab) ? (
        <form className="form-card form-stack" action="/api/admin/settings/site" method="post">
          <input type="hidden" name="settingsTab" value={activeTab} />

          <section style={{ display: activeTab === "site" ? "block" : "none" }}>
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
                <select id="defaultTheme" name="defaultTheme" defaultValue={String(s?.defaultTheme ?? "minimal")}>
                  {THEMES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label} - {t.desc}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="defaultFont"><I18nText zh="默认字体" en="Default Font" /></label>
                <select id="defaultFont" name="defaultFont" defaultValue={String(s?.defaultFont ?? "serif-cjk")}>
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
                <label htmlFor="defaultSettingsUI"><I18nText zh="前台设置页风格" en="Frontend Settings UI" /></label>
                <select id="defaultSettingsUI" name="defaultSettingsUI" defaultValue={String(s?.defaultSettingsUI ?? "classic")}>
                  <option value="classic">经典风格</option>
                  <option value="cyber">科技风格</option>
                </select>
              </div>
            </div>
          </section>

          <section style={{ display: activeTab === "content" ? "block" : "none" }}>
            <SectionTitle title={<I18nText zh="内容生产策略" en="Content Production" />} />
            <div className="settings-check-list">
              <label>
                <input type="checkbox" name="autoPublish" value="true" defaultChecked={Boolean(s?.autoPublish)} />{" "}
                <I18nText zh="AI 生成后自动发布" en="Auto-publish AI generated posts" />
              </label>
            </div>
            <div className="field">
              <label htmlFor="newsLanguageMode"><I18nText zh="新闻语言模式" en="News Language Mode" /></label>
              <select id="newsLanguageMode" name="newsLanguageMode" defaultValue={String(s?.newsLanguageMode ?? "default-language")}>
                {NEWS_LANGUAGE_MODE_OPTIONS.map((option) => (
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
                placeholder="例如：以严肃新闻语气；不臆测；引用要附上链接。"
                defaultValue={String(s?.globalPromptPrefix ?? "")}
              />
              <small className="muted">
                <I18nText zh="放跨所有写作风格都必须遵守的硬规则。" en="Use this for hard rules shared by all writing styles." />
              </small>
            </div>
          </section>

          <section style={{ display: activeTab === "models" ? "block" : "none" }}>
            <SectionTitle title={<I18nText zh="各任务使用的模型" en="Task Models" />} />
            <div className="field-row">
              <ModelSelect id="newsModelConfigId" label={<I18nText zh="新闻整理模型" en="News Model" />} value={String(s?.newsModelConfigId ?? "")} configs={modelConfigs} />
              <ModelSelect id="assistantModelConfigId" label={<I18nText zh="前台助手模型" en="Assistant Model" />} value={String(s?.assistantModelConfigId ?? "")} configs={modelConfigs} />
            </div>
            <div className="field-row">
              <ModelSelect id="writingModelConfigId" label={<I18nText zh="用户写作模型" en="Writing Model" />} value={String(s?.writingModelConfigId ?? "")} configs={modelConfigs} />
              <ModelSelect id="translationModelConfigId" label={<I18nText zh="英文翻译模型" en="Translation Model" />} value={String(s?.translationModelConfigId ?? "")} configs={modelConfigs} />
            </div>
          </section>

          <section style={{ display: activeTab === "media" ? "block" : "none" }}>
            <SectionTitle title={<I18nText zh="媒体与视频策略" en="Media & Video" />} />
            <div className="settings-check-list">
              <label>
                <input type="checkbox" name="textOnlyMode" value="true" defaultChecked={Boolean(s?.textOnlyMode)} />{" "}
                <I18nText zh="纯文本模式：不抓取或下载视频，仅保留链接" en="Text-only mode: keep video links only" />
              </label>
              <label>
                <input type="checkbox" name="videoDownloadDomestic" value="true" defaultChecked={s?.videoDownloadDomestic !== false} />{" "}
                <I18nText zh="国内视频允许本地下载" en="Allow local download for domestic videos" />
              </label>
              <label>
                <input type="checkbox" name="musicEnabledDefault" value="true" defaultChecked={Boolean(s?.musicEnabledDefault)} />{" "}
                <I18nText zh="默认开启背景音乐" en="Enable background music by default" />
              </label>
            </div>
            <div className="field">
              <span className="field-label"><I18nText zh="国际视频平台本地下载" en="International Platform Download" /></span>
              <div className="settings-check-grid">
                {INTERNATIONAL_VIDEO_PLATFORMS.map((platform) => (
                  <label key={platform.key}>
                    <input
                      type="checkbox"
                      name="videoDownloadHosts"
                      value={platform.key}
                      defaultChecked={videoDownloadHostsSet.has(platform.key)}
                    />{" "}
                    {platform.label}
                  </label>
                ))}
              </div>
              <small className="muted">
                <I18nText zh="未勾选的平台会优先以嵌入或外链展示，不占用本地存储。" en="Unchecked platforms stay embedded or linked and use no local storage." />
              </small>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="videoMaxDurationSec"><I18nText zh="视频时长上限（秒）" en="Video Max Duration (seconds)" /></label>
                <input id="videoMaxDurationSec" name="videoMaxDurationSec" type="number" min={30} max={1200} defaultValue={Number(s?.videoMaxDurationSec ?? 1200)} />
              </div>
              <div className="field">
                <label htmlFor="videoMaxPerPost"><I18nText zh="每篇最多下载视频数" en="Max Local Videos Per Post" /></label>
                <input id="videoMaxPerPost" name="videoMaxPerPost" type="number" min={0} max={4} defaultValue={Number(s?.videoMaxPerPost ?? 4)} />
              </div>
            </div>
          </section>

          <section style={{ display: activeTab === "storage" ? "block" : "none" }}>
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

          <section style={{ display: activeTab === "external" ? "block" : "none" }}>
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

          <button className="button" type="submit">
            <I18nText zh="保存当前设置" en="Save Settings" />
          </button>
        </form>
      ) : null}

      {activeTab === "models" ? (
        <div className="settings-two-column">
          <form className="form-card form-stack" action="/api/admin/model-configs" method="post">
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增模型配置" en="New Model Config" /></h2>
            <div className="field">
              <label htmlFor="provider"><I18nText zh="模型服务商预设" en="Model Provider Preset" /></label>
              <select id="provider" name="provider" defaultValue="canopywave">
                {MODEL_PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.label} · {preset.model}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="modelName"><I18nText zh="配置名称" en="Config Name" /></label>
              <input id="modelName" name="name" required placeholder="例如：CanopyWave Kimi" />
            </div>
            <div className="field">
              <label htmlFor="baseUrl">Base URL</label>
              <input id="baseUrl" name="baseUrl" required placeholder="https://inference.canopywave.io/v1" />
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input id="model" name="model" required placeholder="moonshotai/kimi-k2.6" />
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
            <button className="button" type="submit"><I18nText zh="保存模型配置" en="Save Model Config" /></button>
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
                        <div className="muted">{providerLabel((config as { provider?: string }).provider)} · {config.baseUrl} · {config.model}</div>
                      </div>
                      <span className="tag">{config.isDefault ? <I18nText zh="默认" en="Default" /> : <I18nText zh="备用" en="Backup" />}</span>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`model-name-${config.id}`}>名称</label>
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
                      <label htmlFor={`api-key-${config.id}`}>替换 API Key</label>
                      <input id={`api-key-${config.id}`} name="apiKey" type="password" placeholder="留空则不修改；解密失败时在这里重新填写" />
                    </div>
                    <div className="meta-row" style={{ alignItems: "center" }}>
                      <label><input type="checkbox" name="stream" value="true" defaultChecked={config.stream} /> 流式</label>
                      <label><input type="checkbox" name="isDefault" value="true" defaultChecked={config.isDefault} /> 设为默认</label>
                      <button className="button secondary" type="submit">更新此模型</button>
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
        <div className="settings-two-column">
          <form className="form-card form-stack" action="/api/admin/summary-styles" method="post">
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增总结风格" en="New Summary Style" /></h2>
            <div className="field">
              <label htmlFor="styleName"><I18nText zh="名称" en="Name" /></label>
              <input id="styleName" name="name" required placeholder="例如：深度分析" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="tone"><I18nText zh="输出风格" en="Tone" /></label>
                <select id="tone" name="tone" defaultValue="客观新闻">
                  <option>客观新闻</option>
                  <option>深度分析</option>
                  <option>科普解读</option>
                  <option>个人评论</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="length"><I18nText zh="篇幅偏好" en="Length" /></label>
                <select id="length" name="length" defaultValue="中">
                  <option>短</option>
                  <option>中</option>
                  <option>长</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="focus"><I18nText zh="关注重点" en="Focus" /></label>
              <input id="focus" name="focus" defaultValue="核心事实, 行业影响, 背景脉络, 多方观点" />
            </div>
            <div className="field">
              <label htmlFor="outputStructure"><I18nText zh="输出结构" en="Output Structure" /></label>
              <input id="outputStructure" name="outputStructure" defaultValue="标题 -> 导语 -> 正文分章节叙述 -> 背景分析 -> 参考来源" />
            </div>
            <div className="field">
              <label htmlFor="promptTemplate"><I18nText zh="自定义提示词模板" en="Prompt Template" /></label>
              <textarea id="promptTemplate" name="promptTemplate" defaultValue="写一篇有深度的中文博客文章，要求正式标题、导语段落、分章节连贯叙述，禁止写成摘要或要点列表。" />
            </div>
            <label><input type="checkbox" name="isDefault" value="true" /> <I18nText zh="设为默认风格" en="Set as Default Style" /></label>
            <button className="button" type="submit"><I18nText zh="保存总结风格" en="Save Summary Style" /></button>
          </form>

          <section className="admin-panel">
            <h2 style={{ marginTop: 0 }}><I18nText zh="已有总结风格" en="Existing Styles" /></h2>
            <div className="table-list">
              {styles.map((style) => (
                <div className="table-item" key={style.id}>
                  <div>
                    <strong>{style.name}</strong>
                    <div className="muted">{style.tone} · {style.length} · {style.focus}</div>
                  </div>
                  <span className="tag">{style.isDefault ? <I18nText zh="默认" en="Default" /> : <I18nText zh="备用" en="Backup" />}</span>
                </div>
              ))}
              {styles.length === 0 ? <p className="muted"><I18nText zh="暂无风格。" en="No styles." /></p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "storage" && storage ? (
        <section className="admin-panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="当前存储占用" en="Current Storage Usage" /></h2>
          <div className="admin-grid-3" style={{ marginTop: 10 }}>
            <Stat label={<I18nText zh="上传目录总和" en="Uploads Total" />} value={String(storage.uploadsBytes)} />
            <Stat label={<I18nText zh="音乐占用" en="Music Usage" />} value={String(storage.musicBytes)} />
            <Stat label={<I18nText zh="视频占用" en="Video Usage" />} value={String(storage.videoBytes)} />
            <Stat label={<I18nText zh="文章数量" en="Post Count" />} value={String(storage.postCount)} />
            <Stat label={<I18nText zh="原始素材" en="Raw Items" />} value={String(storage.rawItemCount)} />
            <Stat label={<I18nText zh="任务数量" en="Fetch Jobs" />} value={String(storage.fetchJobCount)} />
            <Stat label={<I18nText zh="DB 估算" en="DB Estimate" />} value={String(storage.approxDbBytesEstimate)} />
            <Stat label={<I18nText zh="空间上限" en="Space Limit" />} value={`${storage.maxStorageMb} MB`} />
            <Stat label={<I18nText zh="清理阈值" en="Cleanup Threshold" />} value={`> ${storage.cleanupAfterDays} days`} />
          </div>
          <form action="/api/admin/storage/cleanup" method="post" style={{ marginTop: 14 }}>
            <button className="button secondary" type="submit"><I18nText zh="立即按当前规则清理" en="Clean Up Now" /></button>
          </form>
        </section>
      ) : null}

      {activeTab === "account" ? (
        <form className="form-card form-stack" action="/api/admin/settings/admin" method="post" style={{ maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="管理员账号" en="Admin Account" /></h2>
          <div className="field">
            <label htmlFor="username"><I18nText zh="用户名" en="Username" /></label>
            <input id="username" name="username" defaultValue={admin?.username} required />
          </div>
          <div className="field">
            <label htmlFor="password"><I18nText zh="新密码" en="New Password" /></label>
            <input id="password" name="password" type="password" placeholder="留空则不修改" />
          </div>
          <button className="button" type="submit"><I18nText zh="保存账号" en="Save Account" /></button>
        </form>
      ) : null}
    </>
  );
}

function SectionTitle({ title }: { title: React.ReactNode }) {
  return <h2 style={{ marginTop: 0 }}>{title}</h2>;
}

function ModelSelect({ id, label, value, configs }: { id: string; label: React.ReactNode; value: string; configs: any[] }) {
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
