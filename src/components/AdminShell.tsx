import Link from "next/link";
import { I18nText } from "./I18nText";
import { getAppMode } from "@/lib/app-mode";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const mode = getAppMode();

  type AppMode = "frontend" | "backend" | "full";
  type NavItem = { href: string; zh: string; en: string; modes: AppMode[] };
  type NavGroup = { zh: string; en: string; items: NavItem[] };

  // 后台导航按日常工作流分组：先看运行状态，再处理内容，再维护来源，最后改系统配置。
  const groups: NavGroup[] = [
    {
      zh: "总览",
      en: "Overview",
      items: [
        { href: "/admin", zh: "仪表盘", en: "Dashboard", modes: ["frontend", "backend", "full"] },
        { href: "/admin/stats", zh: "数据看板", en: "Stats", modes: ["frontend", "backend", "full"] },
        { href: "/admin/jobs", zh: "任务诊断", en: "Jobs", modes: ["backend", "full"] }
      ]
    },
    {
      zh: "内容",
      en: "Content",
      items: [
        { href: "/admin/posts", zh: "文章与草稿", en: "Posts", modes: ["frontend", "backend", "full"] },
        { href: "/admin/videos", zh: "视频库", en: "Videos", modes: ["frontend", "backend", "full"] },
        { href: "/admin/music", zh: "背景音乐", en: "Music", modes: ["frontend", "backend", "full"] }
      ]
    },
    {
      zh: "抓取",
      en: "Curation",
      items: [
        { href: "/admin/sources", zh: "来源库", en: "Sources", modes: ["backend", "full"] },
        { href: "/admin/modules", zh: "来源模块", en: "Modules", modes: ["backend", "full"] },
        { href: "/admin/auto-curation", zh: "自动主题", en: "Auto Topics", modes: ["backend", "full"] }
      ]
    },
    {
      zh: "系统",
      en: "System",
      items: [
        { href: "/admin/settings", zh: "系统设置", en: "Settings", modes: ["frontend", "backend", "full"] },
        { href: "/admin/sync", zh: "数据同步", en: "Sync", modes: ["frontend", "backend", "full"] }
      ]
    }
  ];

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.modes.includes(mode)) }))
    .filter((group) => group.items.length > 0);
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
        <nav aria-label="Admin">
          {visibleGroups.map((group) => (
            <div className="admin-nav-section" key={group.zh}>
              <div className="admin-nav-heading">
                <I18nText zh={group.zh} en={group.en} />
              </div>
              {group.items.map((item) => (
                <Link href={item.href} key={item.href}>
                  <I18nText zh={item.zh} en={item.en} />
                </Link>
              ))}
            </div>
          ))}
        </nav>
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
