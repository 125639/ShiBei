import { cache } from "react";
import { DEFAULT_LANGUAGE, isLanguageKey, type LanguageKey } from "./language";

/**
 * 每请求的「当前语言」存储，供服务端组件在不逐层传 props 的前提下读取。
 *
 * 为什么不是 headers()：那会把每个读取它的路由变成动态渲染，文章页
 * (revalidate = 300) 与列表页的 ISR 全部失效——那是本项目专门调优过的东西。
 * 语言是路由段（/zh、/en），每个语种本来就是独立的渲染产物，用 React cache()
 * 做每请求存储即可，静态/ISR 渲染都成立。next-intl 的 setRequestLocale 同理。
 *
 * 约定：`[lang]/layout.tsx` 与每个 `[lang]` 下的 page 都要调一次
 * setRequestLanguage(lang)。布局先于子节点渲染，但流式/并行渲染下不宜只依赖
 * 布局那一次——page 里再调一次是幂等的，成本是一次赋值。
 *
 * 未设置时 getRequestLanguage() 返回 null，代表「不在语言路由下」（后台
 * /admin 就是这种情况，它有自己的 shibei.admin.language 即时切换器）。
 * 此时 I18nText 退回「中英都渲染 + CSS 择一显示」的历史行为。
 */
const requestLanguageStore = cache((): { language: LanguageKey | null } => ({ language: null }));

export function setRequestLanguage(value: string | null | undefined): LanguageKey {
  const language = isLanguageKey(value) ? value : DEFAULT_LANGUAGE;
  requestLanguageStore().language = language;
  return language;
}

export function getRequestLanguage(): LanguageKey | null {
  return requestLanguageStore().language;
}

/** 需要一个确定语言时用这个；不在语言路由下则回落默认语言。 */
export function resolveRequestLanguage(): LanguageKey {
  return getRequestLanguage() ?? DEFAULT_LANGUAGE;
}
