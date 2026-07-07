"use client";

import { useEffect, useState } from "react";
import {
  ADMIN_LANGUAGE_EVENT,
  ADMIN_LANGUAGE_STORAGE_KEY,
  isLanguageKey,
  type LanguageKey
} from "@/lib/language";

/**
 * 后台专属的界面语言切换器，写入 shibei.admin.language 并通过自定义事件
 * 通知 AdminLanguageScope 立即应用，与前台访客的 shibei.language 互不影响。
 */
export function AdminLanguageToggle() {
  // null = 尚未水合，两个按钮都不高亮，避免 SSR/CSR 不一致
  const [language, setLanguage] = useState<LanguageKey | null>(null);

  useEffect(() => {
    const read = () => {
      const current = document.documentElement.getAttribute("data-language");
      setLanguage(isLanguageKey(current) ? current : "zh");
    };
    read();
    window.addEventListener(ADMIN_LANGUAGE_EVENT, read);
    return () => window.removeEventListener(ADMIN_LANGUAGE_EVENT, read);
  }, []);

  const change = (next: LanguageKey) => {
    try {
      localStorage.setItem(ADMIN_LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* localStorage may be blocked; still apply for this page */
    }
    setLanguage(next);
    // detail 携带目标语言，localStorage 被禁用时 AdminLanguageScope 仍能应用
    window.dispatchEvent(new CustomEvent(ADMIN_LANGUAGE_EVENT, { detail: next }));
  };

  return (
    <div className="admin-lang-toggle" role="group" aria-label="后台界面语言 (Admin UI language)">
      <button
        type="button"
        aria-pressed={language === "zh"}
        className={language === "zh" ? "active" : undefined}
        onClick={() => change("zh")}
      >
        中文
      </button>
      <button
        type="button"
        aria-pressed={language === "en"}
        className={language === "en" ? "active" : undefined}
        onClick={() => change("en")}
      >
        EN
      </button>
    </div>
  );
}
