"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";
import { DEFAULT_LANGUAGE, localizeHref, stripLanguagePrefix } from "@/lib/language";
import { useRouteLanguage } from "./I18nTextClient";

type Props = Omit<ComponentProps<typeof Link>, "children"> & {
  children: ReactNode;
  match?: "exact" | "prefix";
  activeClassName?: string;
};

export function ActiveLink({
  children,
  href,
  className,
  match = "exact",
  activeClassName = "active",
  ...rest
}: Props) {
  const pathname = usePathname() || "";
  const language = useRouteLanguage() ?? DEFAULT_LANGUAGE;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const rawTarget = typeof href === "string" ? href : (href as { pathname?: string }).pathname || "";
  // 链接本身带语言段；高亮判定则在**去掉语言段**的路径上比较，
  // 否则 /en/posts 下的「文章」导航项不会高亮（target 是 /en/posts，
  // 但一旦语言与当前路由不一致就整条匹配失败）。
  const localizedHref = typeof href === "string" ? localizeHref(language, href) : href;
  const target = stripLanguagePrefix(rawTarget);
  const current = stripLanguagePrefix(pathname);
  const isActive = match === "exact"
    ? current === target
    : current === target || current.startsWith(`${target}/`);

  const joinedClass = [className, isActive ? activeClassName : null].filter(Boolean).join(" ") || undefined;

  useEffect(() => {
    if (!isActive || !linkRef.current) return;
    let parent = linkRef.current.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      const canScrollX = /(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
      if (canScrollX) {
        linkRef.current.scrollIntoView({ block: "nearest", inline: "center" });
        return;
      }
      parent = parent.parentElement;
    }
  }, [isActive, pathname]);

  return (
    <Link ref={linkRef} {...rest} href={localizedHref} className={joinedClass} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
