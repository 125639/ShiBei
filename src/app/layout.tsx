import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";
import "./design-system.css";
import { UserPreferencesScript } from "@/components/UserPreferencesScript";
import { CustomCursor } from "@/components/CustomCursor";
import { NavigationProgress } from "@/components/NavigationProgress";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "@/lib/themes";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const siteName = settings?.name || "拾贝 信息博客";
  const description = settings?.description || "抓取信息、AI 整理、人工审核发布的个人博客。";

  return {
    metadataBase: safeMetadataBase(),
    title: {
      default: siteName,
      template: `%s · ${siteName}`
    },
    description,
    openGraph: {
      type: "website",
      siteName,
      title: siteName,
      description
    }
  };
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

function safeMetadataBase() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // DB may be unreachable at build time (static prerender of e.g. /_not-found)
  // or briefly during startup; fall back to compile-time defaults in that case.
  const settings = await getCachedSiteChromeSettings().catch(() => null);
  const defaultTheme = settings?.defaultTheme ?? DEFAULT_THEME;
  const defaultFont = settings?.defaultFont ?? DEFAULT_FONT;
  const defaultDensity = DEFAULT_DENSITY;
  const defaultLanguage = settings?.defaultLanguage ?? DEFAULT_LANGUAGE;
  const defaultSettingsUI = settings?.defaultSettingsUI ?? "classic";

  return (
    // suppressHydrationWarning: UserPreferencesScript rewrites the data-* attributes
    // from localStorage before React hydrates, so a saved preference that differs
    // from the server-rendered default is expected, not a bug.
    <html
      lang={defaultLanguage === "en" ? "en" : "zh-CN"}
      data-theme={defaultTheme}
      data-font={defaultFont}
      data-density={defaultDensity}
      data-language={defaultLanguage}
      data-ui={defaultSettingsUI}
      suppressHydrationWarning
    >
      <head>
        {/* Child pages replace (rather than deep-merge) Metadata.alternates when
            they declare a canonical URL. Keep the site-wide feed discovery link
            in the root head so it is present on every route and stays relative
            in build-time fallback pages. */}
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
        <UserPreferencesScript
          defaultTheme={defaultTheme}
          defaultFont={defaultFont}
          defaultDensity={defaultDensity}
          defaultLanguage={defaultLanguage}
          defaultSettingsUI={defaultSettingsUI}
        />
      </head>
      <body>
        <NavigationProgress />
        {children}
        <CustomCursor />
      </body>
    </html>
  );
}
