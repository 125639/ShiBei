import { notFound } from "next/navigation";
import Link from "next/link";
import { AiAssistant } from "@/components/AiAssistant";
import { LanguageAwareNews } from "@/components/LanguageAwareNews";
import { PublicShell } from "@/components/PublicShell";
import { I18nText } from "@/components/I18nText";
import { prisma } from "@/lib/prisma";
import { VideoEmbed } from "@/lib/video";
import { VIDEO_SHORTCODE_RE } from "@/lib/video-display";

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

export default async function NewsDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, settings] = await Promise.all([
    prisma.post.findFirst({
      where: {
        slug: {
          in: getSlugCandidates(slug)
        }
      },
      include: { tags: true, videos: true }
    }),
    prisma.siteSettings.findUnique({ where: { id: "site" } })
  ]);
  if (!post || post.status !== "PUBLISHED") notFound();
  const newsLanguageMode = (settings as { newsLanguageMode?: string } | null)?.newsLanguageMode || "default-language";

  // 已通过 [[video:ID]] 短代码内嵌到正文里的视频，不在末尾「相关视频」再重复展示。
  const inlineVideoIds = collectShortcodedVideoIds(
    post.content,
    (post as { contentEn?: string | null }).contentEn
  );
  const inlineVideos = inlineVideoIds.size
    ? await prisma.video.findMany({ where: { id: { in: [...inlineVideoIds] } } })
    : [];
  const articleVideosById = new Map(post.videos.map((video) => [video.id, video]));
  for (const video of inlineVideos) {
    articleVideosById.set(video.id, video);
  }
  const articleVideos = [...articleVideosById.values()];
  const trailingVideos = post.videos.filter((video) => !inlineVideoIds.has(video.id));

  return (
    <PublicShell>
      <main className="container-narrow">
        <header className="apple-article-header">
          <p className="eyebrow-apple">
            {post.tags.length ? post.tags[0].name : <I18nText zh="新闻总结" en="News" />}
          </p>
          <h1>
            <I18nText zh={post.title} en={(post as { titleEn?: string | null }).titleEn || post.title} />
          </h1>
          {post.summary ? (
            <p className="lead">
              <I18nText zh={post.summary} en={(post as { summaryEn?: string | null }).summaryEn || post.summary} />
            </p>
          ) : null}
          <div className="meta-row">
            <span>{post.publishedAt?.toLocaleDateString("zh-CN") || <I18nText zh="已发布" en="Published" />}</span>
            {post.tags.slice(1).map((tag) => <span className="tag" key={tag.id}>{tag.name}</span>)}
            {post.sourceUrl ? (
              <Link className="text-link" href={post.sourceUrl} target="_blank"><I18nText zh="原始来源" en="Original source" /></Link>
            ) : null}
          </div>
        </header>

        <article className="prose">
          <LanguageAwareNews
            postId={post.id}
            newsLanguageMode={newsLanguageMode}
            post={{
              title: post.title,
              summary: post.summary,
              content: post.content,
              titleEn: (post as { titleEn?: string | null }).titleEn,
              summaryEn: (post as { summaryEn?: string | null }).summaryEn,
              contentEn: (post as { contentEn?: string | null }).contentEn
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

        <div className="prose">
          <AiAssistant
            contextLabel={<I18nText zh="当前新闻" en="Current News" />}
            suggestionGroups={[
              {
                title: <I18nText zh="近期热点" en="Key Points" />,
                prompts: [
                  "用三句话概括这篇新闻",
                  "这篇文章最重要的事实是什么？",
                  "哪些背景信息需要补充？"
                ]
              },
              {
                title: <I18nText zh="推荐分析角度" en="Analysis Angles" />,
                prompts: [
                  "这件事的争议点是什么？",
                  "列出事实、观点和推测的区别",
                  "这件事可能带来什么影响？"
                ]
              }
            ]}
            context={[post.title, post.summary, post.content.slice(0, 8000)].join("\n\n")}
          />

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
        </div>
      </main>
    </PublicShell>
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
