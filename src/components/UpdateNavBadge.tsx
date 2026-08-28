"use client";

// 侧栏「系统更新」项旁的小圆点：有新版本时亮起。
// 弹窗被叉掉后这是常驻的视觉提醒（用户需求：叉掉后仍能从更新入口更新）。
// 与 UpdateNotifier 共用 getClientCheck 的缓存，不产生额外请求。

import { useEffect, useState } from "react";
import { getClientCheck } from "./update-flow";

export function UpdateNavBadge() {
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getClientCheck().then((data) => {
      if (!cancelled && data?.hasUpdate) setHasUpdate(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hasUpdate) return null;
  return <span className="update-nav-dot" aria-label="有新版本 / update available" />;
}
