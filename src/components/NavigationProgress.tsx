"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 顶部导航进度条：点击站内链接的瞬间出现，路由切换完成后收尾。
 * 服务器渲染慢（低配机器 + force-dynamic 页面）时，用户至少能立刻
 * 看到「已响应」的反馈，而不是页面毫无动静。
 *
 * App Router 没有公开的路由事件，这里用「点击捕获 + pathname 变化」两端夹出导航区间：
 * - document 捕获阶段监听 <a> 点击，识别会触发客户端导航的站内链接 → start()
 * - usePathname / useSearchParams 变化说明新页面已提交 → done()
 */
function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);
  const safetyTimer = useRef<number | null>(null);

  // 挂载后订阅点击与 popstate；卸载时清理。
  useEffect(() => {
    function start() {
      if (activeRef.current) return;
      activeRef.current = true;
      setVisible(true);
      // 先瞬间归零（无过渡），下一帧再开始「涓流」到 90%，剩下的 10% 留给 done()。
      const bar = barRef.current;
      if (bar) {
        bar.style.transition = "none";
        bar.style.transform = "scaleX(0)";
        bar.style.opacity = "1";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bar.style.transition = "transform 8s cubic-bezier(0.08, 0.6, 0.2, 1)";
            bar.style.transform = "scaleX(0.9)";
          });
        });
      }
      // 兜底：极端情况下（导航被浏览器拦截等）12 秒后自动收尾，避免进度条挂死。
      if (safetyTimer.current) window.clearTimeout(safetyTimer.current);
      safetyTimer.current = window.setTimeout(finish, 12_000);
    }

    function onClick(event: MouseEvent) {
      // 修饰键 / 中键点击会开新标签页，当前页不导航。
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // 指向当前页（含 query）就不会真正导航，别让进度条空转。
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    }

    function onPopState() {
      start();
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      if (safetyTimer.current) window.clearTimeout(safetyTimer.current);
    };
  }, []);

  function finish() {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (safetyTimer.current) {
      window.clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
    const bar = barRef.current;
    if (bar) {
      bar.style.transition = "transform 0.18s ease, opacity 0.25s ease 0.15s";
      bar.style.transform = "scaleX(1)";
      bar.style.opacity = "0";
    }
    window.setTimeout(() => setVisible(false), 450);
  }

  // 新路由提交（pathname 或 query 变化）→ 收尾。
  // finish 只操作 ref/DOM，不依赖渲染值，不进依赖数组。
  const routeKey = `${pathname}?${searchParams}`;
  const lastRouteRef = useRef(routeKey);
  useEffect(() => {
    if (lastRouteRef.current !== routeKey) {
      lastRouteRef.current = routeKey;
      finish();
    }
  }, [routeKey]);

  return (
    <div className="nav-progress" aria-hidden="true" data-visible={visible || undefined}>
      <div className="nav-progress-bar" ref={barRef} />
    </div>
  );
}

export function NavigationProgress() {
  // useSearchParams 需要 Suspense 边界，否则静态预渲染会报错。
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
