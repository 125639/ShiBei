"use client";

import { useMemo, useRef, useState } from "react";
import type { ModelConfig } from "@prisma/client";
import { ConfirmButton } from "@/components/ConfirmButton";
import { I18nText } from "@/components/I18nText";
import { SubmitButton } from "@/components/SubmitButton";
import { canReuseSavedModelKey } from "@/lib/model-config-input";
import { MODEL_PROVIDER_PRESETS, providerLabel } from "@/lib/model-providers";

export type ModelConfigManagerItem = Pick<
  ModelConfig,
  "id" | "provider" | "name" | "baseUrl" | "model" | "temperature" | "maxTokens" | "isDefault"
> & { isEnabled?: boolean };

type ProbeAction = "check" | "models";
type ProbeState = {
  kind: "idle" | "loading" | "success" | "error";
  message: string;
  action?: ProbeAction;
};

export type ModelRoleKey =
  | "contentModelConfigId"
  | "assistantModelConfigId"
  | "writingModelConfigId"
  | "translationModelConfigId";

export type ModelRoleAssignments = Record<ModelRoleKey, string>;

const MODEL_ROLES: Array<{
  key: ModelRoleKey;
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
  critical?: boolean;
}> = [
  {
    key: "contentModelConfigId",
    zh: "研究与文章生成",
    en: "Research & publishing",
    descriptionZh: "负责资料整理、正文撰写、事实复核和发布前检查。",
    descriptionEn: "Research, drafting, fact review, and the publication gate.",
    critical: true
  },
  {
    key: "assistantModelConfigId",
    zh: "站内 AI 助手",
    en: "Site assistant",
    descriptionZh: "回答读者在站内提出的问题。",
    descriptionEn: "Answers questions from readers on the site."
  },
  {
    key: "writingModelConfigId",
    zh: "用户写作辅助",
    en: "Writing assistant",
    descriptionZh: "用于写作空间的续写、改写和结构建议。",
    descriptionEn: "Drafting, rewriting, and structure help in the writing studio."
  },
  {
    key: "translationModelConfigId",
    zh: "英文翻译",
    en: "English translation",
    descriptionZh: "生成文章英文版本；可以使用成本更低的模型。",
    descriptionEn: "Creates English versions; a lower-cost model is usually sufficient. If unset, it follows the site assistant, then the default."
  }
];

const EMPTY_PROBE: ProbeState = { kind: "idle", message: "" };

const MODEL_STATUS_MESSAGES: Record<string, { zh: string; en: string }> = {
  created: { zh: "模型配置已保存。", en: "Model configuration saved." },
  updated: { zh: "模型配置已更新。", en: "Model configuration updated." },
  deleted: { zh: "模型配置已删除，相关任务已安全切换到可用的替代配置。", en: "Model removed; related tasks were safely reassigned when a replacement was available." }
};

const MODEL_ERROR_MESSAGES: Record<string, { zh: string; en: string }> = {
  invalid_name: { zh: "配置名称无效，请填写 1–80 个字符。", en: "Enter a configuration name between 1 and 80 characters." },
  invalid_base_url: { zh: "Base URL 无效，请填写完整的 HTTPS 地址。", en: "Enter a complete HTTPS Base URL." },
  unsafe_base_url: { zh: "Base URL 含凭据、查询参数或指向内网/保留地址，已拒绝保存。", en: "The Base URL contains credentials/query parameters or targets a private/reserved address." },
  invalid_model: { zh: "模型 ID 无效：不能为空、不能含空格，最长 200 个字符。", en: "Model ID must be non-empty, contain no spaces, and be at most 200 characters." },
  invalid_api_key: { zh: "API Key 无效，请重新填写。", en: "Enter a valid API key." },
  api_key_required_for_endpoint_change: {
    zh: "Base URL 已改变，请填写新地址对应的 API Key；系统不会把旧 Key 转发给新服务。",
    en: "The Base URL changed. Enter the key for the new endpoint; the old key is never forwarded to it."
  },
  invalid_temperature: { zh: "Temperature 必须在 0–2 之间。", en: "Temperature must be between 0 and 2." },
  invalid_max_tokens: { zh: "Max Tokens 必须是 1–200000 的整数。", en: "Max Tokens must be an integer from 1 to 200000." },
  invalid_assignment: { zh: "任务分工中包含已删除的模型，请刷新页面后重新选择。", en: "Task routing references a removed model. Refresh and choose again." },
  not_found: { zh: "模型配置不存在，可能已被删除；请刷新后重试。", en: "The model configuration no longer exists. Refresh and try again." },
  delete_failed: { zh: "删除失败，配置未被改动，请稍后重试。", en: "Delete failed and no configuration was changed. Try again." },
  save_failed: { zh: "保存失败，原配置未被改动，请稍后重试。", en: "Save failed and the existing configuration was not changed. Try again." }
};

