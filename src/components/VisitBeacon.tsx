"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const DAY_KEY = "shibei.visit.day";

function localDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 页面浏览埋点:路由变化即上报一次 PV;当日首次访问(localStorage 标记)
 * 额外带 unique 标记用于近似 UV。走 JS 上报,天然过滤大部分爬虫。
 */
export function VisitBeacon() {
  const pathname = usePathname();
  const last = useRef<{ path: string; at: number }>({ path: "", at: 0 });

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    // 同一路径 5 秒内不重复上报(严格模式双执行、快速往返)
    const now = Date.now();
    if (last.current.path === pathname && now - last.current.at < 5000) return;
    last.current = { path: pathname, at: now };

    let unique = false;
    try {
      const today = localDayKey();
      if (localStorage.getItem(DAY_KEY) !== today) {
        localStorage.setItem(DAY_KEY, today);
        unique = true;
      }
    } catch {
      // 隐私模式等拿不到 localStorage:放弃 UV 标记,PV 照常
    }

    const body = JSON.stringify({ path: pathname, unique });
    try {
      if (!navigator.sendBeacon?.("/api/public/visit", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/public/visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true
        }).catch(() => undefined);
      }
    } catch {
      // 埋点失败对访客无感
    }
  }, [pathname]);

  return null;
}
