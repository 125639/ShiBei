import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";

export default async function VideosPage() {
  const videos = await prisma.video.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], include: { post: true } });

  return (
    <PublicShell>
      <main className="container">
        <h1 className="page-title">视频资源</h1>
        <div className="grid" style={{ marginTop: 32 }}>
          {videos.map((video) => (
            <Link className="card" key={video.id} href={`/videos/${video.id}`}>
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
          ))}
        </div>
      </main>
    </PublicShell>
  );
}
