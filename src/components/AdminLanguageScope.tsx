"use client";

import { useEffect } from "react";
import {
  ADMIN_LANGUAGE_EVENT,
  ADMIN_LANGUAGE_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  isLanguageKey,
  type LanguageKey
} from "@/lib/language";

function applyLanguage(language: LanguageKey) {
  document.documentElement.setAttribute("data-language", language);
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
}

export function readAdminLanguage(fallback: LanguageKey): LanguageKey {
  try {
    const stored = localStorage.getItem(ADMIN_LANGUAGE_STORAGE_KEY);
    return isLanguageKey(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Scopes the admin UI language to the admin's own preference
 * (localStorage `shibei.admin.language`).
 *
 * 后台与公开站现在是两个独立的 root layout，互相跳转一定是整页加载，
 * 因此不再需要「离开后台时还原前台语言」的清理逻辑——前台语言由 URL 的
 * /zh、/en 段决定，由服务端直接渲染进 <html lang>。
 */
export function AdminLanguageScope({
  siteDefaultLanguage = DEFAULT_LANGUAGE
}: {
  siteDefaultLanguage?: LanguageKey;
}) {
  useEffect(() => {
    const apply = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const next =
        typeof detail === "string" && isLanguageKey(detail)
          ? detail
          : readAdminLanguage(siteDefaultLanguage);
      applyLanguage(next);
    };
    apply();
    window.addEventListener(ADMIN_LANGUAGE_EVENT, apply);
    return () => window.removeEventListener(ADMIN_LANGUAGE_EVENT, apply);
  }, [siteDefaultLanguage]);

  return null;
}
