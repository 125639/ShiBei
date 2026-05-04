import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AdminPostEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [post, allVideos] = await Promise.all([
    prisma.post.findUnique({ where: { id }, include: { videos: true, tags: true } }),
    prisma.video.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, type: true, postId: true },
    }),
  ]);
  if (!post) notFound();

  return (
    <AdminShell>
      <p className="eyebrow">Review</p>
      <h1>审核草稿</h1>
      <form className="form-card form-stack" action={`/api/admin/posts/${post.id}`} method="post">
        <div className="field">
          <label htmlFor="title">标题</label>
          <input id="title" name="title" defaultValue={post.title} required />
        </div>
        <div className="field">
          <label htmlFor="titleEn">英文标题（可选，AI 翻译会自动缓存）</label>
          <input id="titleEn" name="titleEn" defaultValue={(post as { titleEn?: string | null }).titleEn || ""} />
        </div>
        <div className="field">
          <label htmlFor="summary">摘要</label>
          <textarea id="summary" name="summary" defaultValue={post.summary} required />
        </div>
        <div className="field">
          <label htmlFor="summaryEn">英文摘要（可选）</label>
          <textarea id="summaryEn" name="summaryEn" defaultValue={(post as { summaryEn?: string | null }).summaryEn || ""} />
        </div>
        <div className="field">
          <label htmlFor="content">正文 Markdown</label>
          <textarea id="content" name="content" defaultValue={post.content} style={{ minHeight: 420 }} required />
          <p className="hint" style={{ marginTop: 6 }}>
            可以在正文任意位置插入 <code>[[video:VIDEO_ID]]</code> 短代码，会被替换为对应视频播放器；
            未被引用的视频会自动展示在文章末尾「相关视频」区。
          </p>
        </div>
        <div className="field">
          <label htmlFor="contentEn">英文正文 Markdown（可选）</label>
          <textarea id="contentEn" name="contentEn" defaultValue={(post as { contentEn?: string | null }).contentEn || ""} style={{ minHeight: 320 }} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tags">标签（逗号分隔）</label>
            <input id="tags" name="tags" defaultValue={post.tags.map((tag) => tag.name).join(", ")} />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">来源链接</label>
            <input id="sourceUrl" name="sourceUrl" defaultValue={post.sourceUrl || ""} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sortOrder">排序（小的在前）</label>
          <input id="sortOrder" name="sortOrder" type="number" defaultValue={(post as { sortOrder?: number }).sortOrder ?? 0} />
        </div>
        <div className="field">
          <label htmlFor="status">状态</label>
          <select id="status" name="status" defaultValue={post.status}>
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">发布</option>
            <option value="ARCHIVED">归档</option>
          </select>
        </div>
        <button className="button" type="submit">保存</button>
      </form>

      <section className="form-card form-stack" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>已挂载视频</h2>
        {post.videos.length === 0 ? (
          <p className="muted-block">暂无视频。可在下方上传或在 <a className="text-link" href="/admin/videos">视频管理</a> 把已有视频挂到本文章。</p>
        ) : (
          <ul className="form-stack" style={{ listStyle: "none", padding: 0 }}>
            {post.videos.map((video) => (
              <li key={video.id} className="meta-row" style={{ alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border, #ddd)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{video.title}</strong>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {video.type} · ID: <code>{video.id}</code>
                  </div>
                </div>
                <code style={{ fontSize: 12, marginRight: 12 }}>[[video:{video.id}]]</code>
                <a className="text-link" href={`/api/admin/videos/delete?id=${encodeURIComponent(video.id)}&redirect=${encodeURIComponent(`/admin/posts/${post.id}`)}`} style={{ color: "var(--color-danger, #c44)" }}>
                  删除
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="form-card form-stack" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>上传新视频并挂到本文章</h2>
        <form action="/api/admin/videos" method="post" encType="multipart/form-data" className="form-stack">
          <input type="hidden" name="postId" value={post.id} />
          <div className="field">
            <label htmlFor="video-title">标题</label>
            <input id="video-title" name="title" required defaultValue="视频资源" />
          </div>
          <div className="field">
            <label htmlFor="video-summary">说明</label>
            <textarea id="video-summary" name="summary" />
          </div>
          <div className="field">
            <label htmlFor="video-type">类型</label>
            <select id="video-type" name="type" defaultValue="LOCAL">
              <option value="LOCAL">本地上传</option>
              <option value="EMBED">嵌入（YouTube/Bilibili 等 iframe）</option>
              <option value="LINK">外链</option>
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="video-file">文件（仅本地上传）</label>
              <input id="video-file" type="file" name="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" />
            </div>
            <div className="field">
              <label htmlFor="video-url">URL（嵌入或外链时填）</label>
              <input id="video-url" type="url" name="url" placeholder="https://..." />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="video-platform">来源平台（可选）</label>
              <input id="video-platform" name="sourcePlatform" placeholder="YouTube / Bilibili / ..." />
            </div>
            <div className="field">
              <label htmlFor="video-page">来源页面（可选）</label>
              <input id="video-page" name="sourcePageUrl" type="url" placeholder="https://..." />
            </div>
          </div>
          <div className="field">
            <label htmlFor="video-attribution">版权说明（可选）</label>
            <textarea id="video-attribution" name="attribution" />
          </div>
          <div className="field">
            <label htmlFor="video-sort">排序（数值小的在前）</label>
            <input id="video-sort" name="sortOrder" type="number" defaultValue={0} />
          </div>
          <button className="button" type="submit">上传并挂到本文章</button>
        </form>
        <p className="hint">上传后回到本页，复制旁边的 <code>[[video:ID]]</code> 短代码，粘到正文 Markdown 中即可在该位置嵌入播放器。</p>
      </section>

      <section className="form-card form-stack" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>把已有视频插入文章</h2>
        {allVideos.length === 0 ? (
          <p className="muted-block">暂无可选择的视频，可先在上方上传。</p>
        ) : (
          <form action="/api/admin/videos/attach" method="post" className="form-stack">
            <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
            <input type="hidden" name="postId" value={post.id} />
            <div className="field">
              <label htmlFor="existing-video-id">选择已有视频</label>
              <select id="existing-video-id" name="id" required defaultValue="">
                <option value="" disabled>选择一个已有视频</option>
                {allVideos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title} · {video.type}{video.postId && video.postId !== post.id ? " · 已挂载其他文章" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button className="button-secondary" type="submit">挂到本文章</button>
          </form>
        )}
        <p className="hint">挂载后，该视频会出现在上方列表；复制它的 <code>[[video:ID]]</code> 到正文任意位置即可定点展示。</p>
      </section>
    </AdminShell>
  );
}
