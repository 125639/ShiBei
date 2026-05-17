"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { I18nText } from "./I18nText";

/**
 * 移动端 admin 侧栏触发器:小屏幕显示 hamburger 按钮 + 背景遮罩,desktop 上隐藏。
 * 通过 [data-admin-nav-open] 属性切到 body 上,让 globals.css 控制 sidebar 的滑入/滑出。
 */
export function AdminMobileNavToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 切换页面或按 ESC 时关闭抽屉。
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    document.body.dataset.adminNavOpen = open ? "true" : "false";
    return () => {
      delete document.body.dataset.adminNavOpen;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="admin-mobile-toggle"
        aria-expanded={open}
        aria-controls="admin-sidebar"
        aria-label={open ? "关闭导航" : "打开导航"}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="hamburger-icon">{open ? "✕" : "☰"}</span>
        <span className="sr-only">
          <I18nText zh="导航" en="Navigation" />
        </span>
      </button>
      <button
        type="button"
        className="admin-mobile-backdrop"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        data-active={open ? "true" : "false"}
      />
      {children}
    </>
  );
}
