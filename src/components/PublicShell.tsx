import Link from "next/link";
import { unstable_cache } from "next/cache";
import { I18nText } from "@/components/I18nText";
import { MusicPlayer } from "@/components/MusicPlayer";
import { prisma } from "@/lib/prisma";

// Cache the rarely-changing site settings used by every public page.
// Tag-based revalidation: site-settings/* update calls revalidateTag("site-settings").
const getSiteSettings = unstable_cache(
  async () => prisma.siteSettings.findUnique({ where: { id: "site" } }),
  ["public-site-settings"],
  { revalidate: 60, tags: ["site-settings"] }
);

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings().catch(() => null);

  return (
    <div className="site-shell">
      <header className="site-header site-header-glass">
        <Link className="brand-mark" href="/">
          <strong>{settings?.name || "ShiBei"}</strong>
          <span className="brand-tagline">
            <I18nText zh={settings?.description || "抓取、整理、发布信息"} en="Automated Info Curation & Publishing" />
          </span>
        </Link>
        <nav className="nav">
          <Link href="/news"><I18nText zh="新闻总结" en="News" /></Link>
          <Link href="/videos"><I18nText zh="视频资源" en="Videos" /></Link>
          <Link href="/write"><I18nText zh="写作" en="Write" /></Link>
          <Link href="/stats"><I18nText zh="数据" en="Stats" /></Link>
          <Link href="/about"><I18nText zh="关于" en="About" /></Link>
          <Link href="/settings"><I18nText zh="设置" en="Settings" /></Link>
          <Link href="/admin"><I18nText zh="管理" en="Admin" /></Link>
        </nav>
      </header>
      {children}
      <footer className="site-footer muted">
        <I18nText
          zh="由管理员审核发布。AI 总结仅作为信息整理辅助，具体事实请以原始来源为准。"
          en="Published after admin review. AI summaries are for information organization only; verify facts with original sources."
        />
      </footer>
      <MusicPlayer />
    </div>
  );
}
