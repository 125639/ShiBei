import { notFound } from "next/navigation";
import { LocalizedLink as Link } from "@/components/LocalizedLink";
import type { Metadata } from "next";
import { ArticleToc } from "@/components/ArticleToc";
import { ReadingTools } from "@/components/public/ReadingTools";
import { readingMinutes } from "@/lib/reading-time";
import { LanguageAwarePost } from "@/components/LanguageAwarePost";
import { PostComments } from "@/components/PostComments";
import { AssistantPageContext } from "@/components/AssistantPageContext";
import { I18nText } from "@/components/I18nText";
import { prisma } from "@/lib/prisma";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { absoluteSiteUrl } from "@/lib/site-url";
import { DEFAULT_LANGUAGE, isLanguageKey, withLanguagePrefix, type LanguageKey } from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";
import { VideoEmbed } from "@/lib/video";
import { VIDEO_SHORTCODE_RE } from "@/lib/video-display";
import { markdownToHtml, type VideoForShortcode } from "@/lib/markdown";
import { stripTitleHeading, summaryDuplicatesContentLead } from "@/lib/post-derive";
import "katex/dist/katex.min.css";

// ISR：整页缓存 5 分钟，管理端的每次内容变更都会用具体路径调
// revalidatePublicContent([`/posts/${slug}`]) 精准失效（含批量/图片/视频路由），
// 翻译写入与站点设置保存也各自失效，所以不会再出现「编辑后旧页面冻结」的问题
// ——那正是这里曾经 force-dynamic 的原因；换成 ISR 后 TTFB 从每次全查库变为直出缓存。
export const revalidate = 300;

// 必须同时导出 generateStaticParams（哪怕为空）revalidate 才会生效：没有它
// Next 会把动态段路由当作纯动态每次渲染（实测 .next/server/app 下无缓存工件、
// 响应 no-store）。返回空数组＝构建时不预渲染（构建机可能连不上库），
// 运行时首次访问按需渲染并缓存，之后 5 分钟内直出。
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [];
}

const ARTICLE_VIDEO_SELECT = {
  id: true,
  title: true,
  type: true,
  url: true,
  displayMode: true,
  summary: true,
  sourcePageUrl: true,
  sourcePlatform: true,
  attribution: true,
  durationSec: true
} as const;

export async function generateMetadata({
  params
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  const language: LanguageKey = isLanguageKey(lang) ? lang : DEFAULT_LANGUAGE;
  const [post, settings] = await Promise.all([
    prisma.post.findFirst({
      where: { slug: { in: getSlugCandidates(slug) }, status: "PUBLISHED", publicationBlockedReason: null },
      select: { slug: true, title: true, titleEn: true, summary: true, summaryEn: true, publishedAt: true, updatedAt: true }
    }),
    getCachedSiteChromeSettings().catch(() => null)
  ]);
  // Fail before the streamed page body starts. If only the page component calls
  // notFound(), Next may already have committed a 200 response and merely render
  // the 404 boundary inside it. Besides confusing clients, that lets missing
  // article URLs be indexed as successful pages.
  if (!post) notFound();

  // 标题/描述按当前语种给出：搜索结果里 /en/posts/x 应该显示英文标题，
  // 否则英文版即使被收录，展示出来的仍是中文摘要。
  const title = (language === "en" ? post.titleEn : post.title) || post.title;
  const summary = (language === "en" ? post.summaryEn : post.summary) || post.summary;
  const description = summary.slice(0, 180);
  const path = `/posts/${post.slug}`;
  const url = absoluteSiteUrl(withLanguagePrefix(language, path));
  const siteName = settings?.name || "ShiBei";

  return {
    // 只给裸标题：站点名由 [lang]/layout.tsx 的 title.template 统一追加为
    // 「%s · 站名」。此前这里又拼了一次 `| ${siteName}`，于是文章页标题变成
    // 「标题 | 站名 · 站名」——浏览器标签与搜索结果里重复，且本页的站名兜底
    // （"ShiBei"）与布局的兜底（"拾贝 信息博客"）不一致，空设置下更混乱。
    title,
    description,
    alternates: {
      canonical: url,
      // 两个语种互指，并给出 x-default，避免被判为重复内容。
      languages: {
        "zh-CN": absoluteSiteUrl(withLanguagePrefix("zh", path)),
        en: absoluteSiteUrl(withLanguagePrefix("en", path)),
        "x-default": absoluteSiteUrl(withLanguagePrefix(DEFAULT_LANGUAGE, path))
      }
    },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString()
    },
    twitter: {
      card: "summary",
      title,
      description
    }
  };
}

