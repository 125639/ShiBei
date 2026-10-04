"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useRouteLanguage } from "@/components/I18nTextClient";
import { Icon } from "./Icons";

const EVENT = "shibei:motion";
const STORAGE_KEY = "shibei.motion";
const MEDIA = "(prefers-reduced-motion: reduce)";

function paused() {
  return window.matchMedia(MEDIA).matches || document.documentElement.dataset.siteMotion === "paused";
}
function subscribe(callback: () => void) {
  const media = window.matchMedia(MEDIA);
  media.addEventListener("change", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function MotionToggle() {
  const disabled = useSyncExternalStore(subscribe, paused, () => false);
  const english = useRouteLanguage() === "en";
  function toggle() {
    // OS accessibility preferences always win over an in-page preference.
    if (window.matchMedia(MEDIA).matches) return;
    const next = !disabled;
    document.documentElement.dataset.siteMotion = next ? "paused" : "running";
    try {
      localStorage.setItem(STORAGE_KEY, next ? "paused" : "running");
    } catch {
      /* Session-only when storage is unavailable. */
    }
    window.dispatchEvent(new Event(EVENT));
  }
  return (
    <button
      className="scene-motion-toggle"
      type="button"
      onClick={toggle}
      aria-pressed={disabled}
      aria-label={
        english
          ? disabled
            ? "Enable animations (respects system preference)"
            : "Pause animations"
          : disabled
            ? "启用动效（遵循系统偏好）"
            : "暂停动效"
      }
    >
      <Icon name={disabled ? "play" : "pause"} width="14" height="14" />
      <span>{english ? (disabled ? "Motion off" : "Motion on") : disabled ? "动效已暂停" : "暂停动效"}</span>
    </button>
  );
}

/** Progressive enhancement: content is never hidden while waiting for JavaScript. */
export function SiteMotion() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    try {
      root.dataset.siteMotion = localStorage.getItem(STORAGE_KEY) === "paused" ? "paused" : "running";
    } catch {
      /* No persistent preferences. */
    }
    window.dispatchEvent(new Event(EVENT));
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      root.dataset.siteMotion = event.newValue === "paused" ? "paused" : "running";
      window.dispatchEvent(new Event(EVENT));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const animations = new Set<Animation>();
    const seen = new WeakSet<Element>();
    const main = document.getElementById("site-main");
    const cancel = () => {
      if (paused()) {
        animations.forEach((animation) => animation.cancel());
        animations.clear();
      }
    };
    const unsubscribe = subscribe(cancel);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer?.unobserve(entry.target);
                if (paused() || typeof entry.target.animate !== "function") continue;
                const animation = entry.target.animate(
                  [
                    { opacity: 0, transform: "translateY(20px)" },
                    { opacity: 1, transform: "translateY(0)" }
                  ],
                  { duration: 560, easing: "cubic-bezier(.2,.7,.2,1)" }
                );
                animations.add(animation);
                animation.onfinish = () => animations.delete(animation);
              }
            },
            { threshold: 0.06 }
          );
    const observe = (element: Element) => {
      if (seen.has(element)) return;
      seen.add(element);
      observer?.observe(element);
    };
    const scan = (node: Element) => {
      if (node.matches("[data-reveal]")) observe(node);
      node.querySelectorAll("[data-reveal]").forEach(observe);
    };
    if (main) scan(main);
    // Scan only inserted subtrees. Reading-progress text updates and editor
    // keystrokes must not trigger a traversal of an entire long article.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
      }
    });
    if (main) mutations.observe(main, { childList: true, subtree: true });

    let frame = 0;
    const update = () => {
      frame = 0;
      document.documentElement.toggleAttribute("data-site-scrolled", window.scrollY > 24);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      unsubscribe();
      animations.forEach((animation) => animation.cancel());
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return null;
}
