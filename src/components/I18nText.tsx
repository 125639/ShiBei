import type { ReactNode } from "react";
import { renderI18nPair } from "./i18n-pair";
import { getRequestLanguage } from "@/lib/i18n-server";

/**
 * 双语文本。**服务端组件**——客户端组件请从 ./I18nTextClient 导入同名组件
 * （导出名相同，只需改导入路径）。
 *
 * 在语言路由（/zh、/en）下只渲染当前语言那一侧：HTML 与 RSC 负载都不再
 * 携带另一种语言。全站 1194 处调用意味着此前每个响应里的导航、侧栏标题、
 * 页脚、按钮文案都是双份。
 *
 * 不在语言路由下（后台 /admin）时 getRequestLanguage() 返回 null，退回
 * 两侧都渲染 + CSS 择一显示的历史行为。
 */
export function I18nText({ zh, en, className }: { zh: ReactNode; en: ReactNode; className?: string }) {
  return renderI18nPair(getRequestLanguage(), zh, en, className);
}
