"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

/** Native details element that closes when navigation completes or focus moves away. */
export function RouteDisclosure({ children, ...props }: ComponentPropsWithoutRef<"details">) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details?.open) return;
    const restoreFocus = details.contains(document.activeElement);
    details.removeAttribute("open");
    if (restoreFocus) requestAnimationFrame(() => details.querySelector<HTMLElement>("summary")?.focus());
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    }

    function onKeyDown(event: KeyboardEvent) {
      const details = detailsRef.current;
      if (event.key !== "Escape" || !details?.open) return;
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    }

    function onFocusIn(event: FocusEvent) {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  return <details ref={detailsRef} {...props}>{children}</details>;
}
