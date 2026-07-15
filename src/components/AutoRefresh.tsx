"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 活跃后台任务存在时刷新服务端页面数据；隐藏标签页不发送无意义请求。 */
export function AutoRefresh({ active, intervalMs = 5_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [active, intervalMs, router]);

  return null;
}
