import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";
import { UserPreferencesScript } from "@/components/UserPreferencesScript";
import { CustomCursor } from "@/components/CustomCursor";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { DEFAULT_DENSITY, DEFAULT_FONT, DEFAULT_THEME } from "@/lib/themes";

export const metadata: Metadata = {
  metadataBase: safeMetadataBase(),
  title: "拾贝 信息博客",
  description: "抓取信息、AI 整理、人工审核发布的个人博客。",
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml"
    }
  }
};

function safeMetadataBase() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const defaultTheme = DEFAULT_THEME;
  const defaultFont = DEFAULT_FONT;
  const defaultDensity = DEFAULT_DENSITY;
  const defaultLanguage = DEFAULT_LANGUAGE;
  const defaultSettingsUI = "classic";

  return (
    <html lang={defaultLanguage === "en" ? "en" : "zh-CN"} data-theme={defaultTheme} data-font={defaultFont} data-density={defaultDensity} data-language={defaultLanguage} data-ui={defaultSettingsUI}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#9f4f2f" />
        <UserPreferencesScript
          defaultTheme={defaultTheme}
          defaultFont={defaultFont}
          defaultDensity={defaultDensity}
          defaultLanguage={defaultLanguage}
          defaultSettingsUI={defaultSettingsUI}
        />
      </head>
      <body>
        {children}
        <CustomCursor />
      </body>
    </html>
  );
}
