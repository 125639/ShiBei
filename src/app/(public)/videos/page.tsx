import Link from "next/link";
import type { Prisma, VideoType } from "@prisma/client";
import { Pagination } from "@/components/Pagination";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";
import { combineVideoWhere } from "@/lib/public-video";

const PAGE_SIZE = 24;

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; page?: string }> }) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) || "";
  const type = normalizeVideoType(params.type);
  const page = normalizePage(params.page);
  const where: Prisma.VideoWhereInput = combineVideoWhere(
    type ? { type } : null,
    query ? {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { sourcePlatform: { contains: query, mode: "insensitive" } },
        { post: { title: { contains: query, mode: "insensitive" } } }
      ]
    } : null
  );

  const [videos, totalVideos] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        type: true,
        summary: true,
        post: { select: { id: true } }
      }
    }),
    prisma.video.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalVideos / PAGE_SIZE));

  return (
    <PublicShell>
      <main className="container bento-page">
        <section className="page-intro bento-card bento-wide">
          <p className="eyebrow">Media</p>
          <h1 className="page-title">视频资源</h1>
          <p className="muted">集中查看抓取或上传后可关联到文章的视频材料。{query ? `搜索：${query}。` : null}</p>
        </section>
        <form className="form-card filter-form" action="/videos" method="get">
          <div className="field">
            <label htmlFor="video-search">搜索视频</label>
            <input id="video-search" name="q" defaultValue={query} placeholder="标题、说明、平台或关联文章" />
          </div>
          <div className="field">
            <label htmlFor="video-type">类型</label>
            <select id="video-type" name="type" defaultValue={type || ""}>
              <option value="">全部</option>
              <option value="LOCAL">本地视频</option>
              <option value="EMBED">嵌入视频</option>
              <option value="LINK">外链</option>
            </select>
          </div>
          <button className="button" type="submit">筛选</button>
          {(query || type) ? <Link className="button secondary" href="/videos">清除</Link> : null}
        </form>
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
        <Pagination basePath="/videos" page={page} totalPages={totalPages} params={{ q: query, type }} />
      </main>
    </PublicShell>
  );
}

function normalizePage(value: string | undefined) {
  const n = Number(value || 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function normalizeVideoType(value: string | undefined): VideoType | null {
  if (value === "LOCAL" || value === "EMBED" || value === "LINK") return value;
  return null;
}
