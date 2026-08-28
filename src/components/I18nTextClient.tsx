"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LanguageKey } from "@/lib/language";
import { renderI18nPair } from "./i18n-pair";

/**
 * 当前路由语言的客户端通道。
 *
 * null = 不在语言路由下（后台 /admin），此时 I18nText 退回「两侧都渲染 +
 * CSS 择一」的历史行为，与后台自己的即时语言切换器兼容。
 */
const LanguageContext = createContext<LanguageKey | null>(null);

export function LanguageProvider({
  language,
  children
}: {
  language: LanguageKey;
  children: ReactNode;
}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

/** 客户端组件读取当前路由语言；不在语言路由下返回 null。 */
export function useRouteLanguage(): LanguageKey | null {
  return useContext(LanguageContext);
}

/**
 * 双语文本的客户端版本。导出名与服务端版一致，客户端组件只需把导入路径
 * 从 "./I18nText" 改成 "./I18nTextClient"，JSX 无需改动。
 *
 * 服务端版靠 React cache() 读每请求语言，那是 RSC 专用 API，在客户端包里
 * 调用会直接抛；所以客户端必须走 Context。
 */
export function I18nText({ zh, en, className }: { zh: ReactNode; en: ReactNode; className?: string }) {
  return renderI18nPair(useContext(LanguageContext), zh, en, className);
}
