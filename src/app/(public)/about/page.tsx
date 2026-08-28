import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";

// 站点名来自共享的 site-chrome 缓存（site-settings 标签，保存设置即失效）；
// 整页 ISR 复用 HTML，不再每请求查库。
export const revalidate = 300;

export const metadata: Metadata = {
  title: "关于",
  description: "关于这个信息整理博客：抓取、AI 整理、人工审核后发布。",
  alternates: { canonical: "/about" }
};

export default async function AboutPage() {
  const { name: siteName } = await getCachedSiteChromeSettings();

  return (
    <main className="container bento-page public-list-page about-page">
      <article className="prose page-intro bento-card bento-wide">
        <h1><I18nText zh="关于这个博客" en="About this blog" /></h1>
        <p>
          <I18nText
            zh={`${siteName} 是一个面向个人使用的信息整理博客。管理员可以接入 OpenAI-compatible 模型，选择默认或临时信息源，抓取网页与 RSS 内容，生成待审核草稿后再发布。`}
            en={`${siteName} is a personal information-curation blog. The admin connects OpenAI-compatible models, picks default or ad-hoc sources, fetches web pages and RSS feeds, and publishes drafts only after review.`}
          />
        </p>
        <p>
          <I18nText
            zh="这个系统强调人工审核：AI 负责提高整理效率，最终发布内容由管理员确认。公开视频资源可以与文章关联，用于补充背景材料或形成视频博客。"
            en="Human review comes first: AI speeds up curation, while the admin signs off on everything published. Public video resources can be linked to posts as background material or as a video blog."
          />
        </p>
      </article>
    </main>
  );
}
