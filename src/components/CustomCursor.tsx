"use client";

import { useEffect, useRef, useState } from "react";
import { useUserPrefs } from "./useUserPrefs";

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, label, summary, [role='button']";

/**
 * 自定义光标：小点即时跟随，圆环用 rAF 插值拖尾（≈0.05s 阻尼）。
 * 不依赖动画库；位置写 transform（合成器层），静止 2s 后自动停帧省电。
 * 仅在精确指针设备且未开启"减少动态效果"时激活，与 CSS 的媒体查询守卫一致。
 */
export function CustomCursor() {
  const { prefs, hydrated } = useUserPrefs();
  const [finePointer, setFinePointer] = useState(false);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const apply = () => setFinePointer(fine.matches && motionOk.matches);
    apply();
    fine.addEventListener("change", apply);
    motionOk.addEventListener("change", apply);
    return () => {
      fine.removeEventListener("change", apply);
      motionOk.removeEventListener("change", apply);
    };
  }, [hydrated]);

  const enabled = hydrated && prefs.customCursor && finePointer;

  useEffect(() => {
    if (!enabled) return;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    const target = { x: -100, y: -100 };
    const ringPos = { x: -100, y: -100 };
    let raf = 0;
    let running = false;
    let lastMove = 0;

    const render = () => {
      ringPos.x += (target.x - ringPos.x) * 0.24;
      ringPos.y += (target.y - ringPos.y) * 0.24;
      ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) translate(-50%, -50%)`;
      const settled = Math.abs(target.x - ringPos.x) < 0.1 && Math.abs(target.y - ringPos.y) < 0.1;
      if (settled && performance.now() - lastMove > 2000) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(render);
    };

    const wake = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(render);
      }
    };

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      lastMove = performance.now();
      dot.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      dot.classList.add("visible");
      ring.classList.add("visible");
      wake();
    };

    const onOver = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      ring.classList.toggle("hover", Boolean(el?.closest(INTERACTIVE_SELECTOR)));
    };

    const onLeave = () => {
      dot.classList.remove("visible");
      ring.classList.remove("visible");
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);

    document.documentElement.setAttribute("data-cursor", "custom");
    document.documentElement.setAttribute("data-cursor-style", prefs.cursorStyle);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeAttribute("data-cursor");
      document.documentElement.removeAttribute("data-cursor-style");
    };
  }, [enabled, prefs.cursorStyle]);

  if (!enabled) return null;

  // 初始移出视口，等第一次 mousemove 再定位显示，避免左上角闪现。
  const offscreen = { transform: "translate3d(-100px, -100px, 0) translate(-50%, -50%)" };
  return (
    <div aria-hidden="true">
      <div ref={dotRef} className={`custom-cursor-dot cursor-${prefs.cursorStyle}`} style={offscreen} />
      <div ref={ringRef} className={`custom-cursor-ring cursor-${prefs.cursorStyle}`} style={offscreen} />
    </div>
  );
}