export function ModelConfigManager({
  configs,
  assignments = {
    contentModelConfigId: "",
    assistantModelConfigId: "",
    writingModelConfigId: "",
    translationModelConfigId: ""
  },
  status,
  error
}: {
  configs: ModelConfigManagerItem[];
  assignments?: ModelRoleAssignments;
  status?: string;
  error?: string;
}) {
  const statusMessage = status ? MODEL_STATUS_MESSAGES[status] : undefined;
  const errorMessage = error ? (MODEL_ERROR_MESSAGES[error] || MODEL_ERROR_MESSAGES.save_failed) : undefined;
  const enabledConfigs = configs.filter((config) => config.isEnabled !== false);
  const defaultConfig = enabledConfigs.find((config) => config.isDefault) || enabledConfigs[0];

  return (
    <div className="model-config-manager">
      {statusMessage ? (
        <div className="model-config-notice success" role="status">
          <I18nText zh={statusMessage.zh} en={statusMessage.en} />
        </div>
      ) : null}
      {errorMessage ? (
        <div className="form-error" role="alert">
          <I18nText zh={errorMessage.zh} en={errorMessage.en} />
        </div>
      ) : null}

      <section className="model-config-hero" aria-labelledby="model-config-title">
        <div>
          <p className="eyebrow"><I18nText zh="AI 基础设施" en="AI infrastructure" /></p>
          <h2 id="model-config-title"><I18nText zh="模型连接与任务分工" en="Model connections and task routing" /></h2>
          <p className="muted model-config-intro">
            <I18nText
              zh="先连接模型服务，再为不同任务指定模型。连接凭据、任务用途和高级生成参数分开管理，避免改错。"
              en="Connect a provider first, then route each task. Credentials, task roles, and advanced generation settings stay separate."
            />
          </p>
        </div>
        <div className="model-config-health" aria-label="模型配置摘要">
          <div><strong>{enabledConfigs.length} / {configs.length}</strong><span><I18nText zh="个启用 / 已保存" en="enabled / saved" /></span></div>
          <div>
            <strong>{defaultConfig ? defaultConfig.name : "—"}</strong>
            <span><I18nText zh="当前默认" en="current default" /></span>
          </div>
        </div>
      </section>

      <ModelRoutingPanel configs={enabledConfigs} assignments={assignments} defaultConfig={defaultConfig} />

      <section className="admin-panel model-config-library" aria-labelledby="saved-models-title">
        <div className="model-config-section-heading">
          <div>
            <p className="model-config-step-kicker"><I18nText zh="连接管理" en="Connections" /></p>
            <h2 id="saved-models-title"><I18nText zh="模型服务" en="Model services" /></h2>
            <p className="muted model-config-intro">
              <I18nText
                zh="平时只显示关键信息；需要修改地址、Key 或生成参数时，再展开对应配置。"
                en="Only essential details stay visible. Expand a connection when you need to change its URL, key, or generation settings."
              />
            </p>
          </div>
          <span className="tag">{configs.length} <I18nText zh="个连接" en="connections" /></span>
        </div>

        <details className="model-config-add" open={configs.length === 0}>
          <summary>
            <span className="model-config-summary-icon" aria-hidden="true">＋</span>
            <span>
              <strong><I18nText zh="添加模型连接" en="Add a model connection" /></strong>
              <small><I18nText zh="选择供应商，填写 Key，获取模型并检查连接" en="Choose a provider, add a key, fetch a model, and test it" /></small>
            </span>
          </summary>
          <NewModelConfigForm defaultToPrimary={enabledConfigs.length === 0} />
        </details>

        <div className="model-config-list">
          {configs.map((config) => (
            <ExistingModelConfigForm config={config} assignments={assignments} key={config.id} />
          ))}
          {configs.length === 0 ? (
            <div className="model-config-empty">
              <strong><I18nText zh="还没有可用连接" en="No connection yet" /></strong>
              <p className="muted"><I18nText zh="完成上方三步后，模型才会出现在任务分工中。" en="Complete the steps above before assigning a model to a task." /></p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ModelRoutingPanel({
  configs,
  assignments,
  defaultConfig
}: {
  configs: ModelConfigManagerItem[];
  assignments: ModelRoleAssignments;
  defaultConfig?: ModelConfigManagerItem;
}) {
  return (
    <form className="admin-panel model-routing-panel" action="/api/admin/settings/model-routing" method="post">
      <div className="model-config-section-heading">
        <div>
          <p className="model-config-step-kicker"><I18nText zh="任务分工" en="Task routing" /></p>
          <h2><I18nText zh="每项功能由哪个模型负责" en="Choose a model for each task" /></h2>
          <p className="muted model-config-intro">
            <I18nText
              zh="留空时，大多数任务跟随默认模型；英文翻译会先跟随站内 AI 助手，再回退到默认模型。只有确有需要时再单独指定。"
              en="When unset, most tasks follow the default model. Translation follows the site assistant first, then falls back to the default. Override only when needed."
            />
          </p>
        </div>
        <span className={`tag ${configs.length ? "" : "muted"}`}>
          {configs.length ? <I18nText zh="可配置" en="Ready" /> : <I18nText zh="等待连接" en="Needs a connection" />}
        </span>
      </div>

      <div className="model-routing-grid">
        {MODEL_ROLES.map((role) => (
          <label className="model-routing-card" key={role.key} htmlFor={`routing-${role.key}`}>
            <span className="model-routing-title">
              <strong><I18nText zh={role.zh} en={role.en} /></strong>
              {role.critical ? <span className="tag"><I18nText zh="核心" en="Core" /></span> : null}
            </span>
            <small className="muted"><I18nText zh={role.descriptionZh} en={role.descriptionEn} /></small>
            <select
              id={`routing-${role.key}`}
              name={role.key}
              defaultValue={assignments[role.key] || ""}
              disabled={configs.length === 0}
            >
              <option value="">
                {role.key === "translationModelConfigId"
                  ? defaultConfig
                    ? `跟随站内助手，再回退默认 / Assistant, then default · ${defaultConfig.name}`
                    : "请先添加模型连接 / Add a connection first"
                  : defaultConfig
                    ? `跟随默认 / Default · ${defaultConfig.name} · ${defaultConfig.model}`
                    : "请先添加模型连接 / Add a connection first"}
              </option>
              {configs.map((config) => (
                <option key={config.id} value={config.id}>{config.name} · {config.model}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="model-routing-actions">
        <p className="muted"><I18nText zh="保存任务分工不会修改模型地址、API Key 或生成参数。" en="Saving task routing never changes connection URLs, API keys, or generation settings." /></p>
        <SubmitButton disabled={configs.length === 0} pendingLabel={<I18nText zh="保存中…" en="Saving…" />}>
          <I18nText zh="保存任务分工" en="Save task routing" />
        </SubmitButton>
      </div>
    </form>
  );
}

function NewModelConfigForm({ defaultToPrimary }: { defaultToPrimary: boolean }) {
  const [provider, setProvider] = useState("custom");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [probe, setProbe] = useState<ProbeState>(EMPTY_PROBE);
  const [connectionEnabled, setConnectionEnabled] = useState(true);
  const probeRevision = useRef(0);
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === provider) || MODEL_PROVIDER_PRESETS[0];

  function applyProvider(nextProvider: string) {
    const next = MODEL_PROVIDER_PRESETS.find((item) => item.key === nextProvider) || MODEL_PROVIDER_PRESETS[0];
    if (apiKey && !canReuseSavedModelKey(baseUrl, next.baseUrl)) setApiKey("");
    probeRevision.current += 1;
    setProvider(next.key);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setModelOptions([]);
    setProbe(EMPTY_PROBE);
    if (!name.trim() || MODEL_PROVIDER_PRESETS.some((item) => item.label === name.trim())) setName(next.key === "custom" ? "" : next.label);
  }

  async function probeProvider(action: ProbeAction) {
    if (!baseUrl.trim() || !apiKey.trim() || (action === "check" && !model.trim())) {
      setProbe({ kind: "error", message: action === "check" ? "请先填写 Base URL、API Key 和模型 ID。" : "请先填写 Base URL 和 API Key。" });
      return;
    }
    const revision = ++probeRevision.current;
    const result = await runProbe(
      { action, baseUrl, model, apiKey },
      (state) => {
        if (probeRevision.current === revision) setProbe(state);
      }
    );
    if (probeRevision.current !== revision) return;
    if (result.models) {
      setModelOptions(result.models);
      if (!model.trim() && result.models[0]) setModel(result.models[0]);
    }
  }

  function updateBaseUrl(value: string) {
    if (apiKey && !canReuseSavedModelKey(baseUrl, value)) setApiKey("");
    probeRevision.current += 1;
    setBaseUrl(value);
    setModelOptions([]);
    setProbe(EMPTY_PROBE);
  }

  function updateApiKey(value: string) {
    probeRevision.current += 1;
    setApiKey(value);
    setModelOptions([]);
    setProbe(EMPTY_PROBE);
  }

  function updateModel(value: string) {
    probeRevision.current += 1;
    setModel(value);
    setProbe(EMPTY_PROBE);
  }

  return (
    <form className="form-stack model-config-create" action="/api/admin/model-configs" method="post">
      <fieldset className="model-config-step">
        <legend><span className="model-config-step-number">1</span><I18nText zh="选择服务" en="Choose a provider" /></legend>
        <div className="field-row">
        <div className="field">
          <label htmlFor="provider"><I18nText zh="供应商" en="Provider" /></label>
          <select id="provider" name="provider" value={provider} aria-describedby="api-type-help" onChange={(event) => applyProvider(event.target.value)}>
            {MODEL_PROVIDER_PRESETS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="modelName"><I18nText zh="后台名称" en="Display name" /></label>
          <input
            id="modelName"
            name="name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：DeepSeek 主力写作"
            autoComplete="off"
          />
          <small className="muted"><I18nText zh="只用于后台辨认。" en="Only used in admin." /></small>
        </div>
        </div>
        <small id="api-type-help" className="muted model-provider-note">OpenAI Compatible · Chat Completions · {preset.note}</small>
      </fieldset>

      <fieldset className="model-config-step">
        <legend><span className="model-config-step-number">2</span><I18nText zh="连接供应商" en="Connect the provider" /></legend>
        <BaseUrlField id="baseUrl" value={baseUrl} onChange={updateBaseUrl} />
        <SecretField id="apiKey" value={apiKey} onChange={updateApiKey} show={showKey} onToggle={() => setShowKey((value) => !value)} required />
      </fieldset>

      <fieldset className="model-config-step">
        <legend><span className="model-config-step-number">3</span><I18nText zh="选择并验证模型" en="Select and verify a model" /></legend>
        <ModelIdField id="model" value={model} onChange={updateModel} options={modelOptions} />
        <ProbeControls state={probe} onProbe={probeProvider} />
      </fieldset>

      <input type="hidden" name="_enabledPresented" value="true" />
      <label className="model-config-active-switch">
        <input
          type="checkbox"
          name="isEnabled"
          value="true"
          checked={connectionEnabled}
          onChange={(event) => setConnectionEnabled(event.target.checked)}
        />{" "}
        <I18nText zh="启用这个连接并纳入任务路由" en="Enable this connection for task routing" />
      </label>
      <AdvancedGenerationFields
        prefix="new"
        temperature={0.3}
        maxTokens={8000}
        isDefault={defaultToPrimary}
        connectionEnabled={connectionEnabled}
      />

      <div className="model-config-save-row">
        <p className="muted"><I18nText zh="建议看到“模型可以响应”后再保存。" en="We recommend saving after the model check succeeds." /></p>
        <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存这个模型" en="Save this model" /></SubmitButton>
      </div>
    </form>
  );
}

function ExistingModelConfigForm({
  config,
  assignments
}: {
  config: ModelConfigManagerItem;
  assignments: ModelRoleAssignments;
}) {
  const knownProvider = MODEL_PROVIDER_PRESETS.some((item) => item.key === config.provider) ? config.provider : "custom";
  const [provider, setProvider] = useState(knownProvider);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [probe, setProbe] = useState<ProbeState>(EMPTY_PROBE);
  const [connectionEnabled, setConnectionEnabled] = useState(config.isEnabled !== false);
  const probeRevision = useRef(0);
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === provider) || MODEL_PROVIDER_PRESETS[0];
  const endpointChanged = !canReuseSavedModelKey(config.baseUrl, baseUrl);

  function applyProvider(nextProvider: string) {
    const next = MODEL_PROVIDER_PRESETS.find((item) => item.key === nextProvider) || MODEL_PROVIDER_PRESETS[0];
    const nextBaseUrl = next.key === "custom" ? baseUrl : next.baseUrl;
    if (apiKey && !canReuseSavedModelKey(baseUrl, nextBaseUrl)) setApiKey("");
    probeRevision.current += 1;
    setProvider(next.key);
    if (next.key !== "custom") {
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setModelOptions([]);
    }
    setProbe(EMPTY_PROBE);
  }

  async function probeProvider(action: ProbeAction) {
    if (!baseUrl.trim() || (action === "check" && !model.trim())) {
      setProbe({ kind: "error", message: action === "check" ? "请先填写 Base URL 和模型 ID。" : "请先填写 Base URL。" });
      return;
    }
    const revision = ++probeRevision.current;
    const result = await runProbe(
      { action, configId: config.id, baseUrl, model, apiKey },
      (state) => {
        if (probeRevision.current === revision) setProbe(state);
      }
    );
    if (probeRevision.current !== revision) return;
    if (result.models) setModelOptions(result.models);
  }

  function updateBaseUrl(value: string) {
    if (apiKey && !canReuseSavedModelKey(baseUrl, value)) setApiKey("");
    probeRevision.current += 1;
    setBaseUrl(value);
    setModelOptions([]);
    setProbe(EMPTY_PROBE);
  }

  function updateApiKey(value: string) {
    probeRevision.current += 1;
    setApiKey(value);
    setModelOptions([]);
    setProbe(EMPTY_PROBE);
  }

  function updateModel(value: string) {
    probeRevision.current += 1;
    setModel(value);
    setProbe(EMPTY_PROBE);
  }

  const assignedRoles = MODEL_ROLES.filter((role) => assignments[role.key] === config.id);
  const followsDefault = config.isDefault && MODEL_ROLES.some((role) => !assignments[role.key]);

  return (
    <details className="model-config-row">
      <summary className="model-config-card-heading">
        <span className="model-config-identity">
          <strong>{config.name}</strong>
          <span className="muted model-config-summary">{providerLabel(config.provider)} · {config.model}</span>
        </span>
        <span className="model-config-usage" aria-label="模型用途">
          {config.isDefault ? <span className="tag"><I18nText zh="默认" en="Default" /></span> : null}
          {config.isEnabled === false ? <span className="tag muted"><I18nText zh="已停用" en="Disabled" /></span> : null}
          {assignedRoles.map((role) => <span className="tag" key={role.key}><I18nText zh={role.zh} en={role.en} /></span>)}
          {followsDefault ? <span className="tag"><I18nText zh="承接默认任务" en="Handles default tasks" /></span> : null}
          <span className="model-config-edit-label"><I18nText zh="展开管理" en="Manage" /></span>
        </span>
      </summary>
      <form className="model-config-form" action={`/api/admin/model-configs/${config.id}`} method="post">
        <div className="field-row">
          <div className="field">
            <label htmlFor={`model-name-${config.id}`}><I18nText zh="配置名称" en="Name" /></label>
            <input id={`model-name-${config.id}`} name="name" defaultValue={config.name} required maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor={`provider-${config.id}`}><I18nText zh="供应商" en="Provider" /></label>
            <select id={`provider-${config.id}`} name="provider" value={provider} onChange={(event) => applyProvider(event.target.value)}>
              {MODEL_PROVIDER_PRESETS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </div>
        </div>
        <small className="muted model-provider-note">API: OpenAI Compatible · Chat Completions · {preset.note}</small>

        <BaseUrlField id={`base-url-${config.id}`} value={baseUrl} onChange={updateBaseUrl} />
        <SecretField
          id={`api-key-${config.id}`}
          value={apiKey}
          onChange={updateApiKey}
          show={showKey}
          onToggle={() => setShowKey((value) => !value)}
          required={endpointChanged}
          endpointChanged={endpointChanged}
        />
        <ModelIdField id={`model-id-${config.id}`} value={model} onChange={updateModel} options={modelOptions} />
        <ProbeControls state={probe} onProbe={probeProvider} />

        <input type="hidden" name="_enabledPresented" value="true" />
        <label className="model-config-active-switch">
          <input
            type="checkbox"
            name="isEnabled"
            value="true"
            checked={connectionEnabled}
            onChange={(event) => setConnectionEnabled(event.target.checked)}
          />{" "}
          <I18nText
            zh="启用这个连接并纳入任务路由（停用会保留地址与密钥）"
            en="Enable for task routing (disabling preserves the URL and key)"
          />
        </label>

        <AdvancedGenerationFields
          prefix={config.id}
          temperature={config.temperature}
          maxTokens={config.maxTokens}
          isDefault={config.isDefault}
          connectionEnabled={connectionEnabled}
        />
        <div className="model-config-actions">
          <SubmitButton className="button secondary" pendingLabel={<I18nText zh="更新中…" en="Updating…" />} name="_intent" value="update">
            <I18nText zh="保存更改" en="Save Changes" />
          </SubmitButton>
          <ConfirmButton
            name="_intent"
            value="delete"
            formNoValidate
            message={config.isDefault
              ? "确定删除这个默认模型？系统会把任务绑定切换到可用的替代模型；如果这是最后一个配置，AI 功能将暂停，直到添加新模型。"
              : "确定删除这个模型配置？相关任务会自动切换到可用的替代模型。"}
          >
            <I18nText zh="删除配置" en="Delete" />
          </ConfirmButton>
        </div>
      </form>
    </details>
  );
}

function AdvancedGenerationFields({
  prefix,
  temperature,
  maxTokens,
  isDefault,
  connectionEnabled
}: {
  prefix: string;
  temperature: number;
  maxTokens: number;
  isDefault: boolean;
  connectionEnabled: boolean;
}) {
  return (
    <details className="model-config-advanced">
      <summary>
        <span><I18nText zh="高级生成参数" en="Advanced generation settings" /></span>
        <small className="muted">Temperature {temperature} · Max Tokens {maxTokens}</small>
      </summary>
      <div className="model-config-advanced-fields">
        <div className="field-row">
          <div className="field">
            <label htmlFor={`temperature-${prefix}`}>Temperature</label>
            <input id={`temperature-${prefix}`} name="temperature" type="number" inputMode="decimal" step="0.1" min="0" max="2" defaultValue={temperature} required />
            <small className="muted"><I18nText zh="越低越稳定。事实型文章建议 0.1–0.4。" en="Lower is more consistent; 0.1–0.4 works well for factual writing." /></small>
          </div>
          <div className="field">
            <label htmlFor={`max-tokens-${prefix}`}>Max Tokens</label>
            <input id={`max-tokens-${prefix}`} name="maxTokens" type="number" inputMode="numeric" min="1" max="200000" defaultValue={maxTokens} required />
            <small className="muted"><I18nText zh="供应商允许的单次最大输出；过小会截断文章。" en="Maximum provider output; values that are too small can truncate articles." /></small>
          </div>
        </div>
        <div className="model-config-switches">
          <label>
            <input type="checkbox" name="isDefault" value="true" defaultChecked={isDefault} disabled={!connectionEnabled} />{" "}
            <I18nText zh="设为默认模型" en="Set as default" />
          </label>
        </div>
      </div>
    </details>
  );
}

function BaseUrlField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const endpoint = useMemo(() => {
    const base = value.trim().replace(/\/+$/, "").replace(/\/(?:chat\/completions|models)$/i, "");
    return base ? `${base}/chat/completions` : "";
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id}>Base URL / API Host</label>
      <input
        id={id}
        name="baseUrl"
        type="url"
        required
        pattern="https://.+"
        maxLength={2048}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://api.example.com/v1"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <small className="muted">
        <I18nText zh="可粘贴 Host、/v1 或完整 /chat/completions 地址，保存时会自动规范化。为保护 API Key，仅允许公网 HTTPS。" en="Paste a host, /v1 base, or full /chat/completions URL; it is normalized on save. Public HTTPS only, so API keys are never sent in plaintext." />
      </small>
      {endpoint ? <code className="model-endpoint-preview">POST {endpoint}</code> : null}
    </div>
  );
}

function SecretField({
  id,
  value,
  onChange,
  show,
  onToggle,
  required,
  endpointChanged = false
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  required: boolean;
  endpointChanged?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{required ? "API Key" : <I18nText zh="API Key（留空保留现有 Key）" en="API Key (leave blank to keep current)" />}</label>
      <div className="model-secret-field">
        <input
          id={id}
          name="apiKey"
          type={show ? "text" : "password"}
          required={required}
          maxLength={4096}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={required ? "sk-…" : "已加密保存；输入新值才会替换"}
        />
        <button type="button" className="button ghost model-key-toggle" onClick={onToggle} aria-controls={id} aria-pressed={show}>
          {show ? <I18nText zh="隐藏" en="Hide" /> : <I18nText zh="显示" en="Show" />}
        </button>
      </div>
      {endpointChanged ? (
        <small className="form-error" role="status"><I18nText zh="地址已改变，请重新填写新地址对应的 Key；旧 Key 不会发送给新服务。" en="The endpoint changed. Enter its key; the saved key will never be sent to the new service." /></small>
      ) : (
        <small className="muted"><I18nText zh="Key 不会回显、不会写入浏览器本地存储，也不会出现在连接检查结果中。" en="Keys are never echoed, stored in browser storage, or included in check results." /></small>
      )}
    </div>
  );
}

export function ModelIdField({ id, value, onChange, options }: { id: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const datalistId = `${id}-options`;
  const uniqueOptions = Array.from(new Set(options.filter(Boolean)));
  return (
    <div className={`model-id-picker ${uniqueOptions.length ? "has-options" : ""}`}>
      {uniqueOptions.length ? (
        <div className="field model-discovered-models">
          <label htmlFor={`${id}-select`}>
            <I18nText zh={`供应商返回的模型（${uniqueOptions.length} 个）`} en={`Models returned by provider (${uniqueOptions.length})`} />
          </label>
          <select
            id={`${id}-select`}
            value={uniqueOptions.includes(value) ? value : ""}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
          >
            <option value="">选择一个模型… / Select a model…</option>
            {uniqueOptions.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
          <small className="muted"><I18nText zh="选择后会自动填入下方准确的模型 ID。" en="Selecting one fills the exact model ID below." /></small>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={id}><I18nText zh="模型 ID" en="Model ID" /></label>
        <input
          id={id}
          name="model"
          required
          maxLength={200}
          pattern={"\\S+"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          list={datalistId}
          placeholder="例如 deepseek-chat"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <datalist id={datalistId}>{uniqueOptions.map((item) => <option value={item} key={item} />)}</datalist>
        <small className="muted"><I18nText zh="必须与供应商的模型 ID 完全一致，不能包含空格；列表不可用时也可手填。" en="Must exactly match the provider model ID with no spaces; manual entry remains available." /></small>
      </div>
    </div>
  );
}

function ProbeControls({ state, onProbe }: { state: ProbeState; onProbe: (action: ProbeAction) => void }) {
  const busy = state.kind === "loading";
  return (
    <div className="model-probe-block">
      <div className="model-probe-actions">
        <button type="button" className="button ghost" disabled={busy} onClick={() => onProbe("models")}>
          {busy && state.action === "models"
            ? <I18nText zh="正在获取…" en="Fetching…" />
            : <I18nText zh="获取模型列表" en="Fetch model list" />}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => onProbe("check")}>
          {busy && state.action === "check"
            ? <I18nText zh="检查中…" en="Checking…" />
            : <I18nText zh="轻量验证模型" en="Quick model check" />}
        </button>
      </div>
      <small className="muted">
        <I18nText
          zh="这里仅检查地址、Key、模型 ID 和 Chat Completions 返回结构；推理模型可能只显示“已识别”。文章质量请以正式内容基准和真实任务结果为准。"
          en="This checks the URL, key, model ID, and Chat Completions response shape. Reasoning models may only be reported as recognized; use the full content benchmark for quality."
        />
      </small>
      {state.kind !== "idle" ? (
        <div className={`model-probe-status ${state.kind}`} role={state.kind === "error" ? "alert" : "status"} aria-live="polite">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

async function runProbe(
  input: { action: ProbeAction; configId?: string; baseUrl: string; model: string; apiKey: string },
  setState: (state: ProbeState) => void
): Promise<{ models?: string[] }> {
  setState({ kind: "loading", action: input.action, message: input.action === "models" ? "正在连接供应商并读取模型列表…" : "正在验证 API Key、地址和模型 ID…" });
  try {
    const response = await fetch("/api/admin/model-configs/test", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input)
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string; models?: string[] } | null;
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "连接检查失败，请重新登录或稍后再试。");
    setState({ kind: "success", action: input.action, message: payload.message || "连接成功。" });
    return { models: Array.isArray(payload.models) ? payload.models : undefined };
  } catch (error) {
    setState({ kind: "error", action: input.action, message: error instanceof Error ? error.message : "连接检查失败。" });
    return {};
  }
}
