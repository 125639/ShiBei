import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";

export default async function VideosPage() {
  const videos = await prisma.video.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], include: { post: true } });

  return (
    <PublicShell>
      <main className="container bento-page">
        <section className="page-intro bento-card bento-wide">
          <p className="eyebrow">Media</p>
          <h1 className="page-title">视频资源</h1>
          <p className="muted">集中查看抓取或上传后可关联到文章的视频材料。</p>
        </section>
        <div className="bento-grid video-bento">
          {videos.length ? (
            videos.map((video, index) => (
              <Link className={`bento-card video-card ${index === 0 ? "bento-wide" : ""}`} key={video.id} href={`/videos/${video.id}`}>
                <div>
                  <div className="meta-row">
                    <span>{video.type}</span>
                    {video.post ? <span className="tag">关联文章</span> : null}
                  </div>
                  <h3>{video.title}</h3>
                  <p>{video.summary}</p>
                </div>
                <span className="text-link">查看视频</span>
              </Link>
            ))
          ) : (
            <div className="bento-card bento-wide">
              <h3>暂无视频资源</h3>
              <p className="muted">当文章关联的视频被识别或管理员手动上传后，会在这里展示。</p>
            </div>
          )}
        </div>
      </main>
    </PublicShell>
  );
}
