"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/LocalizedLink";
import { I18nText } from "@/components/I18nTextClient";
import type { AppMode } from "@/lib/app-mode";
import { ADMIN_NAV_ITEMS } from "@/lib/admin-nav";
import { AdminIcon } from "./icons";

/**
 * KPanel 式顶栏：左侧「控制台 › 当前页标题」，右侧运行状态、语言切换与
 * 返回前台。标题由 pathname 对导航数据做最长前缀匹配推导——列表页因此
 * 不再重复渲染页内大标题；详情页（如 /admin/jobs/[id]）匹配到父级章节，
 * 页内保留自己的动态标题。
 */
export function AdminTopbar({
  mode,
  showFrontLink,
  children
}: {
  mode: AppMode;
  showFrontLink: boolean;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const current = matchNavItem(pathname);

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-heading">
        <span className="admin-topbar-crumb">
          <I18nText zh="控制台" en="Console" />
        </span>
        <strong className="admin-topbar-name">
          {current ? (
            <I18nText zh={current.zh} en={current.en} />
          ) : (
            <I18nText zh="管理后台" en="Admin" />
          )}
        </strong>
      </div>
      <div className="admin-topbar-actions">
        <span className="admin-topbar-chip">
          <span className="admin-status-dot" aria-hidden="true" />
          <I18nText zh="系统在线" en="Online" />
          {mode !== "full" ? <span className="admin-mode-label">{mode}</span> : null}
        </span>
        {children}
        {showFrontLink ? (
          <LocalizedLink className="admin-topbar-icon-btn" href="/">
            <AdminIcon name="globe" size={14} />
            <I18nText zh="前台" en="Site" />
          </LocalizedLink>
        ) : null}
      </div>
    </header>
  );
}

function matchNavItem(pathname: string | null) {
  if (!pathname) return null;
  let best: (typeof ADMIN_NAV_ITEMS)[number] | null = null;
  for (const item of ADMIN_NAV_ITEMS) {
    // 边界严格匹配（与 AdminNavLink 同一套判定），裸前缀会把 /admin/postsfoo
    // 误判成「文章与草稿」。/admin 自身经 startsWith("/admin/") 充当一切未
    // 收录后台子路径的兜底标题。
    const matched = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matched && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}
