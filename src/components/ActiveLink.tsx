"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const target = typeof href === "string" ? href : (href as { pathname?: string }).pathname || "";
  const isActive = match === "exact"
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`);

  const joinedClass = [className, isActive ? activeClassName : null].filter(Boolean).join(" ") || undefined;

  return (
    <Link {...rest} href={href} className={joinedClass} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
