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
      select: { id: true, title: true, type: true, displayMode: true, postId: true },
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
        <h2 style={{ marginTop: 0 }}>上传图片并插入正文</h2>
        <form action={`/api/admin/posts/${post.id}/images`} method="post" encType="multipart/form-data" className="form-stack">
          <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
          <div className="field-row">
            <div className="field">
              <label htmlFor="image-file">图片文件</label>
              <input id="image-file" type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif" required />
            </div>
            <div className="field">
              <label htmlFor="image-caption">图片说明</label>
              <input id="image-caption" name="caption" placeholder="留空使用文件名" />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="image-insert-placement">插入位置</label>
              <select id="image-insert-placement" name="insertPlacement" defaultValue="after-intro">
                <option value="after-intro">导语后</option>
                <option value="before-references">参考来源前</option>
                <option value="end">文末</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="image-source-page">图片来源链接（可选）</label>
              <input id="image-source-page" name="sourcePageUrl" type="url" placeholder="https://..." />
            </div>
          </div>
          {(post as { contentEn?: string | null }).contentEn ? (
            <label>
              <input type="checkbox" name="mirrorToEnglish" value="true" defaultChecked /> 同步插入英文正文
            </label>
          ) : null}
          <button className="button" type="submit">上传并插入图片</button>
        </form>
        <p className="hint">支持 JPG / PNG / WebP / GIF，单文件上限 8MB；重复上传同一图片只会复用同一个本地文件。</p>
      </section>

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
                    {video.type} · 展示：{(video as { displayMode?: string | null }).displayMode === "link" ? "链接" : "嵌入"} · ID: <code>{video.id}</code>
                  </div>
                </div>
                <code style={{ fontSize: 12, marginRight: 12 }}>[[video:{video.id}]]</code>
                <form action="/api/admin/videos/insert" method="post" className="meta-row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="id" value={video.id} />
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
                  <select name="displayMode" defaultValue={(video as { displayMode?: string | null }).displayMode || "embed"}>
                    <option value="embed">嵌入</option>
                    <option value="link">链接</option>
                  </select>
                  <select name="insertPlacement" defaultValue="before-references">
                    <option value="after-intro">导语后</option>
                    <option value="before-references">参考来源前</option>
                    <option value="end">文末</option>
                  </select>
                  <button className="button-secondary" type="submit">插入/调整位置</button>
                </form>
                <form
                  action={`/api/admin/videos/delete?id=${encodeURIComponent(video.id)}&redirect=${encodeURIComponent(`/admin/posts/${post.id}`)}`}
                  method="post"
                >
                  <button
                    type="submit"
                    className="text-link"
                    style={{ color: "var(--color-danger, #c44)", background: "none", border: 0, padding: 0, cursor: "pointer" }}
                  >
                    删除
                  </button>
                </form>
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
              <label htmlFor="video-display-mode">文章展示方式</label>
              <select id="video-display-mode" name="displayMode" defaultValue="embed">
                <option value="embed">嵌入视频播放器（默认）</option>
                <option value="link">仅以链接形式插入</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="video-insert-placement">插入位置</label>
              <select id="video-insert-placement" name="insertPlacement" defaultValue="before-references">
                <option value="after-intro">导语后</option>
                <option value="before-references">参考来源前</option>
                <option value="end">文末</option>
              </select>
            </div>
          </div>
          <label>
            <input type="checkbox" name="insertShortcode" value="true" defaultChecked /> 上传后自动插入到正文
          </label>
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
        <p className="hint">默认会把上传的视频以嵌入模式插入到正文；也可以改成链接模式，或在上方列表重新调整位置。</p>
      </section>

      <section className="form-card form-stack" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>把已有视频插入文章</h2>
        {allVideos.length === 0 ? (
          <p className="muted-block">暂无可选择的视频，可先在上方上传。</p>
        ) : (
          <form action="/api/admin/videos/insert" method="post" className="form-stack">
            <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
            <input type="hidden" name="postId" value={post.id} />
            <div className="field">
              <label htmlFor="existing-video-id">选择已有视频</label>
              <select id="existing-video-id" name="id" required defaultValue="">
                <option value="" disabled>选择一个已有视频</option>
                {allVideos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title} · {video.type} · {(video.displayMode || "embed") === "link" ? "链接" : "嵌入"}{video.postId && video.postId !== post.id ? " · 已挂载其他文章" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="existing-video-display-mode">文章展示方式</label>
                <select id="existing-video-display-mode" name="displayMode" defaultValue="embed">
                  <option value="embed">嵌入视频播放器</option>
                  <option value="link">仅以链接形式插入</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="existing-video-placement">插入位置</label>
                <select id="existing-video-placement" name="insertPlacement" defaultValue="before-references">
                  <option value="after-intro">导语后</option>
                  <option value="before-references">参考来源前</option>
                  <option value="end">文末</option>
                </select>
              </div>
            </div>
            <button className="button-secondary" type="submit">挂到本文章并插入</button>
          </form>
        )}
        <p className="hint">提交后会自动把 <code>[[video:ID]]</code> 写入正文；再次提交同一视频会先移除旧短代码再按新位置插入。</p>
      </section>
    </AdminShell>
  );
}
