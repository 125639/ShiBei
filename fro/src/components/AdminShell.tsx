import Link from "next/link";
import { I18nText } from "./I18nText";
import { getAppMode } from "@/lib/app-mode";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const mode = getAppMode();

  // 各导航项 + 它在哪些模式下显示。
  // - frontend:仅展示 + 视频 + 音乐 + 同步 + 设置(本端不抓取/不调度,故不显示这些后端项)
  // - backend:全展示,但「返回前台」隐藏(public 已重定向到 admin)
  // - full:全展示
  const items: Array<{ href: string; zh: string; en: string; modes: Array<"frontend" | "backend" | "full"> }> = [
    { href: "/admin", zh: "仪表盘", en: "Dashboard", modes: ["frontend", "backend", "full"] },
    { href: "/admin/sources", zh: "信息源", en: "Sources", modes: ["backend", "full"] },
    { href: "/admin/modules", zh: "模块", en: "Modules", modes: ["backend", "full"] },
    { href: "/admin/posts", zh: "草稿与文章", en: "Posts", modes: ["frontend", "backend", "full"] },
    { href: "/admin/videos", zh: "视频", en: "Videos", modes: ["frontend", "backend", "full"] },
    { href: "/admin/auto-curation", zh: "自动整理", en: "Auto Curation", modes: ["backend", "full"] },
    { href: "/admin/music", zh: "背景音乐", en: "Music", modes: ["frontend", "backend", "full"] },
    { href: "/admin/sync", zh: "数据同步", en: "Sync", modes: ["frontend", "backend", "full"] },
    { href: "/admin/stats", zh: "数据看板", en: "Stats", modes: ["frontend", "backend", "full"] },
    { href: "/admin/settings", zh: "设置", en: "Settings", modes: ["frontend", "backend", "full"] },
  ];

  const visible = items.filter((item) => item.modes.includes(mode));
  const showFrontLink = mode !== "backend";

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h1 style={{ marginTop: 0 }}>
          ShiBei Admin
          {mode !== "full" ? (
            <span className="tag" style={{ marginLeft: 8, fontSize: 11 }}>
              {mode}
            </span>
          ) : null}
        </h1>
        {visible.map((item) => (
          <Link href={item.href} key={item.href}>
            <I18nText zh={item.zh} en={item.en} />
          </Link>
        ))}
        {showFrontLink ? (
          <Link href="/">
            <I18nText zh="返回前台" en="Back to Site" />
          </Link>
        ) : null}
        <form action="/api/admin/logout" method="post">
          <button type="submit">
            <I18nText zh="退出登录" en="Logout" />
          </button>
        </form>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
