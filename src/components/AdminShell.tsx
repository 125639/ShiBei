import { AdminIcon } from "./admin/icons";
import { AdminLanguageToggle } from "./AdminLanguageToggle";
import { AdminNavLink } from "./admin/AdminNavLink";
import { AdminTopbar } from "./admin/AdminTopbar";
import { I18nText } from "./I18nText";
import { LocalizedLink as Link } from "./LocalizedLink";
import { RouteDisclosure } from "./RouteDisclosure";
import { UpdateNotifier } from "./UpdateNotifier";
import { UpdateNavBadge } from "./UpdateNavBadge";
import { appModeSupports, getAppMode, type AppMode } from "@/lib/app-mode";
import { ADMIN_NAV_GROUPS, type AdminNavGroup } from "@/lib/admin-nav";
import { getSessionUsername } from "@/lib/auth";
import { getBuildInfo } from "@/lib/build-info";

export async function AdminShell({ children }: { children: React.ReactNode }) {
  const mode = getAppMode();
  const visibleGroups = ADMIN_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        (!item.modes || item.modes.includes(mode))
        && (!item.capability || appModeSupports(mode, item.capability))
      )
    }))
    .filter((group) => group.items.length > 0);
  const showFrontLink = mode !== "backend";
  const username = await getSessionUsername();
  const buildInfo = getBuildInfo();
  const displayName = username || "admin";

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
          <div className="admin-sidebar-status">
            <span className="admin-status-dot" aria-hidden="true" />
            <span>
              <I18nText zh="系统在线" en="System online" />
            </span>
            <span className="admin-sidebar-version">
              {buildInfo.commit && buildInfo.commit !== "unknown" ? buildInfo.commit.slice(0, 7) : "dev"}
            </span>
          </div>
          <div className="admin-user-card">
            <span className="admin-user-avatar" aria-hidden="true">{displayName.slice(0, 1)}</span>
            <span className="admin-user-meta">
              <strong>{displayName}</strong>
              <span>
                <I18nText zh="管理员" en="Administrator" />
              </span>
            </span>
            <form action="/api/admin/logout" method="post">
              <button className="admin-user-logout" type="submit" title="退出登录 / Log out">
                <AdminIcon name="logout" size={15} />
                <span className="sr-only">
                  <I18nText zh="退出登录" en="Log out" />
                </span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* 原生 details/summary 在脚本失效时仍可完整使用。
          DOM 顺序：侧栏 → 移动头 → 主列，保证移动端单列布局时移动头在内容之上。 */}
      <header className="admin-mobile-header">
        <Link className="admin-mobile-brand" href="/admin">
          <AdminBrand mode={mode} variant="mobile" />
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

      <div className="admin-shell-main">
        <AdminTopbar mode={mode} showFrontLink={showFrontLink}>
          <AdminLanguageToggle />
        </AdminTopbar>
        <main className="admin-main" id="admin-main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

function AdminBrand({ mode, variant = "desktop" }: { mode: AppMode; variant?: "desktop" | "mobile" }) {
  const content = (
    <>
      <span className="admin-brand-mark" aria-hidden="true">拾</span>
      {variant === "mobile" ? (
        <span className="admin-mobile-brand-copy">
          <strong>ShiBei Admin</strong>
          <span><I18nText zh="管理工作区" en="Workspace" /></span>
        </span>
      ) : (
        <span className="admin-brand-text">ShiBei Admin</span>
      )}
      {mode !== "full" ? <ModeBadge mode={mode} /> : null}
    </>
  );
  if (variant === "mobile") return content;
  return <div className="admin-brand">{content}</div>;
}

function ModeBadge({ mode }: { mode: Exclude<AppMode, "full"> }) {
  return <span className="tag admin-mode-badge">{mode}</span>;
}

function AdminNavigation({ groups, variant }: { groups: AdminNavGroup[]; variant: "desktop" | "mobile" }) {
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
              <AdminNavLink
                className={mobile ? "admin-mobile-nav-link" : undefined}
                href={item.href}
                icon={mobile ? undefined : item.icon}
                key={item.href}
              >
                <I18nText zh={item.zh} en={item.en} />
                {item.href === "/admin/update" ? <UpdateNavBadge /> : null}
              </AdminNavLink>
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
  variant: "mobile";
}) {
  return (
    <div className="admin-mobile-actions">
      {showFrontLink ? (
        <Link className="admin-mobile-action" href="/">
          <I18nText zh="返回前台" en="Back to Site" />
        </Link>
      ) : null}
      <form action="/api/admin/logout" method="post">
        <button className="admin-mobile-action" type="submit">
          <I18nText zh="退出登录" en="Logout" />
        </button>
      </form>
    </div>
  );
}
