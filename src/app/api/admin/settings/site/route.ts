import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { isLanguageKey, isNewsLanguageMode } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { isFontKey, isThemeKey } from "@/lib/themes";
import { INTERNATIONAL_PLATFORM_KEYS } from "@/lib/video-policy";

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const settingsTab = normalizeSettingsTab(form.get("settingsTab"));

  const autoPublish = form.get("autoPublish") === "true";
  const textOnlyMode = form.get("textOnlyMode") === "true";
  const exaEnabled = form.get("exaEnabled") === "true";
  const videoDownloadDomestic = form.get("videoDownloadDomestic") === "true";
  const musicEnabledDefault = form.get("musicEnabledDefault") === "true";
  const cleanupCustomEnabled = form.get("cleanupCustomEnabled") === "true";

  const themeRaw = String(form.get("defaultTheme") || "minimal");
  const fontRaw = String(form.get("defaultFont") || "serif-cjk");
  const languageRaw = String(form.get("defaultLanguage") || "zh");
  const newsLanguageModeRaw = String(form.get("newsLanguageMode") || "default-language");
  const defaultSettingsUIRaw = String(form.get("defaultSettingsUI") || "classic");
  const defaultTheme = isThemeKey(themeRaw) ? themeRaw : "minimal";
  const defaultFont = isFontKey(fontRaw) ? fontRaw : "serif-cjk";
  const defaultLanguage = isLanguageKey(languageRaw) ? languageRaw : "zh";
  const newsLanguageMode = isNewsLanguageMode(newsLanguageModeRaw) ? newsLanguageModeRaw : "default-language";
  const defaultSettingsUI = ["classic", "cyber"].includes(defaultSettingsUIRaw) ? defaultSettingsUIRaw : "classic";

  const newsModelConfigId = normalizeOptionalId(form.get("newsModelConfigId"));
  const assistantModelConfigId = normalizeOptionalId(form.get("assistantModelConfigId"));
  const writingModelConfigId = normalizeOptionalId(form.get("writingModelConfigId"));
  const translationModelConfigId = normalizeOptionalId(form.get("translationModelConfigId"));

  const maxStorageMb = clamp(Number(form.get("maxStorageMb") || 2048), 64, 1024 * 100);
  const cleanupAfterDays = clamp(Number(form.get("cleanupAfterDays") || 30), 1, 3650);
  const videoMaxDurationSec = clamp(Number(form.get("videoMaxDurationSec") || 1200), 30, 1200);
  const videoMaxPerPost = clamp(Number(form.get("videoMaxPerPost") || 4), 0, 4);
  const videoDownloadHosts = (() => {
    const known = new Set(INTERNATIONAL_PLATFORM_KEYS);
    const selected = new Set<string>();
    for (const value of form.getAll("videoDownloadHosts")) {
      const key = String(value).trim().toLowerCase();
      if (known.has(key)) selected.add(key);
    }
    return [...selected].join(",");
  })();
  const globalPromptPrefix = String(form.get("globalPromptPrefix") || "").slice(0, 4000);

  const exaApiKeyPlain = String(form.get("exaApiKey") || "").trim();
  const exaApiKeyEnc = exaApiKeyPlain ? encryptSecret(exaApiKeyPlain) : undefined;

  const update: Record<string, unknown> = {
    name: String(form.get("name") || "拾贝 信息博客"),
    description: String(form.get("description") || ""),
    ownerName: String(form.get("ownerName") || "管理员"),
    autoPublish,
    textOnlyMode,
    defaultTheme,
    defaultFont,
    defaultLanguage,
    newsLanguageMode,
    defaultSettingsUI,
    maxStorageMb,
    cleanupAfterDays,
    cleanupCustomEnabled,
    videoMaxDurationSec,
    videoDownloadDomestic,
    videoDownloadHosts,
    videoMaxPerPost,
    exaEnabled,
    musicEnabledDefault,
    newsModelConfigId,
    assistantModelConfigId,
    writingModelConfigId,
    translationModelConfigId,
    globalPromptPrefix
  };
  if (exaApiKeyEnc) update.exaApiKeyEnc = exaApiKeyEnc;

  await prisma.siteSettings.upsert({
    where: { id: "site" },
    update,
    create: {
      id: "site",
      ...(update as Record<string, never>)
    }
  });
  revalidateTag("site-settings");
  return redirectTo(`/admin/settings?tab=${settingsTab}`);
}

function normalizeOptionalId(value: FormDataEntryValue | null) {
  const id = String(value || "").trim();
  return id || null;
}

function normalizeSettingsTab(value: FormDataEntryValue | null) {
  const tab = String(value || "site").trim();
  return ["site", "content", "models", "media", "storage", "external"].includes(tab) ? tab : "site";
}
