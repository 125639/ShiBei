import Link from "next/link";
import { ActiveLink } from "./ActiveLink";
import { AdminLanguageToggle } from "./AdminLanguageToggle";
import { I18nText } from "./I18nText";
import { UpdateNotifier } from "./UpdateNotifier";
import { UpdateNavBadge } from "./UpdateNavBadge";
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
      zh: "信息采集",
      en: "Curation",
      items: [
        { href: "/admin/sources", zh: "来源库", en: "Sources", modes: ["backend", "full"] },
        { href: "/admin/modules", zh: "来源模块", en: "Modules", modes: ["backend", "full"] },
        { href: "/admin/auto-curation", zh: "自动内容", en: "Auto-Curation", modes: ["backend", "full"] }
      ]
    },
    {
      zh: "系统",
      en: "System",
      items: [
        { href: "/admin/settings", zh: "系统设置", en: "Settings", modes: ["frontend", "backend", "full"] },
        { href: "/admin/sync", zh: "数据同步", en: "Sync", modes: ["frontend", "backend", "full"] },
        { href: "/admin/update", zh: "系统更新", en: "Update", modes: ["frontend", "backend", "full"] }
      ]
    }
  ];

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.modes.includes(mode)) }))
    .filter((group) => group.items.length > 0);
  const showFrontLink = mode !== "backend";

  return (
    <div className="admin-layout">
      {/* GitHub 有新版本时的左上角提示弹窗（叉掉后仍可从「系统更新」页更新） */}
      <UpdateNotifier />
      <a href="#admin-main" className="skip-link">
        <I18nText zh="跳到主要内容" en="Skip to main content" />
      </a>
      {/* 窄视口下侧边栏由 CSS 变为常驻 sticky 顶栏（见 globals.css ≤960px 块），
          不再使用隐藏式抽屉 + 汉堡按钮。 */}
      <aside className="admin-sidebar" id="admin-sidebar">
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
                <h2 className="admin-nav-heading">
                  <I18nText zh={group.zh} en={group.en} />
                </h2>
                {group.items.map((item) => (
                  // /admin 用精确匹配，否则仪表盘在所有后台子页都会高亮
                  <ActiveLink href={item.href} key={item.href} match={item.href === "/admin" ? "exact" : "prefix"}>
                    <I18nText zh={item.zh} en={item.en} />
                    {item.href === "/admin/update" ? <UpdateNavBadge /> : null}
                  </ActiveLink>
                ))}
              </div>
            ))}
          </nav>
          <AdminLanguageToggle />
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
      <main className="admin-main" id="admin-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
