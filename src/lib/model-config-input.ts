import { MODEL_PROVIDER_PRESETS } from "./model-providers";

export const MODEL_CONFIG_LIMITS = {
  name: 80,
  baseUrl: 2048,
  model: 200,
  apiKey: 4096,
  maxTokens: 200_000
} as const;

export type ModelConfigFormInput = {
  provider: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  isEnabled: boolean;
  isDefault: boolean;
};

export type SiteModelReferences = {
  contentModelConfigId?: string | null;
  assistantModelConfigId?: string | null;
  writingModelConfigId?: string | null;
  translationModelConfigId?: string | null;
};

export class ModelConfigValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly field?: keyof ModelConfigFormInput
  ) {
    super(code);
    this.name = "ModelConfigValidationError";
  }
}

/**
 * The runtime always appends /chat/completions. Admins commonly paste the full
 * endpoint copied from provider documentation, so accept it and store the
 * reusable API host/base instead of producing .../chat/completions/chat/completions.
 */
export function normalizeModelBaseUrl(rawValue: string): string {
  const raw = rawValue.trim();
  if (!raw || raw.length > MODEL_CONFIG_LIMITS.baseUrl) {
    throw new ModelConfigValidationError("invalid_base_url", "baseUrl");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelConfigValidationError("invalid_base_url", "baseUrl");
  }

  // Credentials must never cross the network in plaintext. This shared
  // normalizer runs in the browser, admin routes, probes, and model runtime,
  // so an HTTP endpoint cannot be saved in one path and used by another.
  if (url.protocol !== "https:" || !url.hostname) {
    throw new ModelConfigValidationError("invalid_base_url", "baseUrl");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ModelConfigValidationError("unsafe_base_url", "baseUrl");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  pathname = pathname.replace(/\/(?:chat\/completions|models)$/i, "");
  url.pathname = pathname || "/";

  // URL#toString adds a trailing slash for origins. The caller always appends
  // an API path, so a canonical no-trailing-slash value is easier to reason about.
  return url.toString().replace(/\/+$/, "");
}

export function modelApiUrl(baseUrl: string, path: "chat/completions" | "models") {
  return `${normalizeModelBaseUrl(baseUrl)}/${path}`;
}

/** A stored API key may only be reused for the exact canonical endpoint it was saved for. */
export function canReuseSavedModelKey(savedBaseUrl: string, requestedBaseUrl: string) {
  try {
    return normalizeModelBaseUrl(savedBaseUrl) === normalizeModelBaseUrl(requestedBaseUrl);
  } catch {
    return false;
  }
}

export function parseModelConfigForm(
  form: FormData,
  options: { requireApiKey: boolean }
): ModelConfigFormInput {
  const providerRaw = stringValue(form, "provider") || "custom";
  const provider = MODEL_PROVIDER_PRESETS.some((item) => item.key === providerRaw)
    ? providerRaw
    : "custom";
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === provider);

  const name = stringValue(form, "name");
  if (!name || name.length > MODEL_CONFIG_LIMITS.name || hasControlCharacters(name)) {
    throw new ModelConfigValidationError("invalid_name", "name");
  }

  const rawBaseUrl = stringValue(form, "baseUrl") || preset?.baseUrl || "";
  const baseUrl = normalizeModelBaseUrl(rawBaseUrl);

  const model = stringValue(form, "model") || preset?.model || "";
  if (
    !model ||
    model.length > MODEL_CONFIG_LIMITS.model ||
    /\s/.test(model) ||
    hasControlCharacters(model)
  ) {
    throw new ModelConfigValidationError("invalid_model", "model");
  }

  const apiKey = stringValue(form, "apiKey");
  if (
    (options.requireApiKey && !apiKey) ||
    apiKey.length > MODEL_CONFIG_LIMITS.apiKey ||
    hasControlCharacters(apiKey)
  ) {
    throw new ModelConfigValidationError("invalid_api_key", "apiKey");
  }

  const temperature = numberValue(form, "temperature", 0.3);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new ModelConfigValidationError("invalid_temperature", "temperature");
  }

  const maxTokens = numberValue(form, "maxTokens", 8000);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MODEL_CONFIG_LIMITS.maxTokens) {
    throw new ModelConfigValidationError("invalid_max_tokens", "maxTokens");
  }

  return {
    provider,
    name,
    baseUrl,
    model,
    apiKey,
    temperature,
    maxTokens,
    // `_enabledPresented` distinguishes the modern checkbox being deliberately
    // unchecked from older forms/API clients that predate this setting.
    isEnabled: form.get("_enabledPresented") === "true"
      ? form.get("isEnabled") === "true"
      : true,
    isDefault: form.get("isDefault") === "true"
  };
}

/** Build the SiteSettings patch used when a saved model is removed. */
export function replaceSiteModelReferences(
  site: SiteModelReferences | null,
  removedId: string,
  replacementId: string | null
): SiteModelReferences {
  if (!site) return {};
  const patch: SiteModelReferences = {};
  const fields = [
    "contentModelConfigId",
    "assistantModelConfigId",
    "writingModelConfigId",
    "translationModelConfigId"
  ] as const;
  for (const field of fields) {
    if (site[field] === removedId) patch[field] = replacementId;
  }
  return patch;
}

function stringValue(form: FormData, key: string) {
  return String(form.get(key) || "").trim();
}

function numberValue(form: FormData, key: string, fallback: number) {
  const raw = stringValue(form, key);
  return raw ? Number(raw) : fallback;
}

function hasControlCharacters(value: string) {
  // API keys and identifiers must remain single-line. This also avoids header
  // injection if a provider credential is ever reused in additional headers.
  return /[\u0000-\u001f\u007f]/.test(value);
}
