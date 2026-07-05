"use client";

import { useEffect } from "react";
import {
  ADMIN_LANGUAGE_EVENT,
  ADMIN_LANGUAGE_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  isLanguageKey,
  type LanguageKey
} from "@/lib/language";
import { PREF_KEYS } from "@/lib/themes";

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
 * (localStorage `shibei.admin.language`), overriding whatever the
 * visitor-facing UserPreferencesScript applied from `shibei.language`.
 *
 * On unmount (leaving /admin via client-side navigation) it restores the
 * front-end language using the same precedence as UserPreferencesScript:
 * saved visitor preference first, then the site default.
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
    return () => {
      window.removeEventListener(ADMIN_LANGUAGE_EVENT, apply);
      let visitorLanguage: string | null = null;
      try {
        visitorLanguage = localStorage.getItem(PREF_KEYS.language);
      } catch {
        /* localStorage may be blocked */
      }
      applyLanguage(isLanguageKey(visitorLanguage) ? visitorLanguage : siteDefaultLanguage);
    };
  }, [siteDefaultLanguage]);

  return null;
}
