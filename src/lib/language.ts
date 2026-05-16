export type LanguageKey = "zh" | "en";
export type ContentLanguageMode = "default-language" | "bilingual";

export const DEFAULT_LANGUAGE: LanguageKey = "zh";

export const LANGUAGE_OPTIONS: Array<{ value: LanguageKey; label: string; description: string }> = [
  { value: "zh", label: "中文", description: "默认显示中文界面与中文正文。" },
  { value: "en", label: "English", description: "用户打开文章时可自动翻译为英文。" }
];

export const CONTENT_LANGUAGE_MODE_OPTIONS: Array<{ value: ContentLanguageMode; label: string; description: string }> = [
  {
    value: "default-language",
    label: "默认语种模式",
    description: "前台默认显示中文；用户可在设置中切换英文，打开文章时按需 AI 翻译。"
  },
  {
    value: "bilingual",
    label: "双语模式",
    description: "文章页同时展示中文与英文缓存；英文缺失时打开文章会自动生成。"
  }
];

export function isLanguageKey(value: string | null | undefined): value is LanguageKey {
  return value === "zh" || value === "en";
}

export function isContentLanguageMode(value: string | null | undefined): value is ContentLanguageMode {
  return value === "default-language" || value === "bilingual";
}

export function languageLabel(value: string | null | undefined) {
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label || "中文";
}

export function contentLanguageModeLabel(value: string | null | undefined) {
  return CONTENT_LANGUAGE_MODE_OPTIONS.find((option) => option.value === value)?.label || "默认语种模式";
}
