import Link from "next/link";
import { ActiveLink } from "./ActiveLink";
import { AdminLanguageToggle } from "./AdminLanguageToggle";
import { I18nText } from "./I18nText";
import { RouteDisclosure } from "./RouteDisclosure";
import { UpdateNotifier } from "./UpdateNotifier";
import { UpdateNavBadge } from "./UpdateNavBadge";
import { getAppMode } from "@/lib/app-mode";

type AppMode = "frontend" | "backend" | "full";
type NavItem = { href: string; zh: string; en: string; modes: AppMode[] };
type NavGroup = { zh: string; en: string; items: NavItem[] };

// 后台导航按工作流分组；桌面侧栏与移动菜单复用同一份信息架构。
const NAV_GROUPS: NavGroup[] = [
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
      { href: "/admin/ai", zh: "AI 管理员", en: "AI Admin", modes: ["backend", "full"] },
      { href: "/admin/comments", zh: "评论管理", en: "Comments", modes: ["frontend", "full"] },
      { href: "/admin/invites", zh: "邀请码", en: "Invites", modes: ["frontend", "full"] },
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

export function AdminShell({ children }: { children: React.ReactNode }) {
  const mode = getAppMode();
  const visibleGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => item.modes.includes(mode)) }))
    .filter((group) => group.items.length > 0);
  const showFrontLink = mode !== "backend";

  return (
    <div className="admin-layout">
      <UpdateNotifier />
      <a href="#admin-main" className="skip-link">
        <I18nText zh="跳到主要内容" en="Skip to main content" />
      </a>

      <aside className="admin-sidebar admin-sidebar-desktop" id="admin-sidebar">
        <AdminBrand mode={mode} />
        <AdminNavigation groups={visibleGroups} variant="desktop" />
        <div className="admin-sidebar-footer">
          <AdminLanguageToggle />
          <AdminUtilityActions showFrontLink={showFrontLink} variant="desktop" />
        </div>
      </aside>

      {/* 原生 details/summary 在脚本失效时仍可完整使用。 */}
      <header className="admin-mobile-header">
        <Link className="admin-mobile-brand" href="/admin">
          <span className="admin-brand-mark" aria-hidden="true">拾</span>
          <span className="admin-mobile-brand-copy">
            <strong>ShiBei Admin</strong>
            <span><I18nText zh="管理工作区" en="Workspace" /></span>
          </span>
          {mode !== "full" ? <ModeBadge mode={mode} /> : null}
        </Link>
        <RouteDisclosure className="admin-mobile-menu">
          <summary className="admin-mobile-menu-trigger">
            <span className="admin-mobile-menu-icon" aria-hidden="true">☰</span>
            <span><I18nText zh="菜单" en="Menu" /></span>
            <span className="admin-mobile-menu-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="admin-mobile-menu-panel">
            <AdminNavigation groups={visibleGroups} variant="mobile" />
            <div className="admin-mobile-menu-footer">
              <AdminLanguageToggle />
              <AdminUtilityActions showFrontLink={showFrontLink} variant="mobile" />
            </div>
          </div>
        </RouteDisclosure>
      </header>

      <main className="admin-main" id="admin-main" tabIndex={-1}>{children}</main>
    </div>
  );
}

function AdminBrand({ mode }: { mode: AppMode }) {
  return (
    <h1 className="admin-brand">
      <span className="admin-brand-mark" aria-hidden="true">拾</span>
      <span className="admin-brand-text">ShiBei Admin</span>
      {mode !== "full" ? <ModeBadge mode={mode} /> : null}
    </h1>
  );
}

function ModeBadge({ mode }: { mode: Exclude<AppMode, "full"> }) {
  return <span className="tag admin-mode-badge">{mode}</span>;
}

function AdminNavigation({ groups, variant }: { groups: NavGroup[]; variant: "desktop" | "mobile" }) {
  const mobile = variant === "mobile";

  return (
    <nav className={mobile ? "admin-mobile-nav" : "admin-desktop-nav"} aria-label="后台导航 / Admin navigation">
      {groups.map((group) => (
        <section className={mobile ? "admin-mobile-nav-section" : "admin-nav-section"} key={group.zh}>
          <h2 className={mobile ? "admin-mobile-nav-heading" : "admin-nav-heading"}>
            <I18nText zh={group.zh} en={group.en} />
          </h2>
          <div className={mobile ? "admin-mobile-nav-links" : "admin-nav-links"}>
            {group.items.map((item) => (
              <ActiveLink
                className={mobile ? "admin-mobile-nav-link" : undefined}
                href={item.href}
                key={item.href}
                match={item.href === "/admin" ? "exact" : "prefix"}
              >
                <I18nText zh={item.zh} en={item.en} />
                {item.href === "/admin/update" ? <UpdateNavBadge /> : null}
              </ActiveLink>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

function AdminUtilityActions({
  showFrontLink,
  variant
}: {
  showFrontLink: boolean;
  variant: "desktop" | "mobile";
}) {
  const mobile = variant === "mobile";

  return (
    <div className={mobile ? "admin-mobile-actions" : "admin-sidebar-actions"}>
      {showFrontLink ? (
        <Link className={mobile ? "admin-mobile-action" : undefined} href="/">
          <I18nText zh="返回前台" en="Back to Site" />
        </Link>
      ) : null}
      <form action="/api/admin/logout" method="post">
        <button className={mobile ? "admin-mobile-action" : undefined} type="submit">
          <I18nText zh="退出登录" en="Logout" />
        </button>
      </form>
    </div>
  );
}
