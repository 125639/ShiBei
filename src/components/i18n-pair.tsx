import type { ReactNode } from "react";
import type { LanguageKey } from "@/lib/language";

/**
 * 双语文本的纯渲染部分。
 *
 * 这个模块刻意不带 "use client"，也刻意不导入任何服务端专用 API：
 * I18nText（服务端）与 I18nTextClient（客户端）都要用它，任何一侧的依赖
 * 混进来都会污染另一侧的打包（例如 react 的 cache() 进了客户端包会直接抛）。
 *
 * language 为 null 时两侧都渲染，由 CSS（globals.css 的 .i18n-zh/.i18n-en
 * 配合 :root[data-language]）择一显示——后台 /admin 走这条路径，它的语言
 * 切换不经过导航，必须保留两侧节点。
 */
export function renderI18nPair(
  language: LanguageKey | null,
  zh: ReactNode,
  en: ReactNode,
  className?: string
) {
  const zhClass = ["i18n-zh", className].filter(Boolean).join(" ");
  const enClass = ["i18n-en", className].filter(Boolean).join(" ");

  if (language === "zh") {
    return <span lang="zh-CN" className={zhClass}>{zh}</span>;
  }
  if (language === "en") {
    return <span lang="en" className={enClass}>{en}</span>;
  }
  return (
    <>
      <span lang="zh-CN" className={zhClass}>{zh}</span>
      <span lang="en" className={enClass}>{en}</span>
    </>
  );
}
