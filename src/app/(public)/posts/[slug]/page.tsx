import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { AiAssistant } from "@/components/AiAssistant";
import { ArticleToc } from "@/components/ArticleToc";
import { LanguageAwarePost } from "@/components/LanguageAwarePost";
import { PostComments } from "@/components/PostComments";
import { I18nText } from "@/components/I18nText";
import { prisma } from "@/lib/prisma";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { absoluteSiteUrl } from "@/lib/site-url";
import { VideoEmbed } from "@/lib/video";
import { VIDEO_SHORTCODE_RE } from "@/lib/video-display";
import { summaryDuplicatesContentLead } from "@/lib/post-derive";

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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [post, settings] = await Promise.all([
    prisma.post.findFirst({
      where: { slug: { in: getSlugCandidates(slug) }, status: "PUBLISHED" },
      select: { slug: true, title: true, summary: true, publishedAt: true, updatedAt: true }
    }),
    getCachedSiteChromeSettings().catch(() => null)
  ]);
  if (!post) return {};

  const title = post.title;
  const description = post.summary.slice(0, 180);
  const url = absoluteSiteUrl(`/posts/${post.slug}`);
  const siteName = settings?.name || "ShiBei";

  return {
    title: `${title} | ${siteName}`,
    description,
    alternates: { canonical: url },
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

export default async function PostDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, settings] = await Promise.all([
    prisma.post.findFirst({
      where: {
        slug: {
          in: getSlugCandidates(slug)
        }
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
  if (!post || post.status !== "PUBLISHED") notFound();
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
  const inlineVideos = videosEnabled && inlineVideoIds.size
    ? await prisma.video.findMany({ where: { id: { in: [...inlineVideoIds] } }, select: ARTICLE_VIDEO_SELECT })
    : [];
  const articleVideosById = new Map(post.videos.map((video) => [video.id, video]));
  for (const video of inlineVideos) {
    articleVideosById.set(video.id, video);
  }
  const articleVideos = videosEnabled ? [...articleVideosById.values()] : [];
  const trailingVideos = videosEnabled ? post.videos.filter((video) => !inlineVideoIds.has(video.id)) : [];

  const topicIds = post.topics.map((t) => t.id);
  const relatedPosts = topicIds.length
    ? await prisma.post.findMany({
        where: {
          status: "PUBLISHED",
          id: { not: post.id },
          topics: { some: { id: { in: topicIds } } }
        },
        orderBy: [{ publishedAt: "desc" }],
        take: 3,
        select: { id: true, slug: true, title: true, titleEn: true, summary: true, summaryEn: true, publishedAt: true }
      })
    : [];

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
    headline: post.title,
    description: post.summary.slice(0, 180),
    datePublished: post.publishedAt?.toISOString(),
    mainEntityOfPage: absoluteSiteUrl(`/posts/${post.slug}`),
    ...(post.sourceUrl ? { isBasedOn: post.sourceUrl } : {})
  };

  return (
    <main className="container-narrow article-detail-page">
      <script
        type="application/ld+json"
        // JSON-LD 里的 "<" 需转义，防止内容中出现 "</script>" 提前闭合标签。
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd).replace(/</g, "\\u003c") }}
      />
      <p style={{ marginBottom: 12 }}>
        <Link className="text-link" href="/posts">
          ← <I18nText zh="返回文章列表" en="Back to posts" />
        </Link>
      </p>
      <header className="apple-article-header">
        <p className="eyebrow-apple">
          {post.tags.length ? post.tags[0].name : <I18nText zh="内容文章" en="Posts" />}
        </p>
        <h1>
          <I18nText zh={post.title} en={post.titleEn || post.title} />
        </h1>
        {zhLead ? <p className="lead i18n-zh" lang="zh-CN">{zhLead}</p> : null}
        {enLead ? <p className="lead i18n-en" lang="en">{enLead}</p> : null}
        <div className="meta-row">
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>{post.publishedAt.toLocaleDateString("zh-CN")}</time>
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
          <article className="prose">
            <LanguageAwarePost
              postId={post.id}
              contentLanguageMode={contentLanguageMode}
              videosEnabled={videosEnabled}
              post={{
                title: post.title,
                summary: post.summary,
                content: post.content,
                titleEn: post.titleEn,
                summaryEn: post.summaryEn,
                contentEn: post.contentEn
              }}
              videos={articleVideos.map((video) => ({
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
              }))}
            />
          </article>
        </div>
        <aside className="article-toc-rail">
          <ArticleToc />
        </aside>
      </div>

      <AiAssistant
        contextLabel={<I18nText zh="当前文章" en="Current Post" />}
        suggestionGroups={[
          {
            title: <I18nText zh="核心要点" en="Key Points" />,
            prompts: [
              "用三句话概括这篇文章",
              "这篇文章最重要的事实是什么？",
              "哪些背景信息需要补充？"
            ]
          },
          {
            title: <I18nText zh="深入阅读" en="Go Deeper" />,
            prompts: [
              "这件事的争议点是什么？",
              "列出事实、观点和推测的区别",
              "这件事可能带来什么影响？"
            ]
          }
        ]}
        context={[post.title, post.summary, post.content.slice(0, 8000)].join("\n\n")}
      />

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
