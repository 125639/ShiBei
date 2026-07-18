import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { isLanguageKey, isContentLanguageMode } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { isFontKey, isThemeKey, isUiStyleKey } from "@/lib/themes";

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
  const videosEnabled = form.get("videosEnabled") === "true";
  const youtubeSearchEnabled = form.get("youtubeSearchEnabled") === "true";
  const commentsEnabled = form.get("commentsEnabled") === "true";
  const exaEnabled = form.get("exaEnabled") === "true";
  const autoImageSearchEnabled = form.getAll("autoImageSearchEnabled").map(String).includes("true");
  const musicEnabledDefault = form.get("musicEnabledDefault") === "true";
  const cleanupCustomEnabled = form.get("cleanupCustomEnabled") === "true";

  const themeRaw = String(form.get("defaultTheme") || "apple");
  const fontRaw = String(form.get("defaultFont") || "sans-cjk");
  const languageRaw = String(form.get("defaultLanguage") || "zh");
  const contentLanguageModeRaw = String(form.get("contentLanguageMode") || "default-language");
  const defaultSettingsUIRaw = String(form.get("defaultSettingsUI") || "classic");
  const defaultTheme = isThemeKey(themeRaw) ? themeRaw : "apple";
  const defaultFont = isFontKey(fontRaw) ? fontRaw : "sans-cjk";
  const defaultLanguage = isLanguageKey(languageRaw) ? languageRaw : "zh";
  const contentLanguageMode = isContentLanguageMode(contentLanguageModeRaw) ? contentLanguageModeRaw : "default-language";
  const defaultSettingsUI = isUiStyleKey(defaultSettingsUIRaw) ? defaultSettingsUIRaw : "classic";

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
    videosEnabled,
    youtubeSearchEnabled,
    commentsEnabled,
    defaultTheme,
    defaultFont,
    defaultLanguage,
    contentLanguageMode,
    defaultSettingsUI,
    maxStorageMb,
    cleanupAfterDays,
    cleanupCustomEnabled,
    autoImageSearchEnabled,
    exaEnabled,
    musicEnabledDefault,
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
  revalidateTag("site-settings", { expire: 0 });
  // 语言模式 / 视频开关等设置会影响 ISR 缓存的文章页与列表页，保存时一并失效。
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/posts");
  revalidatePath("/");
  return redirectTo(`/admin/settings?tab=${settingsTab}&saved=1`);
}

function normalizeSettingsTab(value: FormDataEntryValue | null) {
  const tab = String(value || "site").trim();
  return ["site", "content", "models", "media", "storage", "external"].includes(tab) ? tab : "site";
}
