"use client";

import { useEffect } from "react";

/** CSS dvh follows browser chrome, but not the iOS on-screen keyboard. Keep
 * overlays inside the visual viewport without intercepting scroll or pinch zoom.
 */
export function MobileViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      const zoomed = viewport && Math.abs(viewport.scale - 1) > 0.02;
      const height = !zoomed && viewport ? viewport.height : window.innerHeight;
      const top = !zoomed && viewport ? viewport.offsetTop : 0;
      root.style.setProperty("--visible-viewport-height", `${Math.round(height)}px`);
      root.style.setProperty("--visible-viewport-top", `${Math.round(top)}px`);
      const editing = document.activeElement?.matches(
        'textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]'
      );
      root.toggleAttribute(
        "data-mobile-keyboard",
        Boolean(editing && !zoomed && window.innerHeight - height > 120)
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      root.style.removeProperty("--visible-viewport-height");
      root.style.removeProperty("--visible-viewport-top");
      root.removeAttribute("data-mobile-keyboard");
    };
  }, []);
  return null;
}
