"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { useUserPrefs } from "./useUserPrefs";

const Cursor = dynamic(() => import("./CustomCursor").then((module) => module.CustomCursor), { ssr: false });
const MEDIA = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(MEDIA);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function snapshot() {
  return window.matchMedia(MEDIA).matches;
}

/** Most visitors (and all phones) never use cursor particles. Keep that engine
 * outside their initial client bundle without removing the appearance option.
 */
export function CursorEnhancement() {
  const { prefs, hydrated } = useUserPrefs();
  const eligible = useSyncExternalStore(subscribe, snapshot, () => false);
  return hydrated && prefs.customCursor && eligible ? <Cursor /> : null;
}
