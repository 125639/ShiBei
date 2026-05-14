import { AdminShell } from "@/components/AdminShell";
import { VideoReorderList } from "@/components/VideoReorderList";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function VideosAdminPage() {
  await requireAdmin();

  const [videos, posts] = await Promise.all([
    prisma.video.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: { post: { select: { id: true, title: true, slug: true } } },
    }),
    prisma.post.findMany({
      where: { status: { in: ["DRAFT", "PUBLISHED"] } },
      select: { id: true, title: true, slug: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  const videoRows = videos.map((video) => ({
    id: video.id,
    title: video.title,
    type: String(video.type),
    url: video.url,
    displayMode: (video as { displayMode?: string | null }).displayMode || "embed",
    lastPlacement: (video as { lastPlacement?: string | null }).lastPlacement || null,
    fileSizeBytes: video.fileSizeBytes ?? null,
    postId: video.post?.id ?? null,
    postTitle: video.post?.title ?? null,
  }));

  const formattedSizes: Record<string, string> = {};
  for (const video of videos) {
    if (video.fileSizeBytes) formattedSizes[video.id] = formatBytes(video.fileSizeBytes);
  }

  return (
    <AdminShell>
      <p className="eyebrow">Videos</p>
      <h1>视频管理</h1>
      <p className="muted-block" style={{ maxWidth: 720 }}>
        上传本地视频文件（MP4 / WebM / MOV / M4V，≤300 MB），或者添加 YouTube / Bilibili 等嵌入链接、外链。
        每个视频都有独立的 ID，可以选择以播放器嵌入或仅链接的方式出现在文章里；同一篇文章下的视频支持拖拽排序与三档预设位置。
      </p>

      <form
        className="form-card form-stack"
        action="/api/admin/videos"
        method="post"
        encType="multipart/form-data"
        style={{ maxWidth: 720 }}
      >
        <h2 style={{ marginTop: 0 }}>上传 / 添加视频</h2>
        <div className="field">
          <label htmlFor="title">标题</label>
          <input id="title" name="title" required defaultValue="视频资源" />
        </div>
        <div className="field">
          <label htmlFor="summary">说明</label>
          <textarea id="summary" name="summary" />
        </div>
        <div className="field">
          <label htmlFor="type">类型</label>
          <select id="type" name="type" defaultValue="LOCAL">
            <option value="LOCAL">本地上传</option>
            <option value="EMBED">嵌入（YouTube / Bilibili 等可 iframe 的播放器）</option>
            <option value="LINK">外链（仅展示「打开视频」按钮）</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="displayMode">文章展示方式</label>
          <select id="displayMode" name="displayMode" defaultValue="embed">
            <option value="embed">嵌入视频播放器（默认）</option>
            <option value="link">仅以链接形式插入</option>
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="file">文件（仅本地上传）</label>
            <input
              id="file"
              type="file"
              name="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
            />
          </div>
          <div className="field">
            <label htmlFor="url">URL（嵌入或外链时填）</label>
            <input id="url" type="url" name="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sourcePlatform">来源平台（可选）</label>
            <input id="sourcePlatform" name="sourcePlatform" placeholder="YouTube / Bilibili / ..." />
          </div>
          <div className="field">
            <label htmlFor="sourcePageUrl">来源页面（可选）</label>
            <input id="sourcePageUrl" name="sourcePageUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field">
          <label htmlFor="attribution">版权说明（可选）</label>
          <textarea id="attribution" name="attribution" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="postId">挂到哪篇文章（可选）</label>
            <select id="postId" name="postId" defaultValue="">
              <option value="">不挂载（稍后再挂）</option>
              {posts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sortOrder">排序（小的在前）</label>
            <input id="sortOrder" name="sortOrder" type="number" defaultValue={videos.length} />
          </div>
        </div>
        <button className="button" type="submit">保存</button>
      </form>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>当前视频（{videos.length}）</h2>
        {videos.length === 0 ? (
          <p className="muted">暂无视频。在上方上传一个开始。</p>
        ) : (
          <VideoReorderList
            videos={videoRows}
            posts={posts.map((p) => ({ id: p.id, title: p.title }))}
            formatBytes={formattedSizes}
          />
        )}
      </section>
    </AdminShell>
  );
}
