"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Poll only visible, idle screens. Wait for the previous refresh to commit so a
 * slow server cannot accumulate an interval's worth of overlapping RSC renders.
 */
export function AutoRefresh({ active, intervalMs = 5_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!active || pending) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(refresh, Math.max(1000, intervalMs));
    };
    const refresh = () => {
      clearTimeout(timer);
      const editing = document.activeElement?.closest('input, textarea, select, [contenteditable="true"]');
      if (document.visibilityState !== "visible" || !navigator.onLine || editing) {
        schedule();
        return;
      }
      startTransition(() => router.refresh());
    };
    schedule();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, intervalMs, pending, router]);
  return null;
}
