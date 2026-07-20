"use client";

import { useEffect } from "react";
import { PREF_KEYS, isUiStyleKey, type UiStyleKey } from "@/lib/themes";

/**
 * 后台管理界面固定使用 classic 风格，不跟随访客在公开页面选择的个人外观
 * 偏好（<html> 的 data-ui 是全站共享属性，由 UserPreferencesScript 按
 * `shibei.ui` 写入，不区分公开页与后台）。离开 /admin 时恢复访客在公开
 * 页面的实际偏好，隔离方式与 AdminLanguageScope 对 data-language 一致。
 */
export function AdminUiScope({ siteDefaultUi = "classic" }: { siteDefaultUi?: UiStyleKey }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-ui", "classic");
    return () => {
      let visitorUi: string | null = null;
      try {
        visitorUi = localStorage.getItem(PREF_KEYS.ui);
      } catch {
        /* localStorage may be blocked */
      }
      document.documentElement.setAttribute(
        "data-ui",
        isUiStyleKey(visitorUi) ? visitorUi : siteDefaultUi
      );
    };
  }, [siteDefaultUi]);

  return null;
}
