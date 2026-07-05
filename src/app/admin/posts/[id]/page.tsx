import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { DirtyAwareForm } from "@/components/DirtyAwareForm";
import { I18nText } from "@/components/I18nText";
import { ImageUploadField } from "@/components/ImageUploadField";
import { PostEditAssist } from "@/components/PostEditAssist";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AdminPostEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [post, allVideos] = await Promise.all([
    prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        titleEn: true,
        summary: true,
        summaryEn: true,
        content: true,
        contentEn: true,
        sourceUrl: true,
        sortOrder: true,
        status: true,
        tags: { select: { id: true, name: true } },
        videos: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
          select: { id: true, title: true, type: true, displayMode: true, localPath: true, downloadStatus: true }
        }
      }
    }),
    prisma.video.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, type: true, displayMode: true, postId: true },
    }),
  ]);
  if (!post) notFound();

  return (
    <AdminShell>
      <p className="eyebrow">Review</p>
      <h1><I18nText zh="审核草稿" en="Review Draft" /></h1>
      <DirtyAwareForm className="form-card form-stack" action={`/api/admin/posts/${post.id}`}>
        <div className="field">
          <label htmlFor="title"><I18nText zh="标题" en="Title" /><span aria-hidden="true" className="req">*</span></label>
          <input id="title" name="title" defaultValue={post.title} required />
        </div>
        <div className="field">
          <label htmlFor="titleEn"><I18nText zh="英文标题（可选，AI 翻译会自动缓存）" en="English title (optional; AI translation is cached)" /></label>
          <input id="titleEn" name="titleEn" defaultValue={post.titleEn || ""} />
        </div>
        <div className="field">
          <label htmlFor="summary"><I18nText zh="摘要" en="Summary" /><span aria-hidden="true" className="req">*</span></label>
          <textarea id="summary" name="summary" defaultValue={post.summary} required />
        </div>
        <div className="field">
          <label htmlFor="summaryEn"><I18nText zh="英文摘要（可选）" en="English summary (optional)" /></label>
          <textarea id="summaryEn" name="summaryEn" defaultValue={post.summaryEn || ""} />
        </div>
        <div className="field">
          <label htmlFor="content"><I18nText zh="正文 Markdown" en="Body (Markdown)" /><span aria-hidden="true" className="req">*</span></label>
          <textarea id="content" name="content" defaultValue={post.content} style={{ minHeight: 420 }} required />
          <p className="hint" style={{ marginTop: 6 }}>
            <I18nText
              zh={<>可以在正文任意位置插入 <code>[[video:VIDEO_ID]]</code> 短代码，会被替换为对应视频播放器；未被引用的视频会自动展示在文章末尾「相关视频」区。</>}
              en={<>Insert <code>[[video:VIDEO_ID]]</code> shortcodes anywhere in the body to render players in place; unreferenced videos appear in the trailing “Related videos” section.</>}
            />
          </p>
        </div>
        <div className="field">
          <label htmlFor="contentEn"><I18nText zh="英文正文 Markdown（可选）" en="English body Markdown (optional)" /></label>
          <textarea id="contentEn" name="contentEn" defaultValue={post.contentEn || ""} style={{ minHeight: 320 }} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tags"><I18nText zh="标签（逗号分隔）" en="Tags (comma separated)" /></label>
            <input id="tags" name="tags" defaultValue={post.tags.map((tag) => tag.name).join(", ")} />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl"><I18nText zh="来源链接" en="Source URL" /></label>
            <input id="sourceUrl" name="sourceUrl" defaultValue={post.sourceUrl || ""} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sortOrder"><I18nText zh="排序（小的在前）" en="Sort order (asc)" /></label>
          <input id="sortOrder" name="sortOrder" type="number" defaultValue={post.sortOrder} />
        </div>
        <div className="field">
          <label htmlFor="status"><I18nText zh="状态" en="Status" /></label>
          <select id="status" name="status" defaultValue={post.status}>
            <option value="DRAFT">草稿 / Draft</option>
            <option value="PUBLISHED">已发布 / Published</option>
            <option value="ARCHIVED">已归档 / Archived</option>
          </select>
        </div>
        <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存草稿" en="Save Draft" /></SubmitButton>
      </DirtyAwareForm>

      <PostEditAssist />

      <section className="form-card form-stack" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="上传图片并插入正文" en="Upload Image into Body" /></h2>
        <form action={`/api/admin/posts/${post.id}/images`} method="post" encType="multipart/form-data" className="form-stack">
          <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
          <div className="field">
            <label htmlFor="image-file"><I18nText zh="图片文件" en="Image file" /><span aria-hidden="true" className="req">*</span></label>
            <ImageUploadField id="image-file" required />
          </div>
          <div className="field">
            <label htmlFor="image-caption"><I18nText zh="图片说明" en="Caption" /></label>
            <input id="image-caption" name="caption" placeholder="留空使用文件名 / defaults to filename" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="image-insert-placement"><I18nText zh="插入位置" en="Placement" /></label>
              <select id="image-insert-placement" name="insertPlacement" defaultValue="after-intro">
                <option value="after-intro">导语后 / After intro</option>
                <option value="before-references">参考来源前 / Before references</option>
                <option value="end">文末 / End</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="image-source-page"><I18nText zh="图片来源链接（可选）" en="Image source URL (optional)" /></label>
              <input id="image-source-page" name="sourcePageUrl" type="url" placeholder="https://..." />
            </div>
          </div>
          {post.contentEn ? (
            <label>
              <input type="checkbox" name="mirrorToEnglish" value="true" defaultChecked /> <I18nText zh="同步插入英文正文" en="Also insert into English body" />
            </label>
          ) : null}
          <button className="button" type="submit"><I18nText zh="上传并插入图片" en="Upload & Insert" /></button>
        </form>
        <p className="hint">
          <I18nText
            zh="支持 JPG / PNG / WebP / GIF，单文件上限 8MB；重复上传同一图片只会复用同一个本地文件。"
            en="JPG / PNG / WebP / GIF up to 8MB; re-uploading the same image reuses the existing local file."
          />
        </p>
      </section>

      <section className="form-card form-stack" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="已挂载视频" en="Attached Videos" /></h2>
        {post.videos.length === 0 ? (
          <p className="muted-block">
            <I18nText
              zh={<>暂无视频。可在下方上传或在 <a className="text-link" href="/admin/videos">视频管理</a> 把已有视频挂到本文章。</>}
              en={<>No videos yet. Upload below or attach an existing one from <a className="text-link" href="/admin/videos">Videos</a>.</>}
            />
          </p>
        ) : (
          <ul className="form-stack" style={{ listStyle: "none", padding: 0 }}>
            {post.videos.map((video) => (
              <li key={video.id} className="meta-row" style={{ alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--color-border, #ddd)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{video.title}</strong>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {video.type} · <I18nText zh="展示：" en="Display: " />{video.displayMode === "link" ? <I18nText zh="链接" en="link" /> : <I18nText zh="嵌入" en="embed" />} · ID: <code>{video.id}</code>
                  </div>
                </div>
                <code style={{ fontSize: 12, marginRight: 12 }}>[[video:{video.id}]]</code>
                {video.type === "LOCAL" && video.localPath ? (
                  <span className="tag" style={{ marginRight: 8 }}>✓ <I18nText zh="本地" en="Local" /></span>
                ) : video.downloadStatus === "queued" || video.downloadStatus === "running" ? (
                  <span className="muted" style={{ fontSize: 12, marginRight: 8 }} role="status"><I18nText zh="下载中…" en="Downloading…" /></span>
                ) : (
                  <form action="/api/admin/videos/download" method="post" style={{ marginRight: 8 }}>
                    <input type="hidden" name="videoId" value={video.id} />
                    <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
                    <button className="button-secondary" type="submit">
                      {video.downloadStatus === "failed" ? <I18nText zh="重试下载" en="Retry download" /> : <I18nText zh="下载到本地" en="Download locally" />}
                    </button>
                  </form>
                )}
                <form action="/api/admin/videos/insert" method="post" className="meta-row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="id" value={video.id} />
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
                  <select name="displayMode" defaultValue={video.displayMode || "embed"}>
                    <option value="embed">嵌入 / Embed</option>
                    <option value="link">链接 / Link</option>
                  </select>
                  <select name="insertPlacement" defaultValue="before-references">
                    <option value="after-intro">导语后 / After intro</option>
                    <option value="before-references">参考来源前 / Before refs</option>
                    <option value="end">文末 / End</option>
                  </select>
                  <button className="button-secondary" type="submit"><I18nText zh="插入/调整位置" en="Insert / reposition" /></button>
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
                    <I18nText zh="删除" en="Delete" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="form-card form-stack" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="上传新视频并挂到本文章" en="Upload a Video to This Post" /></h2>
        <form action="/api/admin/videos" method="post" encType="multipart/form-data" className="form-stack">
          <input type="hidden" name="postId" value={post.id} />
          <div className="field">
            <label htmlFor="video-title"><I18nText zh="标题" en="Title" /></label>
            <input id="video-title" name="title" required defaultValue="视频资源" />
          </div>
          <div className="field">
            <label htmlFor="video-summary"><I18nText zh="说明" en="Description" /></label>
            <textarea id="video-summary" name="summary" />
          </div>
          <div className="field">
            <label htmlFor="video-type"><I18nText zh="类型" en="Type" /></label>
            <select id="video-type" name="type" defaultValue="LOCAL">
              <option value="LOCAL">本地上传 / Local upload</option>
              <option value="EMBED">嵌入 iframe / Embed</option>
              <option value="LINK">外链 / Link</option>
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="video-display-mode"><I18nText zh="文章展示方式" en="Display in post" /></label>
              <select id="video-display-mode" name="displayMode" defaultValue="embed">
                <option value="embed">嵌入播放器（默认）/ Embedded player</option>
                <option value="link">仅链接 / Link only</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="video-insert-placement"><I18nText zh="插入位置" en="Placement" /></label>
              <select id="video-insert-placement" name="insertPlacement" defaultValue="before-references">
                <option value="after-intro">导语后 / After intro</option>
                <option value="before-references">参考来源前 / Before refs</option>
                <option value="end">文末 / End</option>
              </select>
            </div>
          </div>
          <label>
            <input type="checkbox" name="insertShortcode" value="true" defaultChecked /> <I18nText zh="上传后自动插入到正文" en="Auto-insert into body after upload" />
          </label>
          <div className="field-row">
            <div className="field">
              <label htmlFor="video-file"><I18nText zh="文件（仅本地上传）" en="File (local upload only)" /></label>
              <input id="video-file" type="file" name="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" />
            </div>
            <div className="field">
              <label htmlFor="video-url"><I18nText zh="URL（嵌入或外链时填）" en="URL (for embed / link)" /></label>
              <input id="video-url" type="url" name="url" placeholder="https://..." />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="video-platform"><I18nText zh="来源平台（可选）" en="Platform (optional)" /></label>
              <input id="video-platform" name="sourcePlatform" placeholder="YouTube / Bilibili / ..." />
            </div>
            <div className="field">
              <label htmlFor="video-page"><I18nText zh="来源页面（可选）" en="Source page (optional)" /></label>
              <input id="video-page" name="sourcePageUrl" type="url" placeholder="https://..." />
            </div>
          </div>
          <div className="field">
            <label htmlFor="video-attribution"><I18nText zh="版权说明（可选）" en="Attribution (optional)" /></label>
            <textarea id="video-attribution" name="attribution" />
          </div>
          <div className="field">
            <label htmlFor="video-sort"><I18nText zh="排序（数值小的在前）" en="Sort order (asc)" /></label>
            <input id="video-sort" name="sortOrder" type="number" defaultValue={0} />
          </div>
          <button className="button" type="submit"><I18nText zh="上传并挂到本文章" en="Upload & Attach" /></button>
        </form>
        <p className="hint">
          <I18nText
            zh="默认会把上传的视频以嵌入模式插入到正文；也可以改成链接模式，或在上方列表重新调整位置。"
            en="Uploaded videos are inserted as embedded players by default; switch to link mode or reposition them in the list above."
          />
        </p>
      </section>

      <section className="form-card form-stack" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="把已有视频插入文章" en="Insert an Existing Video" /></h2>
        {allVideos.length === 0 ? (
          <p className="muted-block"><I18nText zh="暂无可选择的视频，可先在上方上传。" en="No videos available yet — upload one above first." /></p>
        ) : (
          <form action="/api/admin/videos/insert" method="post" className="form-stack">
            <input type="hidden" name="redirect" value={`/admin/posts/${post.id}`} />
            <input type="hidden" name="postId" value={post.id} />
            <div className="field">
              <label htmlFor="existing-video-id"><I18nText zh="选择已有视频" en="Choose a video" /></label>
              <select id="existing-video-id" name="id" required defaultValue="">
                <option value="" disabled>选择一个已有视频 / choose a video</option>
                {allVideos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title} · {video.type} · {(video.displayMode || "embed") === "link" ? "链接/link" : "嵌入/embed"}{video.postId && video.postId !== post.id ? " · 已挂载其他文章" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="existing-video-display-mode"><I18nText zh="文章展示方式" en="Display in post" /></label>
                <select id="existing-video-display-mode" name="displayMode" defaultValue="embed">
                  <option value="embed">嵌入播放器 / Embedded player</option>
                  <option value="link">仅链接 / Link only</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="existing-video-placement"><I18nText zh="插入位置" en="Placement" /></label>
                <select id="existing-video-placement" name="insertPlacement" defaultValue="before-references">
                  <option value="after-intro">导语后 / After intro</option>
                  <option value="before-references">参考来源前 / Before refs</option>
                  <option value="end">文末 / End</option>
                </select>
              </div>
            </div>
            <button className="button-secondary" type="submit"><I18nText zh="挂到本文章并插入" en="Attach & Insert" /></button>
          </form>
        )}
        <p className="hint">
          <I18nText
            zh={<>提交后会自动把 <code>[[video:ID]]</code> 写入正文；再次提交同一视频会先移除旧短代码再按新位置插入。</>}
            en={<>Submitting writes <code>[[video:ID]]</code> into the body; re-submitting the same video removes the old shortcode and re-inserts it at the new position.</>}
          />
        </p>
      </section>
    </AdminShell>
  );
}
