import Link from "next/link";
import { I18nText } from "@/components/I18nText";
import { MusicPlayer } from "@/components/MusicPlayer";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const settings = await getCachedSiteChromeSettings().catch(() => null);

  return (
    <div className="site-shell">
      <a href="#site-main" className="skip-link">
        <I18nText zh="跳到主要内容" en="Skip to main content" />
      </a>
      <header className="site-header site-header-glass">
        <Link className="brand-mark" href="/">
          <strong>{settings?.name || "ShiBei"}</strong>
          <span className="brand-tagline">
            <I18nText zh={settings?.description || "抓取、整理、发布信息"} en="Automated Info Curation & Publishing" />
          </span>
        </Link>
        <nav className="nav" aria-label="Primary">
          <Link href="/posts"><I18nText zh="文章" en="Posts" /></Link>
          <Link href="/videos"><I18nText zh="视频资源" en="Videos" /></Link>
          <Link href="/write"><I18nText zh="写作" en="Write" /></Link>
          <Link href="/stats"><I18nText zh="数据" en="Stats" /></Link>
          <Link href="/about"><I18nText zh="关于" en="About" /></Link>
          <Link href="/settings"><I18nText zh="设置" en="Settings" /></Link>
          <Link href="/admin"><I18nText zh="管理" en="Admin" /></Link>
        </nav>
      </header>
      <div id="site-main" tabIndex={-1}>{children}</div>
      <footer className="site-footer muted">
        <I18nText
          zh="由管理员审核发布。AI 生成内容仅作为信息整理与写作辅助，具体事实请以原始来源为准。"
          en="Published after admin review. AI-generated content is for information organization and writing assistance; verify facts with original sources."
        />
      </footer>
      <MusicPlayer />
    </div>
  );
}
