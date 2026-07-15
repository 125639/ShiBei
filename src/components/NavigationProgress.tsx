"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 顶部导航进度条：点击站内链接的瞬间出现，路由切换完成后收尾。
 * 服务器渲染慢（低配机器 + force-dynamic 页面）时，用户至少能立刻
 * 看到「已响应」的反馈，而不是页面毫无动静。
 *
 * App Router 没有公开的路由事件，这里用「点击捕获 + 真实 URL 变化」两端夹出导航区间：
 * - document 捕获阶段监听 <a> 点击，识别会触发客户端导航的站内链接 → start()
 * - location.href 变化并经过两个渲染帧，说明新页面已提交 → finish()
 *
 * 不使用 useSearchParams/Suspense。这个组件挂在根布局的第一层，只为进度条
 * 创建一个流式边界，会让 React 在极少数整页刷新中错置水合指针。监听浏览器
 * 的实际 URL 既覆盖路径和 query，又能让首屏始终输出完全确定的 DOM。
 */
export function NavigationProgress() {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);

  // 挂载后订阅点击与 popstate；卸载时清理。
  useEffect(() => {
    let safetyTimer: number | null = null;
    let hideTimer: number | null = null;
    let routeWatchFrame: number | null = null;

    function finish() {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (safetyTimer !== null) {
        window.clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      if (routeWatchFrame !== null) {
        window.cancelAnimationFrame(routeWatchFrame);
        routeWatchFrame = null;
      }
      const bar = barRef.current;
      if (bar) {
        bar.style.transition = "transform 0.18s ease, opacity 0.25s ease 0.15s";
        bar.style.transform = "scaleX(1)";
        bar.style.opacity = "0";
      }
      hideTimer = window.setTimeout(() => {
        setVisible(false);
        hideTimer = null;
      }, 450);
    }

    function finishAfterCommit() {
      if (routeWatchFrame !== null) {
        window.cancelAnimationFrame(routeWatchFrame);
        routeWatchFrame = null;
      }
      // URL 改变与 App Router 提交发生在同一轮更新附近；再等两个绘制帧，
      // 避免进度条在新内容真正呈现前消失。
      routeWatchFrame = window.requestAnimationFrame(() => {
        routeWatchFrame = window.requestAnimationFrame(() => {
          routeWatchFrame = null;
          finish();
        });
      });
    }

    function watchForNavigation(fromHref: string) {
      if (routeWatchFrame !== null) window.cancelAnimationFrame(routeWatchFrame);
      const check = () => {
        if (window.location.href !== fromHref) {
          routeWatchFrame = null;
          finishAfterCommit();
          return;
        }
        if (activeRef.current) routeWatchFrame = window.requestAnimationFrame(check);
      };
      routeWatchFrame = window.requestAnimationFrame(check);
    }

    function start() {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
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
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      safetyTimer = window.setTimeout(finish, 12_000);
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
      const fromHref = window.location.href;
      start();
      watchForNavigation(fromHref);
    }

    function onPopState() {
      start();
      finishAfterCommit();
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      if (routeWatchFrame !== null) window.cancelAnimationFrame(routeWatchFrame);
    };
  }, []);

  return (
    <div className="nav-progress" aria-hidden="true" data-visible={visible || undefined}>
      <div className="nav-progress-bar" ref={barRef} />
    </div>
  );
}
