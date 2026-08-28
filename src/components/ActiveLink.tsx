"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

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
  const linkRef = useRef<HTMLAnchorElement>(null);
  const target = typeof href === "string" ? href : (href as { pathname?: string }).pathname || "";
  const isActive = match === "exact"
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);

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
    <Link ref={linkRef} {...rest} href={href} className={joinedClass} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
