/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { I18nText } from "@/components/I18nText";
import { LANGUAGE_OPTIONS, NEWS_LANGUAGE_MODE_OPTIONS } from "@/lib/language";
import { MODEL_PROVIDER_PRESETS, providerLabel } from "@/lib/model-providers";
import { FONTS, THEMES } from "@/lib/themes";

export function SettingsClient({
  site,
  modelConfigs,
  styles,
  admin,
  storage,
}: {
  site: any;
  modelConfigs: any[];
  styles: any[];
  admin: any;
  storage: any;
}) {
  const [activeTab, setActiveTab] = useState("site");
  const s = site || {};

  const Stat = ({ label, value }: { label: React.ReactNode; value: string }) => (
    <div className="metric-card">
      <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "var(--font-display)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
    </div>
  );

  return (
    <>
      <div className="topic-tabs" style={{ marginBottom: "24px" }}>
        <button type="button" className={activeTab === "site" ? "active" : ""} onClick={() => setActiveTab("site")}>
          <I18nText zh="🖥️ 站点与基础" en="🖥️ Site & Basics" />
        </button>
        <button type="button" className={activeTab === "ai" ? "active" : ""} onClick={() => setActiveTab("ai")}>
          <I18nText zh="🤖 AI 与外部源" en="🤖 AI & External" />
        </button>
        <button type="button" className={activeTab === "storage" ? "active" : ""} onClick={() => setActiveTab("storage")}>
          <I18nText zh="💾 存储与清理" en="💾 Storage & Cleanup" />
        </button>
        <button type="button" className={activeTab === "account" ? "active" : ""} onClick={() => setActiveTab("account")}>
          <I18nText zh="🔐 账号与模型预设" en="🔐 Account & Models" />
        </button>
      </div>

      <div style={{ display: activeTab === "site" || activeTab === "ai" || activeTab === "storage" ? "block" : "none" }}>
        <form className="form-card form-stack" action="/api/admin/settings/site" method="post">
          
          {/* ----- TAB 1: SITE & BASICS ----- */}
          <div style={{ display: activeTab === "site" ? "block" : "none" }}>
            <h2 style={{ marginTop: 0 }}><I18nText zh="站点与外观" en="Site & Appearance" /></h2>
            <div className="field">
              <label htmlFor="name"><I18nText zh="站点名称" en="Site Name" /></label>
              <input id="name" name="name" defaultValue={String(s?.name ?? "拾贝 信息博客")} required />
            </div>
            <div className="field">
              <label htmlFor="description"><I18nText zh="站点简介" en="Site Description" /></label>
              <textarea
                id="description"
                name="description"
                defaultValue={String(s?.description ?? "")}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="ownerName"><I18nText zh="管理员显示名" en="Admin Display Name" /></label>
              <input id="ownerName" name="ownerName" defaultValue={String(s?.ownerName ?? "管理员")} required />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="defaultTheme"><I18nText zh="默认主题（用户首次访问）" en="Default Theme (First Visit)" /></label>
                <select id="defaultTheme" name="defaultTheme" defaultValue={String(s?.defaultTheme ?? "minimal")}>
                  {THEMES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label} — {t.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="defaultSettingsUI"><I18nText zh="默认设置界面风格" en="Default Settings UI Style" /></label>
                <select id="defaultSettingsUI" name="defaultSettingsUI" defaultValue={String(s?.defaultSettingsUI ?? "classic")}>
                  <option value="classic">经典风格 (Classic)</option>
                  <option value="cyber">科技纪元 (Cyberpunk)</option>
                </select>
                <small className="muted"><I18nText zh="用户可以在个人设置中覆盖此选项。" en="Users can override this in their personal settings." /></small>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="defaultFont"><I18nText zh="默认字体" en="Default Font" /></label>
                <select id="defaultFont" name="defaultFont" defaultValue={String(s?.defaultFont ?? "serif-cjk")}>
                  {FONTS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label} — {f.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="defaultLanguage"><I18nText zh="默认语种" en="Default Language" /></label>
                <select id="defaultLanguage" name="defaultLanguage" defaultValue={String(s?.defaultLanguage ?? "zh")}>
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
                <small className="muted"><I18nText zh="默认中文；用户可以在前台设置中切换英文。" en="Default is Chinese; users can switch to English in front-end settings." /></small>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="newsLanguageMode"><I18nText zh="新闻语言模式" en="News Language Mode" /></label>
                <select id="newsLanguageMode" name="newsLanguageMode" defaultValue={String(s?.newsLanguageMode ?? "default-language")}>
                  {NEWS_LANGUAGE_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <small className="muted"><I18nText zh="默认语种模式会按用户偏好在文章页生成英文版本。" en="Default language mode will generate English versions on the article page based on user preference." /></small>
              </div>
            </div>

            <label>
              <input type="checkbox" name="autoPublish" value="true" defaultChecked={Boolean(s?.autoPublish)} /> <I18nText zh="自动发布 AI 生成的文章" en="Auto-publish AI-generated articles" />
            </label>
            <label>
              <input type="checkbox" name="textOnlyMode" value="true" defaultChecked={Boolean(s?.textOnlyMode)} /> <I18nText zh="纯文本模式（不抓取/不下载视频，仅留链接）" en="Text-only mode (No video crawling/downloading, keep links only)" />
            </label>
            <label>
              <input type="checkbox" name="videoDownloadDomestic" value="true" defaultChecked={s?.videoDownloadDomestic !== false} /> <I18nText zh="国内视频允许本地下载（≤ 视频时长上限）" en="Allow local download of domestic videos (≤ Max duration)" />
            </label>
            <label>
              <input type="checkbox" name="musicEnabledDefault" value="true" defaultChecked={Boolean(s?.musicEnabledDefault)} /> <I18nText zh="默认开启背景音乐（用户可关闭）" en="Enable background music by default (users can disable)" />
            </label>

            <div className="field">
              <label htmlFor="videoMaxDurationSec"><I18nText zh="视频时长上限（秒，最长 1200 = 20 分钟）" en="Video Max Duration (seconds, max 1200 = 20 mins)" /></label>
              <input
                id="videoMaxDurationSec"
                name="videoMaxDurationSec"
                type="number"
                min={30}
                max={1200}
                defaultValue={Number(s?.videoMaxDurationSec ?? 1200)}
              />
            </div>
          </div>

          {/* ----- TAB 2: AI & EXTERNAL ----- */}
          <div style={{ display: activeTab === "ai" ? "block" : "none" }}>
            <h2 style={{ marginTop: 0 }}><I18nText zh="AI 与外部源" en="AI & External Sources" /></h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor="newsModelConfigId"><I18nText zh="整理新闻模型" en="News Curation Model" /></label>
                <select id="newsModelConfigId" name="newsModelConfigId" defaultValue={String(s?.newsModelConfigId ?? "")}>
                  <option value=""><I18nText zh="使用默认模型" en="Use Default Model" /></option>
                  {modelConfigs.map((config) => (
                    <option key={config.id} value={config.id}>{config.name} · {config.model}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="assistantModelConfigId"><I18nText zh="前台 AI 助手模型" en="Frontend AI Assistant Model" /></label>
                <select id="assistantModelConfigId" name="assistantModelConfigId" defaultValue={String(s?.assistantModelConfigId ?? "")}>
                  <option value=""><I18nText zh="使用默认模型" en="Use Default Model" /></option>
                  {modelConfigs.map((config) => (
                    <option key={config.id} value={config.id}>{config.name} · {config.model}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="writingModelConfigId"><I18nText zh="用户写作默认模型" en="User Writing Default Model" /></label>
                <select id="writingModelConfigId" name="writingModelConfigId" defaultValue={String(s?.writingModelConfigId ?? "")}>
                  <option value=""><I18nText zh="使用默认模型" en="Use Default Model" /></option>
                  {modelConfigs.map((config) => (
                    <option key={config.id} value={config.id}>{config.name} · {config.model}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="translationModelConfigId"><I18nText zh="新闻英文翻译模型" en="News English Translation Model" /></label>
                <select id="translationModelConfigId" name="translationModelConfigId" defaultValue={String(s?.translationModelConfigId ?? "")}>
                  <option value=""><I18nText zh="使用 AI 助手/默认模型" en="Use AI Assistant / Default Model" /></option>
                  {modelConfigs.map((config) => (
                    <option key={config.id} value={config.id}>{config.name} · {config.model}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="globalPromptPrefix"><I18nText zh="全局提示词前缀（追加到所有 AI 请求最前）" en="Global Prompt Prefix (Prepended to all AI requests)" /></label>
              <textarea
                id="globalPromptPrefix"
                name="globalPromptPrefix"
                placeholder="例如：以严肃新闻语气；不臆测；不产出虚假事实；引用要附上链接。"
                defaultValue={String(s?.globalPromptPrefix ?? "")}
              />
              <small className="muted"><I18nText zh="单独的总结风格仍会叠加在此之后；这里只放跨风格的硬规则。" en="Individual summary styles will still be appended after this; place cross-style hard rules here only." /></small>
            </div>

            <label>
              <input type="checkbox" name="exaEnabled" value="true" defaultChecked={Boolean(s?.exaEnabled)} /> <I18nText zh="启用 Exa 作为研究信息源（需配 API Key）" en="Enable Exa as Research Source (Requires API Key)" />
            </label>
            <div className="field">
              <label htmlFor="exaApiKey"><I18nText zh="Exa API Key（留空不修改）" en="Exa API Key (Leave blank to keep unchanged)" /></label>
              <input id="exaApiKey" name="exaApiKey" type="password" placeholder={s?.exaApiKeyEnc ? "已配置（输入新值覆盖）" : ""} />
            </div>
          </div>

          {/* ----- TAB 3: STORAGE (Form Fields) ----- */}
          <div style={{ display: activeTab === "storage" ? "block" : "none" }}>
            <h2 style={{ marginTop: 0 }}><I18nText zh="存储清理策略" en="Storage Cleanup Rules" /></h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor="maxStorageMb"><I18nText zh="最大可用空间（MB）" en="Max Available Space (MB)" /></label>
                <input
                  id="maxStorageMb"
                  name="maxStorageMb"
                  type="number"
                  min={64}
                  max={102400}
                  defaultValue={Number(s?.maxStorageMb ?? 2048)}
                />
              </div>
              <div className="field">
                <label htmlFor="cleanupAfterDays"><I18nText zh="超过多少天后清理（默认 30）" en="Cleanup after days (default 30)" /></label>
                <input
                  id="cleanupAfterDays"
                  name="cleanupAfterDays"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={Number(s?.cleanupAfterDays ?? 30)}
                />
                <small className="muted"><I18nText zh="常用：3 / 7 / 30 / 90，或勾选下方自定义。" en="Common: 3 / 7 / 30 / 90, or check custom below." /></small>
              </div>
            </div>
            <label>
              <input type="checkbox" name="cleanupCustomEnabled" value="true" defaultChecked={Boolean(s?.cleanupCustomEnabled)} /> <I18nText zh="启用自定义按天清理（超出空间时自动归档旧文章）" en="Enable custom days cleanup (auto-archive old posts when out of space)" />
            </label>
          </div>

          <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
            <button className="button" type="submit"><I18nText zh="保存上述设置" en="Save Settings" /></button>
          </div>
        </form>

        {/* ----- TAB 3: STORAGE (Current Display & Cleanup Button) ----- */}
        <div style={{ display: activeTab === "storage" ? "block" : "none" }}>
          {storage && (
            <section className="admin-panel" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}><I18nText zh="当前存储占用" en="Current Storage Usage" /></h2>
              <div className="admin-grid-3" style={{ marginTop: 10 }}>
                <Stat label={<I18nText zh="上传目录总和" en="Uploads Total" />} value={String(storage.uploadsBytes)} />
                <Stat label={<I18nText zh="音乐占用" en="Music Usage" />} value={String(storage.musicBytes)} />
                <Stat label={<I18nText zh="视频占用" en="Video Usage" />} value={String(storage.videoBytes)} />
                <Stat label={<I18nText zh="文章数量" en="Post Count" />} value={String(storage.postCount)} />
                <Stat label={<I18nText zh="原始素材" en="Raw Items" />} value={String(storage.rawItemCount)} />
                <Stat label={<I18nText zh="任务数量" en="Fetch Jobs" />} value={String(storage.fetchJobCount)} />
                <Stat label={<I18nText zh="DB 估算（粗）" en="DB Estimate (Rough)" />} value={String(storage.approxDbBytesEstimate)} />
                <Stat label={<I18nText zh="空间上限" en="Space Limit" />} value={`${storage.maxStorageMb} MB`} />
                <Stat label={<I18nText zh="清理阈值" en="Cleanup Threshold" />} value={`> ${storage.cleanupAfterDays} days`} />
              </div>
              <form action="/api/admin/storage/cleanup" method="post" style={{ marginTop: 14 }}>
                <button className="button secondary" type="submit"><I18nText zh="立即按当前规则清理" en="Clean Up Now (Current Rules)" /></button>
                <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                  <I18nText zh="过期 FetchJob/RawItem 会被删除；超额时旧文章自动归档（不删除内容），归档文章的本地视频文件会被回收。" en="Expired FetchJobs/RawItems will be deleted; older posts will auto-archive when space is exceeded (content kept, local video files reclaimed)." />
                </p>
              </form>
            </section>
          )}
        </div>
      </div>

      {/* ----- TAB 4: ACCOUNT & MODELS ----- */}
      <div style={{ display: activeTab === "account" ? "block" : "none" }}>
        <div style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          
          {/* Account Form */}
          <form className="form-card form-stack" action="/api/admin/settings/admin" method="post" style={{ alignSelf: "start" }}>
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

          {/* Model Configs Form */}
          <form className="form-card form-stack" action="/api/admin/model-configs" method="post" style={{ alignSelf: "start" }}>
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增模型配置" en="New Model Configuration" /></h2>
            <div className="field">
              <label htmlFor="provider"><I18nText zh="模型服务商预设" en="Model Provider Preset" /></label>
              <select id="provider" name="provider" defaultValue="canopywave">
                {MODEL_PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.label} · {preset.model}</option>
                ))}
              </select>
              <small className="muted"><I18nText zh="预置主流 OpenAI-compatible 服务商；选择后按需要修改 Base URL 和 Model。" en="Preset mainstream OpenAI-compatible providers; modify Base URL and Model as needed after selection." /></small>
            </div>
            <div className="field">
              <label htmlFor="modelName"><I18nText zh="配置名称" en="Config Name" /></label>
              <input id="modelName" name="name" required placeholder="例如：CanopyWave Kimi / DeepSeek / OpenAI" />
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
                <input id="maxTokens" name="maxTokens" type="number" defaultValue="1600" />
              </div>
            </div>
            <label><input type="checkbox" name="stream" value="true" /> <I18nText zh="启用流式生成" en="Enable Streaming" /></label>
            <label><input type="checkbox" name="isDefault" value="true" defaultChecked /> <I18nText zh="设为默认模型" en="Set as Default Model" /></label>
            <button className="button" type="submit"><I18nText zh="保存模型配置" en="Save Model Configuration" /></button>
          </form>

          {/* Summary Styles Form */}
          <form className="form-card form-stack" action="/api/admin/summary-styles" method="post" style={{ alignSelf: "start" }}>
            <h2 style={{ marginTop: 0 }}><I18nText zh="新增总结风格 / 提示词" en="New Summary Style / Prompt" /></h2>
            <div className="field">
              <label htmlFor="styleName"><I18nText zh="名称" en="Name" /></label>
              <input id="styleName" name="name" required placeholder="例如：深度分析" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="tone"><I18nText zh="输出风格" en="Output Tone" /></label>
                <select id="tone" name="tone" defaultValue="客观新闻">
                  <option>客观新闻</option>
                  <option>简洁 bullet</option>
                  <option>深度分析</option>
                  <option>个人评论</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="length"><I18nText zh="总结长度" en="Summary Length" /></label>
                <select id="length" name="length" defaultValue="中">
                  <option>短</option>
                  <option>中</option>
                  <option>长</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="focus"><I18nText zh="关注重点" en="Focus" /></label>
              <input id="focus" name="focus" defaultValue="事实, 影响, 争议, 技术细节, 商业价值" />
            </div>
            <div className="field">
              <label htmlFor="outputStructure"><I18nText zh="输出结构" en="Output Structure" /></label>
              <input id="outputStructure" name="outputStructure" defaultValue="标题, 摘要, 关键点, 背景, 来源, 相关视频" />
            </div>
            <div className="field">
              <label htmlFor="promptTemplate"><I18nText zh="自定义提示词模板" en="Custom Prompt Template" /></label>
              <textarea id="promptTemplate" name="promptTemplate" defaultValue="请将输入材料整理为中文新闻总结。保持事实清晰，不编造未出现的信息。输出 Markdown。" />
            </div>
            <label><input type="checkbox" name="isDefault" value="true" /> <I18nText zh="设为默认风格" en="Set as Default Style" /></label>
            <button className="button" type="submit"><I18nText zh="保存总结风格" en="Save Summary Style" /></button>
          </form>

        </div>

        {/* Existing Data Lists for Account/Models tab */}
        <section className="admin-panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="已有模型配置" en="Existing Model Configs" /></h2>
          <div className="table-list">
            {modelConfigs.map((config) => (
              <div className="table-item" key={config.id}>
                <div>
                  <strong>{config.name}</strong>
                  <div className="muted">{providerLabel((config as { provider?: string }).provider)} · {config.baseUrl} · {config.model}</div>
                </div>
                <span className="tag">{config.isDefault ? <I18nText zh="默认" en="Default" /> : <I18nText zh="备用" en="Backup" />}</span>
              </div>
            ))}
            {modelConfigs.length === 0 && <p className="muted"><I18nText zh="暂无配置。" en="No configurations." /></p>}
          </div>
        </section>

        <section className="admin-panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="已有总结风格" en="Existing Summary Styles" /></h2>
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
            {styles.length === 0 && <p className="muted"><I18nText zh="暂无风格。" en="No styles." /></p>}
          </div>
        </section>

      </div>
    </>
  );
}