import { notFound } from "next/navigation";
import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";
import { VideoEmbed } from "@/lib/video";

export default async function VideoDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const video = await prisma.video.findUnique({ where: { id: slug }, include: { post: true } });
  if (!video) notFound();

  return (
    <PublicShell>
      <main className="container">
        <article className="prose">
          <p className="eyebrow">{video.type}</p>
          <h1>{video.title}</h1>
          <p>{video.summary}</p>
          <VideoEmbed video={video} />
          {video.post ? (
            <p>
              <Link className="text-link" href={`/posts/${video.post.slug}`}>
                阅读关联文章：{video.post.title}
              </Link>
            </p>
          ) : null}
        </article>
      </main>
    </PublicShell>
  );
}
