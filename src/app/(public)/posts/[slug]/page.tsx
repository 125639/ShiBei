import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { AiAssistant } from "@/components/AiAssistant";
import { LanguageAwarePost } from "@/components/LanguageAwarePost";
import { I18nText } from "@/components/I18nText";
import { prisma } from "@/lib/prisma";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { absoluteSiteUrl } from "@/lib/site-url";
import { VideoEmbed } from "@/lib/video";
import { VIDEO_SHORTCODE_RE } from "@/lib/video-display";

// Without this, a dynamic-param page with no generateStaticParams still gets
// rendered once and cached indefinitely per slug (Next's default behavior for
// "static" dynamic segments). That froze articles at whatever state they were
// in on first view — admin edits, re-publishes, and the translate API's own
// DB writes never showed up until a rebuild.
export const dynamic = "force-dynamic";

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
    prisma.siteSettings.findUnique({ where: { id: "site" }, select: { contentLanguageMode: true, videosEnabled: true } })
  ]);
  if (!post || post.status !== "PUBLISHED") notFound();
  const contentLanguageMode = settings?.contentLanguageMode || "default-language";
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
        {post.summary ? (
          <p className="lead">
            <I18nText zh={post.summary} en={post.summaryEn || post.summary} />
          </p>
        ) : null}
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
          {post.sourceUrl ? (
            <a className="text-link" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">
              <I18nText zh="原始来源" en="Original source" />
            </a>
          ) : null}
        </div>
      </header>

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
