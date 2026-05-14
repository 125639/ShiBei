import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { isLanguageKey, isNewsLanguageMode } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { isFontKey, isThemeKey } from "@/lib/themes";

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
  const autoImageSearchEnabled = form.getAll("autoImageSearchEnabled").map(String).includes("true");
  const musicEnabledDefault = form.get("musicEnabledDefault") === "true";
  const cleanupCustomEnabled = form.get("cleanupCustomEnabled") === "true";

  const themeRaw = String(form.get("defaultTheme") || "apple");
  const fontRaw = String(form.get("defaultFont") || "sans-cjk");
  const languageRaw = String(form.get("defaultLanguage") || "zh");
  const newsLanguageModeRaw = String(form.get("newsLanguageMode") || "default-language");
  const defaultSettingsUIRaw = String(form.get("defaultSettingsUI") || "classic");
  const defaultTheme = isThemeKey(themeRaw) ? themeRaw : "apple";
  const defaultFont = isFontKey(fontRaw) ? fontRaw : "sans-cjk";
  const defaultLanguage = isLanguageKey(languageRaw) ? languageRaw : "zh";
  const newsLanguageMode = isNewsLanguageMode(newsLanguageModeRaw) ? newsLanguageModeRaw : "default-language";
  const defaultSettingsUI = ["classic", "cyber", "dynamic"].includes(defaultSettingsUIRaw) ? defaultSettingsUIRaw : "classic";

  const newsModelConfigId = normalizeOptionalId(form.get("newsModelConfigId"));
  const assistantModelConfigId = normalizeOptionalId(form.get("assistantModelConfigId"));
  const writingModelConfigId = normalizeOptionalId(form.get("writingModelConfigId"));
  const translationModelConfigId = normalizeOptionalId(form.get("translationModelConfigId"));

  const maxStorageMb = clamp(Number(form.get("maxStorageMb") || 2048), 64, 1024 * 100);
  const cleanupAfterDays = clamp(Number(form.get("cleanupAfterDays") || 30), 1, 3650);
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
    autoImageSearchEnabled,
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
  return redirectTo(`/admin/settings?tab=${settingsTab}&saved=1`);
}

function normalizeOptionalId(value: FormDataEntryValue | null) {
  const id = String(value || "").trim();
  return id || null;
}

function normalizeSettingsTab(value: FormDataEntryValue | null) {
  const tab = String(value || "site").trim();
  return ["site", "content", "models", "media", "storage", "external"].includes(tab) ? tab : "site";
}