function collectShortcodedVideoIds(...sources: Array<string | null | undefined>): Set<string> {
  const ids = new Set<string>();
  for (const text of sources) {
    if (!text) continue;
    let match: RegExpExecArray | null;
    VIDEO_SHORTCODE_RE.lastIndex = 0;
    while ((match = VIDEO_SHORTCODE_RE.exec(text)) !== null) {
      ids.add(match[1]);
    }
  }
  return ids;
}

export default async function PostDetailPage({
  params
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  // generateMetadata 与页面组件是两个独立的渲染 pass，布局里的
  // setRequestLanguage 不一定覆盖到这里；页面自己再设一次是幂等的。
  const language = setRequestLanguage(lang);
  const [post, settings] = await Promise.all([
    prisma.post.findFirst({
      where: {
        slug: {
          in: getSlugCandidates(slug)
        },
        status: "PUBLISHED",
        publicationBlockedReason: null
      },
      select: {
        id: true,
        slug: true,
        status: true,
        title: true,
        titleEn: true,
        summary: true,
        summaryEn: true,
        content: true,
        contentEn: true,
        sourceUrl: true,
        publishedAt: true,
        sortOrder: true,
        tags: { select: { id: true, name: true } },
        videos: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
          select: ARTICLE_VIDEO_SELECT
        },
        topics: { select: { id: true, name: true, slug: true } }
      }
    }),
    prisma.siteSettings.findUnique({
      where: { id: "site" },
      select: { contentLanguageMode: true, videosEnabled: true, commentsEnabled: true }
    })
  ]);
  if (!post) notFound();
  const contentLanguageMode = settings?.contentLanguageMode || "default-language";
  // 评论总开关（默认关闭）。关闭时页面完全没有评论痕迹;
  // 开启与否由客户端组件再向接口核验一次,接口才是权威。
  const commentsEnabled = settings?.commentsEnabled === true;
  // 视频功能总开关（默认关闭）。关闭时：短代码被静默剥离、文末不出现「相关视频」，
  // 整个页面完全没有视频痕迹。
  const videosEnabled = settings?.videosEnabled === true;

  // 已通过 [[video:ID]] 短代码内嵌到正文里的视频，不在末尾「相关视频」再重复展示。
  const inlineVideoIds = collectShortcodedVideoIds(
    post.content,
    post.contentEn
  );
  const topicIds = post.topics.map((t) => t.id);
  // 上一篇/下一篇：与文章列表完全同序（sortOrder asc, publishedAt desc, id asc）。
  // 「上一篇」= 列表中当前位置前一篇，「下一篇」= 后一篇。
  // 并列处理：批量发布对整批写入同一个 publishedAt（api/admin/posts/bulk）且
  // sortOrder 默认 0，(sortOrder, publishedAt) 两键并列是常态——比较分支里
  // 用 id 作第三唯一键拆先后（严格 lt/gt 自身，无自匹配、无 gte/lte 回环）。
  const neighbors = post.publishedAt
    ? Promise.all([
        prisma.post.findFirst({
          where: {
            status: "PUBLISHED",
            publicationBlockedReason: null,
            OR: [
              { sortOrder: { lt: post.sortOrder } },
              { sortOrder: post.sortOrder, publishedAt: { gt: post.publishedAt } },
              { sortOrder: post.sortOrder, publishedAt: post.publishedAt, id: { lt: post.id } }
            ]
          },
          orderBy: [{ sortOrder: "desc" }, { publishedAt: "asc" }, { id: "desc" }],
          select: { slug: true, title: true, titleEn: true }
        }),
        prisma.post.findFirst({
          where: {
            status: "PUBLISHED",
            publicationBlockedReason: null,
            OR: [
              { sortOrder: { gt: post.sortOrder } },
              { sortOrder: post.sortOrder, publishedAt: { lt: post.publishedAt } },
              { sortOrder: post.sortOrder, publishedAt: post.publishedAt, id: { gt: post.id } }
            ]
          },
          orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
          select: { slug: true, title: true, titleEn: true }
        })
      ])
    : Promise.resolve([null, null]);
  // 两个后续查询互不依赖（都只依赖上面的 post），并行执行省一个 DB 往返。
  const [inlineVideos, relatedPosts, [prevPost, nextPost]] = await Promise.all([
    videosEnabled && inlineVideoIds.size
      ? prisma.video.findMany({ where: { id: { in: [...inlineVideoIds] } }, select: ARTICLE_VIDEO_SELECT })
      : [],
    topicIds.length
      ? prisma.post.findMany({
          where: {
            status: "PUBLISHED",
            publicationBlockedReason: null,
            id: { not: post.id },
            topics: { some: { id: { in: topicIds } } }
          },
          orderBy: [{ publishedAt: "desc" }],
          take: 3,
          select: { id: true, slug: true, title: true, titleEn: true, summary: true, summaryEn: true, publishedAt: true }
        })
      : Promise.resolve([]),
    neighbors
  ]);
  const articleVideosById = new Map(post.videos.map((video) => [video.id, video]));
  for (const video of inlineVideos) {
    articleVideosById.set(video.id, video);
  }
  const articleVideos = videosEnabled ? [...articleVideosById.values()] : [];
  const trailingVideos = videosEnabled ? post.videos.filter((video) => !inlineVideoIds.has(video.id)) : [];

  // 正文 HTML 在服务端一次渲染完成（含 [[video:ID]] 短代码与 hideVideos 处理），
  // 作为字符串传给客户端组件：访客不再下载 marked/DOMPurify 解析器，
  // 正文也不会在浏览器里随 hydration/偏好变化被反复 parse+sanitize。
  const adaptedVideos: VideoForShortcode[] = articleVideos.map((video) => ({
    id: video.id,
    title: video.title,
    type: video.type,
    url: video.url,
    displayMode: (video as { displayMode?: string | null }).displayMode,
    summary: video.summary,
    sourcePageUrl: video.sourcePageUrl,
    sourcePlatform: video.sourcePlatform,
    attribution: video.attribution,
    durationSec: video.durationSec
  }));
  const videosById = new Map(adaptedVideos.map((video) => [video.id, video]));
  const hideVideos = !videosEnabled;

  // 语言由 URL 决定，所以只渲染这一版 URL 真正要用的那份正文。
  //
  // 此前两份都渲染并都作为 prop 传给客户端组件，于是纯中文读者的页面响应里
  // 还多带一整份英文正文 HTML（客户端组件的 prop 会被完整序列化进内嵌的
  // RSC Flight 负载）。双语模式才需要两份。
  const wantsEnglish = language === "en";
  const bilingual = contentLanguageMode === "bilingual";
  const zhContentHtml = !wantsEnglish || bilingual
    ? markdownToHtml(stripTitleHeading(post.content, post.title), { videosById, hideVideos })
    : null;
  const enContentHtml = (wantsEnglish || bilingual) && post.contentEn
    ? markdownToHtml(stripTitleHeading(post.contentEn, post.titleEn || post.title), { videosById, hideVideos })
    : null;

  // dek 的显隐按语言分别判定：中文摘要是否复读中文导语、英文摘要是否复读英文
  // 导语互不相干。若只用中文侧判定，英文读者会平白丢失独立 dek 或看到重复 dek。
  const zhLead = post.summary && !summaryDuplicatesContentLead(post.content, post.title, post.summary)
    ? post.summary
    : null;
  const enSummary = post.summaryEn || post.summary;
  const enLead = enSummary && !summaryDuplicatesContentLead(post.contentEn || post.content, post.titleEn || post.title, enSummary)
    ? enSummary
    : null;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: (wantsEnglish && post.titleEn) || post.title,
    description: ((wantsEnglish && post.summaryEn) || post.summary).slice(0, 180),
    datePublished: post.publishedAt?.toISOString(),
    mainEntityOfPage: absoluteSiteUrl(withLanguagePrefix(language, `/posts/${post.slug}`)),
    ...(post.sourceUrl ? { isBasedOn: post.sourceUrl } : {})
  };

  return (
    <main className="container-narrow article-detail-page">
      <script
        type="application/ld+json"
        // JSON-LD 里的 "<" 需转义，防止内容中出现 "</script>" 提前闭合标签。
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd).replace(/</g, "\\u003c") }}
      />
      <AssistantPageContext
        contextLabel={<I18nText zh="本篇文章" en="This article" />}
        suggestionGroups={[
          {
            title: <I18nText zh="读这篇文章" en="About this article" />,
            prompts: [
              "用三句话概括这篇文章",
              "列出文中的事实、观点和不确定信息",
              "用更通俗的话解释给我听"
            ]
          },
          {
            title: <I18nText zh="继续思考" en="Go further" />,
            prompts: [
              "这件事的争议点是什么？",
              "这件事可能带来什么影响？",
              "有哪些值得继续追问的问题？"
            ]
          }
        ]}
        // 30k 是接口上限；留出富余给标题摘要与访客问题本身。
        context={[
          `文章标题：${post.title}`,
          post.summary ? `摘要：${post.summary}` : "",
          `正文：\n${(post.content || "").slice(0, 20000)}`
        ].filter(Boolean).join("\n\n")}
      />
      <p className="publication-article-back">
        <Link className="text-link" href="/posts">
          ← <I18nText zh="返回文章列表" en="Back to posts" />
        </Link>
      </p>
      <header className="publication-article-header" data-reveal>
        <p className="publication-overline">
          {post.tags.length ? post.tags[0].name : <I18nText zh="内容文章" en="Posts" />}
        </p>
        <h1>
          <I18nText zh={post.title} en={post.titleEn || post.title} />
        </h1>
        {zhLead ? <p className="lead i18n-zh" lang="zh-CN">{zhLead}</p> : null}
        {enLead ? <p className="lead i18n-en" lang="en">{enLead}</p> : null}
        <div className="meta-row">
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>{post.publishedAt.toLocaleDateString(language === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" })}</time>
          ) : (
            <span><I18nText zh="已发布" en="Published" /></span>
          )}
          {post.topics.map((topic) => (
            <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
          ))}
          {post.tags.slice(1).map((tag) => <span className="tag" key={tag.id}>{tag.name}</span>)}
          {post.sourceUrl && /^https?:\/\//i.test(post.sourceUrl) ? (
            <a className="text-link" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">
              <I18nText zh="原始来源" en="Original source" />
            </a>
          ) : null}
        </div>
        <ReadingTools key={post.id} minutes={readingMinutes(wantsEnglish && post.contentEn ? post.contentEn : post.content)} />
      </header>

      <div className="article-body-grid">
        <div className="article-body-main">
          {/* 窄屏：正文上方的可折叠目录；宽屏由右侧栏接管（CSS 切换显隐） */}
          <details className="article-toc-mobile">
            <summary>
              <I18nText zh="本文小节" en="On this page" />
            </summary>
            <ArticleToc />
          </details>
          <article className="prose" data-reading-content>
            <LanguageAwarePost
              postId={post.id}
              contentLanguageMode={contentLanguageMode}
              videosEnabled={videosEnabled}
              post={{
                title: post.title,
                summary: post.summary,
                titleEn: post.titleEn,
                summaryEn: post.summaryEn
              }}
              zhContentHtml={zhContentHtml}
              enContentHtml={enContentHtml}
              showZhLead={zhLead !== null}
              showEnLead={enLead !== null}
              videos={adaptedVideos}
            />
          </article>
        </div>
        <ArticleToc variant="rail" />
      </div>
      <div className="prose article-related-stack">
        {trailingVideos.length ? (
          <section style={{ marginTop: 72 }}>
            <h2><I18nText zh="相关视频" en="Related Videos" /></h2>
            {trailingVideos.map((video) => (
              <div key={video.id} className="form-card" style={{ marginBottom: 24 }}>
                <h3>{video.title}</h3>
                <p>{video.summary}</p>
                <VideoEmbed video={video} />
              </div>
            ))}
          </section>
        ) : null}

        {relatedPosts.length ? (
          <section style={{ marginTop: 72 }}>
            <h2><I18nText zh="相关文章" en="Related posts" /></h2>
            <div className="news-list">
              {relatedPosts.map((rp) => (
                <article className="news-list-item linked-card" key={rp.id}>
                  <span className="timeline-dot" aria-hidden />
                  <div>
                    <div className="meta-row">
                      <span>{rp.publishedAt?.toLocaleDateString("zh-CN")}</span>
                    </div>
                    <h3>
                      <Link className="card-link" href={`/posts/${rp.slug}`}>
                        <I18nText zh={rp.title} en={rp.titleEn || rp.title} />
                      </Link>
                    </h3>
                    <p className="muted"><I18nText zh={rp.summary} en={rp.summaryEn || rp.summary} /></p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {prevPost || nextPost ? (
          <nav className="post-neighbor-nav" aria-label="相邻文章 / Adjacent posts">
            {prevPost ? (
              <Link className="post-neighbor-card" href={`/posts/${prevPost.slug}`}>
                <span className="post-neighbor-label">
                  ← <I18nText zh="上一篇" en="Previous" />
                </span>
                <span className="post-neighbor-title">
                  <I18nText zh={prevPost.title} en={prevPost.titleEn || prevPost.title} />
                </span>
              </Link>
            ) : (
              <span className="post-neighbor-card is-empty" aria-hidden="true" />
            )}
            {nextPost ? (
              <Link className="post-neighbor-card is-next" href={`/posts/${nextPost.slug}`}>
                <span className="post-neighbor-label">
                  <I18nText zh="下一篇" en="Next" /> →
                </span>
                <span className="post-neighbor-title">
                  <I18nText zh={nextPost.title} en={nextPost.titleEn || nextPost.title} />
                </span>
              </Link>
            ) : (
              <span className="post-neighbor-card is-empty" aria-hidden="true" />
            )}
          </nav>
        ) : null}

        {commentsEnabled ? <PostComments postId={post.id} /> : null}

        <p style={{ marginTop: 56 }}>
          <Link className="text-link" href="/posts">
            ← <I18nText zh="返回文章列表" en="Back to posts" />
          </Link>
        </p>
      </div>
    </main>
  );
}

// 标题这类「单行 + 行内数学」的片段：渲染后剥掉最外层 <p>，保持行内布局。
function stripInlineWrapper(html: string): string {
  return html.replace(/^<p>/, "").replace(/<\/p>\s*$/, "");
}

function getSlugCandidates(slug: string) {
  const candidates = new Set([slug]);
  try {
    candidates.add(decodeURIComponent(slug));
  } catch {
    // Keep the original slug when the URL segment is not encoded.
  }
  candidates.add(encodeURIComponent(slug));
  return [...candidates];
}
