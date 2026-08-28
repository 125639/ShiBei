"use client";

import { usePathname, useRouter } from "next/navigation";
import { DEFAULT_LANGUAGE, withLanguagePrefix, type LanguageKey } from "@/lib/language";
import { useRouteLanguage } from "./I18nTextClient";

/**
 * 公开站的语言切换 = 导航到另一个语言段的同一页面。
 *
 * 语言不再是 localStorage 偏好：一个 URL 只对应一种语言，否则 /en/posts/x
 * 会因为本地偏好是中文而显示中文正文——URL 与内容自相矛盾，分享出去的链接
 * 在别人那里显示成另一种语言，搜索引擎抓到的也不确定是哪一种。
 *
 * 查询串在点击时从 window.location 读取，而不是用 useSearchParams()：
 * 后者会把调用它的组件（这里在 PublicShell 里，属于布局）推进 Suspense /
 * 动态渲染，代价远大于收益。
 */
export function useLanguageSwitch() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const current = useRouteLanguage() ?? DEFAULT_LANGUAGE;

  function switchTo(next: LanguageKey) {
    if (next === current) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.push(`${withLanguagePrefix(next, pathname)}${search}${hash}`);
  }

  return { current, switchTo };
}
