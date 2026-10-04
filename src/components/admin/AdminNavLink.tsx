"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { AdminIcon, type AdminIconName } from "./icons";

function PendingIndicator() {
  const { pending } = useLinkStatus();
  return <span className="admin-nav-pending" aria-hidden="true" data-pending={pending || undefined} />;
}

export function AdminNavLink({
  href,
  children,
  className,
  icon
}: {
  href: string;
  children: ReactNode;
  className?: string;
  icon?: AdminIconName;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedAt = useRef(0);
  const active = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  function cancel() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function intent() {
    cancel();
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (
      active ||
      connection?.saveData ||
      /(^|-)2g$/.test(connection?.effectiveType || "") ||
      Date.now() - prefetchedAt.current < 30_000
    )
      return;
    timer.current = setTimeout(() => {
      prefetchedAt.current = Date.now();
      router.prefetch(href);
    }, 120);
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return (
    <Link
      href={href}
      prefetch={false}
      className={[className, active ? "active" : ""].filter(Boolean).join(" ")}
      aria-current={active ? "page" : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") intent();
      }}
      onPointerLeave={cancel}
      onFocus={intent}
      onBlur={cancel}
      onClick={cancel}
    >
      {icon ? <AdminIcon name={icon} className="admin-nav-icon" /> : null}
      <span className="admin-nav-label">{children}</span>
      <PendingIndicator />
    </Link>
  );
}
