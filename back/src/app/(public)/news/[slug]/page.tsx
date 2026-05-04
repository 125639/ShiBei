import { notFound } from "next/navigation";
import Link from "next/link";
import { AiAssistant } from "@/components/AiAssistant";
import { LanguageAwareNews } from "@/components/LanguageAwareNews";
import { PublicShell } from "@/components/PublicShell";
import { I18nText } from "@/components/I18nText";
import { prisma } from "@/lib/prisma";
import { VideoEmbed } from "@/lib/video";

const SHORTCODE_RE = /\[\[video:([A-Za-z0-9_-]+)\]\]/g;

function collectShortcodedVideoIds(...sources: Array<string | null | undefined>): Set<string> {
  const ids = new Set<string>();
  for (const text of sources) {
    if (!text) continue;
    let match: RegExpExecArray | null;
    SHORTCODE_RE.lastIndex = 0;
    while ((match = SHORTCODE_RE.exec(text)) !== null) {
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
  const trailingVideos = post.videos.filter((video) => !inlineVideoIds.has(video.id));

  return (
    <PublicShell>
      <main className="container">
        <article className="prose">
          <p className="eyebrow">{post.publishedAt?.toLocaleDateString("zh-CN") || <I18nText zh="已发布" en="Published" />}</p>
          <div className="meta-row">
            {post.tags.map((tag) => <span className="tag" key={tag.id}>{tag.name}</span>)}
            {post.sourceUrl ? (
              <Link className="text-link" href={post.sourceUrl} target="_blank"><I18nText zh="原始来源" en="Original Source" /></Link>
            ) : null}
          </div>
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
            videos={post.videos.map((video) => ({
              id: video.id,
              title: video.title,
              type: video.type,
              url: video.url,
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
            context={[post.title, post.summary, post.content.slice(0, 8000)].join("\n\n")}
          />

          {trailingVideos.length ? (
            <section style={{ marginTop: 48 }}>
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
