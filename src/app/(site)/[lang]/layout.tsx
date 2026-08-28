import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "@fontsource-variable/noto-sans-sc";
import "../../globals.css";
import "../../design-system.css";
import "../../ui-polish.css";
import { UserPreferencesScript } from "@/components/UserPreferencesScript";
import { CustomCursor } from "@/components/CustomCursor";
import { NavigationProgress } from "@/components/NavigationProgress";
import { LanguageProvider } from "@/components/I18nTextClient";
import { PublicShell } from "@/components/PublicShell";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isLanguageKey,
  withLanguagePrefix,
  type LanguageKey
} from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "@/lib/themes";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { siteOrigin } from "@/lib/site-url";

// 两个语种都是编译期已知的，预渲染出来即可。
//
// 刻意**不**设 dynamicParams = false：单段路径（/favicon.ico、
// /apple-touch-icon.png 等浏览器默认请求）会被 [lang] 捕获成 lang="favicon.ico"，
// 而 dynamicParams=false 下 Next 对未预渲染的参数抛 Internal: NoFallbackError
// 而不是走 404。下面 layout 里的 isLanguageKey 守卫会用 notFound() 干净地
// 处理这些值，代价只是给垃圾路径多一次按需渲染。
export function generateStaticParams(): Array<{ lang: LanguageKey }> {
  return SUPPORTED_LANGUAGES.map((lang) => ({ lang }));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1320" }
  ]
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const language: LanguageKey = isLanguageKey(lang) ? lang : DEFAULT_LANGUAGE;
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const siteName = settings?.name || "拾贝 信息博客";
  const description = settings?.description || "抓取信息、AI 整理、人工审核发布的个人博客。";

  return {
    metadataBase: new URL(siteOrigin()),
    title: {
      default: siteName,
      template: `%s · ${siteName}`
    },
    description,
    // 每个语种都有独立 URL，必须成对声明 hreflang，否则搜索引擎无从知道
    // /zh/... 与 /en/... 是同一内容的不同语言版本。
    alternates: {
      canonical: withLanguagePrefix(language, "/"),
      languages: {
        "zh-CN": withLanguagePrefix("zh", "/"),
        en: withLanguagePrefix("en", "/"),
        "x-default": withLanguagePrefix(DEFAULT_LANGUAGE, "/")
      }
    },
    openGraph: {
      type: "website",
      siteName,
      title: siteName,
      description,
      locale: language === "en" ? "en_US" : "zh_CN"
    }
  };
}

export default async function SiteRootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLanguageKey(lang)) notFound();
  // 供本请求内所有服务端组件的 I18nText 读取（见 lib/i18n-server.ts）。
  const language = setRequestLanguage(lang);

  // DB may be unreachable at build time (static prerender) or briefly during
  // startup; fall back to compile-time defaults in that case.
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const defaultTheme = settings?.defaultTheme ?? DEFAULT_THEME;
  const defaultFont = settings?.defaultFont ?? DEFAULT_FONT;
  const defaultDensity = DEFAULT_DENSITY;
  const defaultSettingsUI = settings?.defaultSettingsUI ?? "classic";

  return (
    // suppressHydrationWarning: UserPreferencesScript rewrites theme/font/density
    // from localStorage before React hydrates. 语言不在其列——语言由 URL 决定，
    // 服务端渲染即为最终值，不存在闪动也不需要客户端纠正。
    <html
      lang={language === "en" ? "en" : "zh-CN"}
      data-theme={defaultTheme}
      data-font={defaultFont}
      data-density={defaultDensity}
      data-language={language}
      data-ui={defaultSettingsUI}
      suppressHydrationWarning
    >
      <head>
        {/* Child pages replace (rather than deep-merge) Metadata.alternates when
            they declare a canonical URL. Keep the site-wide feed discovery link
            in the root head so it is present on every route. */}
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
        <UserPreferencesScript
          defaultTheme={defaultTheme}
          defaultFont={defaultFont}
          defaultDensity={defaultDensity}
          defaultSettingsUI={defaultSettingsUI}
        />
      </head>
      <body>
        <LanguageProvider language={language}>
          <NavigationProgress />
          <PublicShell>{children}</PublicShell>
          <CustomCursor />
        </LanguageProvider>
      </body>
    </html>
  );
}
