import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminMarkdownWorkspace } from "@/components/AdminMarkdownWorkspace";
import { AdminShell } from "@/components/AdminShell";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DirtyAwareForm } from "@/components/DirtyAwareForm";
import { I18nText } from "@/components/I18nText";
import { ImageUploadField } from "@/components/ImageUploadField";
import { PostEditAssist } from "@/components/PostEditAssist";
import { SubmitButton } from "@/components/SubmitButton";
import { hasLocalWorker } from "@/lib/app-mode";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
import { generationPublicationBlockReason } from "@/lib/publication-policy";
import { parsePendingPostRevision } from "@/lib/post-revision";

export default async function AdminPostEditPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    publishError?: string;
    publishReason?: string;
    draftSaved?: string;
    revisionSaved?: string;
    revisionMediaBlocked?: string;
    editConflict?: string;
    editIntentError?: string;
  }>;
}) {
  await requireAdmin();
  const workerEnabled = hasLocalWorker();
  const { id } = await params;
  const query = await searchParams;
  const [post, allVideos] = await Promise.all([
    prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        title: true,
        titleEn: true,
        summary: true,
        summaryEn: true,
        content: true,
        contentEn: true,
        sourceUrl: true,
        sortOrder: true,
        status: true,
        updatedAt: true,
        publicationBlockedReason: true,
        pendingRevision: true,
        tags: { select: { id: true, name: true } },
        videos: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
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
            localPath: true,
            downloadStatus: true
          }
        }
      }
    }),
    prisma.video.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, type: true, displayMode: true, postId: true },
    }),
  ]);
  if (!post) notFound();
  const pendingRevision = parsePendingPostRevision(post.pendingRevision);
  const hasPendingRevision = post.pendingRevision !== null;
  const draft = pendingRevision || {
    title: post.title,
    titleEn: post.titleEn,
    summary: post.summary,
    summaryEn: post.summaryEn,
    content: post.content,
    contentEn: post.contentEn,
    sourceUrl: post.sourceUrl,
    sortOrder: post.sortOrder,
    tags: post.tags.map((tag) => tag.name)
  };
  const publicationBlock = generationPublicationBlockReason({
    publicationBlockedReason: post.publicationBlockedReason,
    summary: draft.summary,
    content: draft.content
  });

  return (
    <AdminShell>
      <header className="admin-page-header admin-post-edit-header">
        <div>
          <p className="eyebrow">Editorial workspace</p>
          <h1><I18nText zh="文章编辑工作台" en="Post Editor" /></h1>
          <p className="muted"><I18nText zh="在同一屏完成写作、成稿核对和发布设置。" en="Write, review the final rendering, and manage publication from one screen." /></p>
        </div>
        <div className="admin-page-actions">
          <Link className="button secondary" href="/admin/posts"><I18nText zh="返回文章列表" en="Back to posts" /></Link>
          {post.status === "PUBLISHED" ? (
            <Link className="button secondary" href={`/posts/${post.slug}`} target="_blank" rel="noopener"><I18nText zh="查看已发布文章 ↗" en="View published post ↗" /></Link>
          ) : null}
          <SubmitButton
            form="admin-post-edit-form"
            name="_intent"
            value={post.status === "PUBLISHED" ? "save_pending" : "save"}
            pendingLabel={<I18nText zh="保存中…" en="Saving…" />}
          >
            {post.status === "PUBLISHED"
              ? <I18nText zh="保存待审修改" en="Save pending revision" />
              : <I18nText zh="保存更改" en="Save changes" />}
          </SubmitButton>
        </div>
      </header>
      {query.revisionSaved === "1" ? (
        <div className="form-notice" role="status">
          <I18nText zh="待审修改已保存，线上文章没有变化。" en="The pending revision was saved; the live article is unchanged." />
        </div>
      ) : null}
      {query.revisionMediaBlocked === "1" ? (
        <div className="form-error" role="alert">
          <I18nText zh="媒体操作已取消：这篇文章有待审修改。请先发布或放弃待审版本，避免媒体被写入错误的线上版本。" en="The media action was cancelled because this post has a pending revision. Publish or discard it first." />
        </div>
      ) : null}
      {query.editConflict === "1" ? (
        <div className="form-error" role="alert">
          <I18nText zh="保存已取消：这篇文章在你编辑期间已被其他操作更新。页面已加载最新版本，请核对后再保存。" en="Save cancelled because the post changed while you were editing. Review the latest version and try again." />
        </div>
      ) : null}
      {query.editIntentError === "1" ? (
        <div className="form-error" role="alert">
          <I18nText zh="操作已取消：已发布文章只能“保存待审修改”或“检查并更新线上”。" en="Action cancelled. A published post must be saved as a pending revision or explicitly checked and published." />
        </div>
      ) : null}
      {query.publishError === "blocked" ? (
        <div className="form-error" role="alert">
          {query.publishReason || (query.draftSaved === "pending"
            ? "这次修改仍未通过发布检查；线上原版本未变，修改已保存为待审核版本。"
            : query.draftSaved === "1"
              ? "这篇内容仍未通过发布检查；你的修改已保存为草稿。"
              : "这篇内容仍未通过发布检查，已保持为草稿。")}
        </div>
      ) : null}
      {hasPendingRevision ? (
        <div className="form-notice" role="status">
          {pendingRevision ? (
            <I18nText
              zh={`当前编辑器加载的是待审核修改；网站仍展示上一次已发布的版本。当前检查提示：${pendingRevision.gateReason}`}
              en={`The editor is showing a pending revision while readers still see the previous version. Current review note: ${pendingRevision.gateReason}`}
            />
          ) : (
            <I18nText
              zh="检测到一份旧版或损坏的待审数据，系统未把它覆盖到编辑器，也已继续锁定媒体操作。请放弃这份无效待审数据后再编辑。"
              en="An unreadable legacy pending revision was found. It was not loaded into the editor and media remains locked. Discard it before editing."
            />
          )}
          <form action={`/api/admin/posts/${post.id}/pending-revision`} method="post" style={{ marginTop: 10 }}>
            <input type="hidden" name="expectedUpdatedAt" value={post.updatedAt.toISOString()} />
            <ConfirmButton className="button ghost" message="确定放弃这份待审修改吗？线上版本不会受影响，但待审正文无法恢复。">
              <I18nText zh="放弃待审修改" en="Discard pending revision" />
            </ConfirmButton>
          </form>
        </div>
      ) : null}
      {publicationBlock ? (
        <div className="form-error" role="alert">
          <I18nText
            zh={`不可直接发布：${publicationBlock}。请先依据原始资料改写正文和摘要；保存为“已发布”时系统会重新检查引用与来源。`}
            en={`Publication blocked: ${publicationBlock}. Rewrite from the source material; the publish action will re-check citations and sources.`}
          />
        </div>
      ) : null}
      <DirtyAwareForm id="admin-post-edit-form" className="admin-post-edit-form" action={`/api/admin/posts/${post.id}`}>
        <input type="hidden" name="expectedUpdatedAt" value={post.updatedAt.toISOString()} />
        <div className="admin-post-edit-main">
          <section className="form-card form-stack admin-post-identity-card">
            <div className="field">
              <label htmlFor="title"><I18nText zh="文章标题" en="Post title" /><span aria-hidden="true" className="req">*</span></label>
              <input className="admin-post-title-input" id="title" name="title" defaultValue={draft.title} required />
            </div>
            <div className="field">
              <label htmlFor="summary"><I18nText zh="摘要" en="Summary" /><span aria-hidden="true" className="req">*</span></label>
              <textarea id="summary" name="summary" defaultValue={draft.summary} required rows={4} />
              <p className="hint"><I18nText zh="摘要会出现在文章列表和搜索结果中，建议直接说明核心结论。" en="This appears in lists and search results; state the central takeaway directly." /></p>
            </div>
          </section>

          <section className="form-card admin-post-editor-card">
            <AdminMarkdownWorkspace
              id="content"
              name="content"
              initialValue={draft.content}
              required
              previewVideos={post.videos}
              label={<><I18nText zh="中文正文" en="Chinese body" /><span aria-hidden="true" className="req">*</span></>}
            />
            <p className="hint admin-post-shortcode-hint">
              <I18nText
                zh={<>视频可用 <code>[[video:VIDEO_ID]]</code> 放到指定段落；未引用的视频会自动展示在文末「相关视频」。</>}
                en={<>Use <code>[[video:VIDEO_ID]]</code> to place a video in a specific paragraph; unattached shortcodes appear in Related Videos.</>}
              />
            </p>
          </section>

          <details className="form-card form-stack admin-post-translation-card" open={Boolean(draft.titleEn || draft.summaryEn || draft.contentEn)}>
            <summary><I18nText zh="英文版本（可选）" en="English version (optional)" /></summary>
            <div className="field-row">
              <div className="field">
                <label htmlFor="titleEn"><I18nText zh="英文标题" en="English title" /></label>
                <input id="titleEn" name="titleEn" defaultValue={draft.titleEn || ""} />
              </div>
              <div className="field">
                <label htmlFor="summaryEn"><I18nText zh="英文摘要" en="English summary" /></label>
                <textarea id="summaryEn" name="summaryEn" defaultValue={draft.summaryEn || ""} rows={3} />
              </div>
            </div>
            <AdminMarkdownWorkspace
              id="contentEn"
              name="contentEn"
              initialValue={draft.contentEn || ""}
              compact
              previewVideos={post.videos}
              label={<I18nText zh="英文正文" en="English body" />}
            />
          </details>
        </div>

        <aside className="admin-post-edit-sidebar">
          <section className="form-card form-stack admin-post-publish-card">
            <div className="admin-post-publish-head">
              <div>
                <span className="muted"><I18nText zh="当前状态" en="Current status" /></span>
                <strong>{post.status === "PUBLISHED" ? <I18nText zh="已发布" en="Published" /> : post.status === "ARCHIVED" ? <I18nText zh="已归档" en="Archived" /> : <I18nText zh="草稿" en="Draft" />}</strong>
              </div>
              <span className={`tag status-${post.status.toLowerCase()}`}>{post.status}</span>
            </div>
            {publicationBlock ? (
              <div className="admin-post-block-note" role="note">
                <strong><I18nText zh="发布检查未通过" en="Publication blocked" /></strong>
                <span>{publicationBlock}</span>
              </div>
            ) : null}
            {post.status === "PUBLISHED" ? (
              <>
                <input type="hidden" name="status" value="PUBLISHED" />
                <p className="hint"><I18nText zh="保存待审修改不会影响线上版本；只有“检查并更新线上”通过引用与来源门禁后才会替换正文。" en="Saving a pending revision does not affect the live version. Only a successful publication check replaces it." /></p>
                <div className="model-config-actions">
                  <SubmitButton className="button secondary" name="_intent" value="save_pending" pendingLabel={<I18nText zh="正在保存…" en="Saving…" />}>
                    <I18nText zh="保存待审修改" en="Save pending revision" />
                  </SubmitButton>
                  <SubmitButton name="_intent" value="publish_revision" pendingLabel={<I18nText zh="正在检查并发布…" en="Checking and publishing…" />}>
                    <I18nText zh="检查并更新线上" en="Check & update live" />
                  </SubmitButton>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="status"><I18nText zh="保存后的状态" en="Status after saving" /></label>
                  <select id="status" name="status" defaultValue={post.status}>
                    <option value="DRAFT">保留为草稿 / Keep draft</option>
                    <option value="PUBLISHED">发布到网站 / Publish</option>
                    <option value="ARCHIVED">移入归档 / Archive</option>
                  </select>
                  <p className="hint"><I18nText zh="选择“发布”后仍会先执行引用和来源检查。" en="Publishing still runs citation and source checks first." /></p>
                </div>
                <SubmitButton name="_intent" value="save" pendingLabel={<I18nText zh="正在保存并检查…" en="Saving and checking…" />}><I18nText zh="保存全部更改" en="Save all changes" /></SubmitButton>
              </>
            )}
          </section>

          <section className="form-card form-stack admin-post-settings-card">
            <h2><I18nText zh="文章设置" en="Post settings" /></h2>
            <div className="field">
              <label htmlFor="tags"><I18nText zh="标签" en="Tags" /></label>
              <input id="tags" name="tags" defaultValue={draft.tags.join(", ")} placeholder="AI, 财经, 观察" />
              <p className="hint"><I18nText zh="用逗号分隔，最多 12 个。" en="Comma separated, up to 12." /></p>
            </div>
            <div className="field">
              <label htmlFor="sourceUrl"><I18nText zh="管理员核验的主来源" en="Editor-approved primary source" /></label>
              <input id="sourceUrl" name="sourceUrl" type="url" defaultValue={draft.sourceUrl || ""} placeholder="https://..." />
              <p className="hint">
                <I18nText
                  zh="发布受阻草稿时，这里填写的 HTTP(S) 链接会加入来源白名单；正文仍须在相关事实旁引用，并在文末参考来源中列出。"
                  en="For a blocked draft, this HTTP(S) URL joins the approved allowlist; cite it beside the supported claims and in the final references."
                />
              </p>
            </div>
            <div className="field">
              <label htmlFor="sortOrder"><I18nText zh="显示顺序" en="Display order" /></label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={draft.sortOrder} />
              <p className="hint"><I18nText zh="数值越小越靠前。" en="Lower numbers appear first." /></p>
            </div>
          </section>
        </aside>
      </DirtyAwareForm>

      {workerEnabled ? <PostEditAssist /> : null}

      {hasPendingRevision ? (
        <section className="form-card form-stack" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="媒体工具暂时锁定" en="Media tools are temporarily locked" /></h2>
          <p className="muted-block">
            <I18nText
              zh="为避免图片或视频被写进仍在线的旧版本、随后又被待审稿覆盖，请先保存并发布待审修改，或在上方放弃它。正文中的现有媒体短代码不会丢失。"
              en="To keep media from changing the old live version or being overwritten by the pending revision, publish or discard the pending revision first. Existing media shortcodes remain intact."
            />
          </p>
        </section>
      ) : (
        <>
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
                    {video.type} · <I18nText zh="展示：" en="Display: " />{video.displayMode === "link" ? <I18nText zh="链接" en="link" /> : <I18nText zh="嵌入" en="embed" />}
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
                    <button className="button secondary" type="submit">
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
                  <button className="button secondary" type="submit"><I18nText zh="插入/调整位置" en="Insert / reposition" /></button>
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
            <button className="button secondary" type="submit"><I18nText zh="挂到本文章并插入" en="Attach & Insert" /></button>
          </form>
        )}
        <p className="hint">
          <I18nText
            zh={<>提交后会自动把 <code>[[video:ID]]</code> 写入正文；再次提交同一视频会先移除旧短代码再按新位置插入。</>}
            en={<>Submitting writes <code>[[video:ID]]</code> into the body; re-submitting the same video removes the old shortcode and re-inserts it at the new position.</>}
          />
        </p>
      </section>
        </>
      )}
    </AdminShell>
  );
}
