import Link from "next/link";
import { ActiveLink } from "@/components/ActiveLink";
import { FFCalendar } from "@/components/FFCalendar";
import { I18nText } from "@/components/I18nText";
import { AppearancePanel } from "@/components/AppearancePanel";
import { MusicPlayer } from "@/components/MusicPlayer";
import { RouteDisclosure } from "@/components/RouteDisclosure";
import { SiteAssistant } from "@/components/SiteAssistant";
import { VisitBeacon } from "@/components/VisitBeacon";
import { getCachedFireflyWidgetData } from "@/lib/firefly-widgets";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";

const PRIMARY_NAV_ITEMS: Array<{ href: string; zh: string; en: string; match: "exact" | "prefix" }> = [
  { href: "/", zh: "首页", en: "Home", match: "exact" },
  { href: "/posts", zh: "文章", en: "Posts", match: "prefix" },
  { href: "/create", zh: "共创", en: "Co-create", match: "prefix" },
  { href: "/community", zh: "社区", en: "Community", match: "prefix" },
  { href: "/admin/login", zh: "管理员后台", en: "Admin", match: "prefix" }
];

const EXPLORE_NAV_ITEMS: Array<{ href: string; zh: string; en: string; match: "exact" | "prefix" }> = [
  { href: "/write", zh: "写作工作台", en: "Writing workspace", match: "prefix" },
  { href: "/stats", zh: "内容数据", en: "Content stats", match: "prefix" },
  { href: "/about", zh: "关于本站", en: "About", match: "prefix" },
  { href: "/settings", zh: "阅读设置", en: "Preferences", match: "prefix" }
];

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const [settings, widgets] = await Promise.all([
    getCachedSiteChromeSettings().catch(() => null),
    getCachedFireflyWidgetData().catch(() => null)
  ]);
  const siteName = settings?.name || "ShiBei";
  const siteDescription = settings?.description || "抓取、整理、发布信息";

  return (
    <div className="site-shell">
      <a href="#site-main" className="skip-link">
        <I18nText zh="跳到主要内容" en="Skip to main content" />
      </a>
      <header className="site-header site-header-glass">
        <Link className="brand-mark" href="/">
          <span className="brand-symbol" aria-hidden="true">拾</span>
          <span className="brand-copy">
            <strong>{siteName}</strong>
            <span className="brand-tagline">
              <I18nText zh={siteDescription} en="Curated ideas, clearly presented" />
            </span>
          </span>
        </Link>
        <nav className="nav" aria-label="主导航 / Primary navigation">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <ActiveLink key={item.href} href={item.href} match={item.match}>
              <I18nText zh={item.zh} en={item.en} />
            </ActiveLink>
          ))}
          <RouteDisclosure className="nav-more">
            <summary>
              <I18nText zh="探索" en="Explore" />
              <span className="nav-more-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="nav-more-menu">
              <span className="nav-more-label"><I18nText zh="更多空间" en="More spaces" /></span>
              {EXPLORE_NAV_ITEMS.map((item) => (
                <ActiveLink key={item.href} href={item.href} match={item.match}>
                  <I18nText zh={item.zh} en={item.en} />
                  <span aria-hidden="true">↗</span>
                </ActiveLink>
              ))}
            </div>
          </RouteDisclosure>
        </nav>
        <div className="header-actions" aria-label="账户与显示偏好 / Account and display preferences">
          <Link
            className="header-account-link"
            href="/account"
            aria-label="用户登录或账户 / Member sign-in or account"
          >
            <span className="header-account-icon" aria-hidden="true">{ICONS.user}</span>
            <I18nText zh="用户登录 / 账户" en="Member sign-in" />
          </Link>
          <AppearancePanel
            siteDefaults={{
              theme: settings?.defaultTheme,
              font: settings?.defaultFont,
              density: settings?.defaultDensity,
              language: settings?.defaultLanguage,
              ui: settings?.defaultSettingsUI
            }}
          />
        </div>
      </header>

      {/* Firefly 专属壁纸横幅：仅 data-ui="firefly" 时由 CSS 显示 */}
      <div className="ff-banner">
        <div className="ff-banner-inner">
          <span className="ff-banner-title">{siteName}</span>
          <span className="ff-banner-motto">
            <I18nText zh={siteDescription} en="Automated Info Curation & Publishing" />
          </span>
        </div>
      </div>

      {/* 非 firefly 风格下 .ff-body 是 display:contents、侧栏 display:none，布局与以前完全一致 */}
      <div className="ff-body">
        <aside className="ff-rail ff-rail-left" aria-label="Profile & taxonomy widgets">
          <section className="ff-widget ff-profile">
            <span className="ff-avatar" aria-hidden>{siteName.slice(0, 1).toUpperCase()}</span>
            <strong className="ff-profile-name">{siteName}</strong>
            <p className="ff-profile-bio">
              <I18nText zh={siteDescription} en="Automated Info Curation & Publishing" />
            </p>
            <div className="ff-profile-links">
              <a href="/feed.xml" title="RSS" aria-label="RSS">{ICONS.rss}</a>
              <a href="/sitemap.xml" title="Sitemap" aria-label="Sitemap">{ICONS.map}</a>
              <Link href="/about" title="About" aria-label="About">{ICONS.user}</Link>
            </div>
          </section>

          <section className="ff-widget">
            <h2 className="ff-widget-title"><I18nText zh="公告" en="Notice" /></h2>
            <p className="ff-widget-text">
              <I18nText
                zh="欢迎来到拾贝！最新整理的文章会持续在这里更新。"
                en="Welcome to ShiBei! Recently curated posts are updated here."
              />
            </p>
          </section>

          {widgets && widgets.categories.length > 0 ? (
            <section className="ff-widget">
              <h2 className="ff-widget-title"><I18nText zh="分类" en="Categories" /></h2>
              <nav className="ff-category-list" aria-label="Categories">
                {widgets.categories.slice(0, 8).map((category) => (
                  <Link key={category.id} href={`/posts?topic=${encodeURIComponent(category.slug)}`}>
                    <span>{category.name}</span>
                    <span className="ff-count">{category.count}</span>
                  </Link>
                ))}
              </nav>
            </section>
          ) : null}

          {widgets && widgets.tags.length > 0 ? (
            <section className="ff-widget">
              <h2 className="ff-widget-title"><I18nText zh="标签" en="Tags" /></h2>
              <div className="ff-tag-cloud">
                {widgets.tags.map((tag) => (
                  <Link key={tag.id} href={`/posts?q=${encodeURIComponent(tag.name)}`}>{tag.name}</Link>
                ))}
              </div>
            </section>
          ) : null}
        </aside>

        <div id="site-main" tabIndex={-1}>
          <VisitBeacon />
          {children}
        </div>

        <aside className="ff-rail ff-rail-right" aria-label="Site stats widgets">
          {widgets ? (
            <section className="ff-widget">
              <h2 className="ff-widget-title"><I18nText zh="站点统计" en="Site Stats" /></h2>
              <dl className="ff-stat-list">
                <div>
                  <dt>{ICONS.doc}<I18nText zh="文章" en="Posts" /></dt>
                  <dd>{widgets.stats.posts}</dd>
                </div>
                <div>
                  <dt>{ICONS.folder}<I18nText zh="分类" en="Categories" /></dt>
                  <dd>{widgets.stats.categories}</dd>
                </div>
                <div>
                  <dt>{ICONS.tag}<I18nText zh="标签" en="Tags" /></dt>
                  <dd>{widgets.stats.tags}</dd>
                </div>
                <div>
                  <dt>{ICONS.text}<I18nText zh="总字数" en="Characters" /></dt>
                  <dd>{formatChars(widgets.stats.totalChars)}</dd>
                </div>
                {widgets.stats.runDays > 0 ? (
                  <div>
                    <dt>{ICONS.clock}<I18nText zh="运行时长" en="Running" /></dt>
                    <dd><I18nText zh={`${widgets.stats.runDays} 天`} en={`${widgets.stats.runDays} d`} /></dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          <MiniCalendar lastPublishedAt={widgets?.stats.lastPublishedAt ?? null} />

          <section className="ff-widget">
            <h2 className="ff-widget-title"><I18nText zh="站点信息" en="Site Info" /></h2>
            <dl className="ff-fact-list">
              <div>
                <dt><I18nText zh="内容" en="Content" /></dt>
                <dd><I18nText zh="文章 / 数据 / 共创" en="Posts / Stats / Co-creation" /></dd>
              </div>
              <div>
                <dt><I18nText zh="模式" en="Mode" /></dt>
                <dd><I18nText zh="审核发布" en="Reviewed publishing" /></dd>
              </div>
              <div>
                <dt><I18nText zh="订阅" en="Feeds" /></dt>
                <dd><a href="/feed.xml">RSS</a> · <a href="/sitemap.xml">Sitemap</a></dd>
              </div>
            </dl>
          </section>

        </aside>
      </div>

      {/* data-brand: Meow 风格用 CSS attr() 渲染页脚巨型水印字 */}
      <footer className="site-footer muted" data-brand={siteName}>
        <p className="site-footer-note">
          <I18nText
            zh="由管理员审核发布。AI 生成内容仅作为信息整理与写作辅助，具体事实请以原始来源为准。"
            en="Published after admin review. AI-generated content is for information organization and writing assistance; verify facts with original sources."
          />
        </p>
        <p className="site-footer-meta">
          <span>© {new Date().getFullYear()} {siteName}</span>
          <a href="/feed.xml" className="text-link">RSS</a>
          <a href="/sitemap.xml" className="text-link">Sitemap</a>
        </p>
      </footer>
      <MusicPlayer />
      <SiteAssistant siteName={siteName} siteDescription={siteDescription} />
    </div>
  );
}

function formatChars(total: number): string {
  if (total >= 10_000) return `${(total / 10_000).toFixed(1)}w`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}

/** 可翻月日历：交互在 FFCalendar（client），这里只把服务端时间拆成纯数字防水合错位 */
function MiniCalendar({ lastPublishedAt }: { lastPublishedAt: string | null }) {
  const now = new Date();
  const lastPublished = lastPublishedAt ? new Date(lastPublishedAt) : null;

  return (
    <FFCalendar
      todayYear={now.getFullYear()}
      todayMonth={now.getMonth()}
      todayDay={now.getDate()}
      publishedYear={lastPublished?.getFullYear() ?? null}
      publishedMonth={lastPublished?.getMonth() ?? null}
      publishedDay={lastPublished?.getDate() ?? null}
    />
  );
}

/** 16px 线性小图标（Firefly 侧栏统计风格） */
const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true
} as const;

const ICONS = {
  doc: (
    <svg {...ICON_PROPS}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  folder: (
    <svg {...ICON_PROPS}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  tag: (
    <svg {...ICON_PROPS}>
      <path d="M20.59 13.41 12 22 2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.4" />
    </svg>
  ),
  text: (
    <svg {...ICON_PROPS}>
      <path d="M4 7V5h16v2M9 20h6M12 5v15" />
    </svg>
  ),
  clock: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  rss: (
    <svg {...ICON_PROPS}>
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  map: (
    <svg {...ICON_PROPS}>
      <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  user: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  )
};
