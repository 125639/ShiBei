"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 补全 template.tsx 覆盖不到的过渡场景：只改查询参数的导航
 * （如 /posts → /posts?topic=xxx 的分类筛选、翻页）不会重挂载
 * template，进入动画不会重放。这里监听 pathname+searchParams，
 * 变化时重启父级 .route-transition 的 CSS 动画。
 *
 * 渲染一个隐藏 span 仅用于定位父元素；首挂载不动作，
 * 所以不影响 SSR 首屏，也不会造成水合时的二次闪动。
 */
function SearchParamsTransitionInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams}`;
  const lastKey = useRef(routeKey);
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (lastKey.current === routeKey) return;
    lastKey.current = routeKey;
    const el = anchorRef.current?.closest<HTMLElement>(".route-transition");
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 置空动画 → 强制 reflow → 恢复，触发 route-enter 重播。
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }, [routeKey]);

  return <span ref={anchorRef} hidden />;
}

export function SearchParamsTransition() {
  // useSearchParams 需要 Suspense 边界；fallback 为 null 不影响静态预渲染。
  return (
    <Suspense fallback={null}>
      <SearchParamsTransitionInner />
    </Suspense>
  );
}
