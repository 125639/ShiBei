"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { DEFAULT_LANGUAGE, localizeHref } from "@/lib/language";
import { useRouteLanguage } from "./I18nTextClient";

/**
 * 站内链接：自动带上当前路由的语言段。
 *
 * 为什么全站统一走这一层，而不是逐处手写 `/${lang}/posts`：
 * 语言连续性靠的是每个链接都保持当前语种。中间件会把无前缀路径重定向到
 * 协商出的语言，所以漏改的链接**不会 404**，只会静默把英文读者甩回中文
 * ——这种 bug 构建和类型都抓不到，只能靠不给人留手写的机会来避免。
 *
 * next/link 本身就是客户端组件，所以这一层不额外增加客户端边界成本。
 * 外链、锚点、/admin、/api、静态资源由 localizeHref 原样放过。
 */
export function LocalizedLink({
  href,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const language = useRouteLanguage() ?? DEFAULT_LANGUAGE;
  return <Link href={localizeHref(language, href)} {...rest} />;
}
