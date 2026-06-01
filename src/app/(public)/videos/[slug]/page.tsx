import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { combineVideoWhere } from "@/lib/public-video";
import { absoluteSiteUrl } from "@/lib/site-url";
import { VideoEmbed } from "@/lib/video";

const VIDEO_TYPE_LABELS: Record<string, { zh: string; en: string }> = {
  LOCAL: { zh: "本地视频", en: "Local video" },
  EMBED: { zh: "嵌入视频", en: "Embedded video" },
  LINK: { zh: "视频链接", en: "Video link" }
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [video, settings] = await Promise.all([
    prisma.video.findFirst({
      where: combineVideoWhere({ id: slug }),
      select: { id: true, title: true, summary: true, updatedAt: true }
    }),
    getCachedSiteChromeSettings().catch(() => null)
  ]);
  if (!video) return {};

  const description = video.summary.slice(0, 180);
  const url = absoluteSiteUrl(`/videos/${video.id}`);
  const siteName = settings?.name || "ShiBei";
  return {
    title: `${video.title} | ${siteName}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "video.other",
      title: video.title,
      description,
      url,
      siteName
    },
    twitter: {
      card: "summary",
      title: video.title,
      description
    }
  };
}

export default async function VideoDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const video = await prisma.video.findFirst({
    where: combineVideoWhere({ id: slug }),
    select: {
      id: true,
      title: true,
      type: true,
      url: true,
      displayMode: true,
      summary: true,
      sourcePageUrl: true,
      sourcePlatform: true,
      attribution: true,
      durationSec: true,
      post: { select: { slug: true, title: true } }
    }
  });
  if (!video) notFound();

  const typeLabel = VIDEO_TYPE_LABELS[video.type] || { zh: video.type, en: video.type };

  return (
    <PublicShell>
      <main className="container-narrow">
        <p style={{ marginBottom: 12 }}>
          <Link className="text-link" href="/videos">
            ← <I18nText zh="返回视频列表" en="Back to videos" />
          </Link>
        </p>
        <article className="prose">
          <p className="eyebrow"><I18nText zh={typeLabel.zh} en={typeLabel.en} /></p>
          <h1>{video.title}</h1>
          {video.summary ? <p>{video.summary}</p> : null}
          <VideoEmbed video={video} />
          {video.post ? (
            <p>
              <Link className="text-link" href={`/posts/${video.post.slug}`}>
                <I18nText zh="阅读关联文章" en="Read related article" />:{video.post.title}
              </Link>
            </p>
          ) : null}
        </article>
      </main>
    </PublicShell>
  );
}
