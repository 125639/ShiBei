import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { Icon, ShellMark } from "@/components/public/Icons";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { setRequestLanguage } from "@/lib/i18n-server";
import { withLanguagePrefix } from "@/lib/language";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const language = setRequestLanguage((await params).lang);
  return {
    title: language === "en" ? "About" : "关于拾贝",
    description:
      language === "en"
        ? "An independent space for thoughtful reading and curious minds. Learn how we curate, review and share stories."
        : "一个保持好奇、认真阅读的内容空间。了解我们如何整理、审核与分享内容。",
    alternates: {
      canonical: withLanguagePrefix(language, "/about"),
      languages: { "zh-CN": "/zh/about", en: "/en/about", "x-default": "/zh/about" }
    }
  };
}

export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  setRequestLanguage((await params).lang);
  const { name: siteName } = await getCachedSiteChromeSettings();
  return (
    <main className="publication-container publication-about">
      <section className="publication-about-intro" aria-labelledby="about-title">
        <div>
          <p className="publication-overline">A LITTLE ABOUT US</p>
          <h1 id="about-title">
            <I18nText
              zh={
                <>
                  世界很大，
                  <br />
                  从一点好奇开始。
                </>
              }
              en={
                <>
                  A big world.
                  <br />A little curiosity.
                </>
              }
            />
          </h1>
          <p>
            <I18nText
              zh={`${siteName} 是一个独立的信息整理与阅读空间。我们相信：比知道得更多更重要的，是理解得更深一点。`}
              en={`${siteName} is an independent space for curated information and thoughtful reading. We believe that understanding a little more deeply matters more than simply knowing more.`}
            />
          </p>
          <Link className="publication-text-link" href="/posts">
            <I18nText zh="看看我们最近读到了什么" en="Explore what we have been reading" />
            <Icon name="arrow" width="17" height="17" />
          </Link>
        </div>
        <div className="publication-about-art" aria-hidden="true">
          <span className="about-orbit" />
          <ShellMark />
          <span className="about-art-caption">
            LESS NOISE.
            <br />
            MORE PERSPECTIVE.
          </span>
        </div>
      </section>
      <section className="publication-values" aria-label="Our approach / 我们的方式">
        <article data-reveal>
          <span>01 / CURATE</span>
          <h2>
            <I18nText zh="从信息到理解" en="From information to insight" />
          </h2>
          <p>
            <I18nText
              zh="从网页、RSS 和不同信息源收集线索，补充背景与关联。不是再添一条推送，而是整理出值得花时间读的内容。"
              en="We gather threads from the web, RSS feeds and diverse sources, adding context and connections. Not another notification, but something worth your time."
            />
          </p>
        </article>
        <article data-reveal>
          <span>02 / REVIEW</span>
          <h2>
            <I18nText zh="技术辅助，人来把关" en="Tools assist. People decide." />
          </h2>
          <p>
            <I18nText
              zh="AI 帮助整理信息与草稿，管理员审核后再发布。具体事实请以原始来源为准；相关视频仅用于补充背景材料。"
              en="AI helps organize information and drafts. An admin reviews each post before publication. Verify facts with original sources; related videos provide additional context."
            />
          </p>
        </article>
        <article data-reveal>
          <span>03 / CONNECT</span>
          <h2>
            <I18nText zh="让想法有回声" en="Give ideas a place to grow" />
          </h2>
          <p>
            <I18nText
              zh="你可以自由写作，也可以与 AI 访谈共创。社区作品按题材评分，并且由创作者自己决定是否公开。"
              en="Write independently or co-create through an AI interview. Community works are scored against genre criteria, and creators decide whether to share them."
            />
          </p>
        </article>
      </section>
      <section className="publication-invitation" data-reveal>
        <div>
          <p className="publication-overline">MAKE YOURSELF AT HOME</p>
          <h2>
            <I18nText zh="找到你喜欢的阅读节奏。" en="Find your own reading rhythm." />
          </h2>
          <p>
            <I18nText
              zh="调整主题与字体，用 RSS 订阅更新，或者写下你的第一篇。"
              en="Choose your theme and type, subscribe by RSS, or write your first story."
            />
          </p>
        </div>
        <div className="invitation-actions">
          <Link className="publication-button" href="/settings">
            <I18nText zh="定制阅读体验" en="Make it yours" />
            <Icon name="arrow" width="17" height="17" />
          </Link>
          <a className="publication-text-link" href="/feed.xml">
            <Icon name="rss" width="16" height="16" />
            <I18nText zh="订阅 RSS" en="Subscribe via RSS" />
          </a>
        </div>
      </section>
    </main>
  );
}
