import Link from "next/link";
import { redirect } from "next/navigation";
import type { PostStatus, Prisma } from "@prisma/client";
import { AdminMarkdownWorkspace } from "@/components/AdminMarkdownWorkspace";
import { AdminShell } from "@/components/AdminShell";
import { BulkPostActions } from "@/components/BulkPostActions";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { SubmitButton } from "@/components/SubmitButton";
import { hasLocalWorker } from "@/lib/app-mode";
import { requireAdmin } from "@/lib/auth";
import { normalizePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

const STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档"
};

export default async function AdminPostsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; publishError?: string; blockedCount?: string }> }) {
  await requireAdmin();
  const workerEnabled = hasLocalWorker();
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) || "";
  const status = normalizeStatusFilter(params.status);
  const page = normalizePage(params.page);
  const where: Prisma.PostWhereInput = {
    ...(status ? { status } : {}),
    ...(query ? {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { tags: { some: { name: { contains: query, mode: "insensitive" } } } }
      ]
    } : {})
  };

  const [posts, totalPosts] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        summary: true,
        status: true,
        sortOrder: true,
        updatedAt: true,
        publicationBlockedReason: true,
        pendingRevision: true,
        _count: { select: { videos: true } }
      }
    }),
    prisma.post.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));

  // 页码超出实际范围（删除文章后回访旧链接等）时回到最后一页。
  if (totalPosts > 0 && page > totalPages) {
    const back = new URLSearchParams();
    if (query) back.set("q", query);
    if (status) back.set("status", status);
    if (totalPages > 1) back.set("page", String(totalPages));
    const qs = back.toString();
    redirect(qs ? `/admin/posts?${qs}` : "/admin/posts");
  }

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Posts</p>
          <h1><I18nText zh="草稿与文章" en="Drafts & Posts" /></h1>
        </div>
      </div>
      {params.publishError === "blocked" || params.publishError === "pending_revision" ? (
        <div className="form-error" role="alert">
          {params.publishError === "pending_revision" ? (
            <I18nText
              zh={`所选内容中有 ${Math.max(1, Number(params.blockedCount) || 1)} 篇包含待审核修改，批量状态操作已取消。请逐篇决定发布或放弃待审版本。`}
              en="The bulk status change was cancelled because one or more posts have pending revisions. Review or discard them individually."
            />
          ) : (
            <I18nText
              zh={workerEnabled
                ? `所选内容中有 ${Math.max(1, Number(params.blockedCount) || 1)} 篇未通过发布检查。列表会直接显示每篇阻断原因；也可选择“AI 审核、返修并发布”，由系统按意见最多返修 3 轮。`
                : `所选内容中有 ${Math.max(1, Number(params.blockedCount) || 1)} 篇未通过发布检查。列表会直接显示每篇阻断原因；frontend 节点不运行 AI 返修，请在 backend 节点处理或逐篇人工修正。`}
              en={workerEnabled
                ? "One or more posts failed publication checks. Each row now shows the exact reason; use AI review, repair, and publish for up to three audited repair rounds."
                : "One or more posts failed publication checks. This frontend node has no AI repair worker; use the backend node or correct each draft manually."}
            />
          )}
        </div>
      ) : null}

      <form className="form-card filter-form" action="/admin/posts" method="get" style={{ marginBottom: 24 }}>
        <div className="field">
          <label htmlFor="admin-post-search"><I18nText zh="搜索文章" en="Search posts" /></label>
          <input id="admin-post-search" name="q" defaultValue={query} placeholder="标题、摘要或标签 / title, summary or tag" />
        </div>
        <div className="field">
          <label htmlFor="admin-post-status"><I18nText zh="状态" en="Status" /></label>
          <select id="admin-post-status" name="status" defaultValue={status || ""}>
            <option value="">全部 / All</option>
            <option value="DRAFT">草稿 / Draft</option>
            <option value="PUBLISHED">已发布 / Published</option>
            <option value="ARCHIVED">已归档 / Archived</option>
          </select>
        </div>
        <button className="button" type="submit"><I18nText zh="筛选" en="Filter" /></button>
        {(query || status) ? <Link className="button secondary" href="/admin/posts"><I18nText zh="清除" en="Clear" /></Link> : null}
      </form>

      <details className="form-card form-stack" style={{ marginBottom: 24 }}>
        <summary><I18nText zh="手动上传 / 新建博客内容" en="Create / upload a post manually" /></summary>
      <form className="form-stack" action="/api/admin/posts" method="post" encType="multipart/form-data">
        <div className="field-row">
          <div className="field">
            <label htmlFor="title"><I18nText zh="标题" en="Title" /></label>
            <input id="title" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="slug"><I18nText zh="Slug（可选）" en="Slug (optional)" /></label>
            <input id="slug" name="slug" placeholder="留空自动生成 / auto-generated if empty" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="summary"><I18nText zh="摘要" en="Summary" /></label>
          <textarea id="summary" name="summary" required />
        </div>
        <AdminMarkdownWorkspace
          id="content"
          name="content"
          initialValue=""
          required
          compact
          label={<><I18nText zh="正文" en="Body" /><span aria-hidden="true" className="req">*</span></>}
        />
        <div className="field-row">
          <div className="field">
            <label htmlFor="imageFile"><I18nText zh="正文配图（可选）" en="Body image (optional)" /></label>
            <input id="imageFile" name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif" />
          </div>
          <div className="field">
            <label htmlFor="imageCaption"><I18nText zh="图片说明" en="Image caption" /></label>
            <input id="imageCaption" name="imageCaption" placeholder="留空使用文件名 / defaults to filename" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="imageInsertPlacement"><I18nText zh="图片插入位置" en="Image placement" /></label>
            <select id="imageInsertPlacement" name="imageInsertPlacement" defaultValue="after-intro">
              <option value="after-intro">导语后 / After intro</option>
              <option value="before-references">参考来源前 / Before references</option>
              <option value="end">文末 / End</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="imageSourcePageUrl"><I18nText zh="图片来源链接（可选）" en="Image source URL (optional)" /></label>
            <input id="imageSourcePageUrl" name="imageSourcePageUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tags"><I18nText zh="标签（逗号分隔）" en="Tags (comma separated)" /></label>
            <input id="tags" name="tags" placeholder="AI, 财经, 观察" />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl"><I18nText zh="来源链接（可选）" en="Source URL (optional)" /></label>
            <input id="sourceUrl" name="sourceUrl" type="url" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="status"><I18nText zh="状态" en="Status" /></label>
            <select id="status" name="status" defaultValue="DRAFT">
              <option value="DRAFT">草稿 / Draft</option>
              <option value="PUBLISHED">发布 / Published</option>
              <option value="ARCHIVED">归档 / Archived</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sortOrder"><I18nText zh="排序（小的在前）" en="Sort order (asc)" /></label>
            <input id="sortOrder" name="sortOrder" type="number" defaultValue={totalPosts} />
          </div>
        </div>
        <input type="hidden" name="kind" value="SINGLE_ARTICLE" />
        <SubmitButton pendingLabel={<I18nText zh="创建中…" en="Creating…" />}><I18nText zh="创建文章" en="Create Post" /></SubmitButton>
      </form>
      </details>

      <details className="form-card form-stack" style={{ marginBottom: 24 }}>
        <summary><I18nText zh="上传 / 添加视频内容" en="Upload / add a video" /></summary>
      <form className="form-stack" action="/api/admin/videos" method="post" encType="multipart/form-data">
        <div className="field-row">
          <div className="field">
            <label htmlFor="videoTitle"><I18nText zh="视频标题" en="Video title" /></label>
            <input id="videoTitle" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="videoPostId"><I18nText zh="关联文章（可选）" en="Attach to post (optional)" /></label>
            <select id="videoPostId" name="postId" defaultValue="">
              <option value="">不关联 / None</option>
              {posts.map((post) => (
                <option key={post.id} value={post.id}>{post.title}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="videoSummary"><I18nText zh="视频说明" en="Video description" /></label>
          <textarea id="videoSummary" name="summary" required />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="videoFile"><I18nText zh="本地视频文件（可选）" en="Local video file (optional)" /></label>
            <input id="videoFile" name="file" type="file" accept="video/*,.mp4,.webm,.mov,.m4v" />
          </div>
          <div className="field">
            <label htmlFor="videoUrl"><I18nText zh="视频链接（未上传文件时使用）" en="Video URL (when no file)" /></label>
            <input id="videoUrl" name="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="videoType"><I18nText zh="链接类型" en="Link type" /></label>
            <select id="videoType" name="type" defaultValue="EMBED">
              <option value="LINK">普通外链 / Link</option>
              <option value="EMBED">可嵌入链接 / Embed</option>
              <option value="LOCAL">本地文件 / Local</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="videoSortOrder"><I18nText zh="排序（小的在前）" en="Sort order (asc)" /></label>
            <input id="videoSortOrder" name="sortOrder" type="number" defaultValue="0" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="videoDisplayMode"><I18nText zh="文章展示方式" en="Display in post" /></label>
          <select id="videoDisplayMode" name="displayMode" defaultValue="embed">
            <option value="embed">嵌入视频播放器（默认）/ Embedded player</option>
            <option value="link">仅以链接形式插入 / Link only</option>
          </select>
        </div>
        <SubmitButton pendingLabel={<I18nText zh="上传中，视频文件可能需要几分钟…" en="Uploading, large files may take minutes…" />}><I18nText zh="保存视频" en="Save Video" /></SubmitButton>
      </form>
      </details>
      <section className="admin-panel">
        <div className="meta-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <strong><I18nText zh={`当前结果 ${totalPosts} 篇`} en={`${totalPosts} posts found`} /></strong>
          <span className="muted"><I18nText zh={`每页 ${PAGE_SIZE} 篇`} en={`${PAGE_SIZE} per page`} /></span>
        </div>
        {totalPosts === 0 && (query || status) ? (
          <div className="empty-state">
            <p>
              <I18nText
                zh={`没有找到匹配${query ? `「${query}」` : ""}${status ? `（状态：${STATUS_LABELS[status]}）` : ""}的文章。`}
                en={`No posts matched${query ? ` "${query}"` : ""}${status ? ` (status: ${status})` : ""}.`}
              />
            </p>
            <div className="row-actions">
              <Link className="button secondary" href="/admin/posts"><I18nText zh="清除筛选" en="Clear filters" /></Link>
            </div>
          </div>
        ) : (
          <BulkPostActions allowAiRepair={workerEnabled} posts={posts.map((post) => ({
            id: post.id,
            title: post.title,
            summary: post.summary,
            status: post.status,
            videosCount: post._count.videos,
            sortOrder: post.sortOrder,
            updatedAt: post.updatedAt.toISOString(),
            publicationBlockedReason: post.publicationBlockedReason,
            pendingRevision: post.pendingRevision !== null
          }))} />
        )}
        <Pagination basePath="/admin/posts" page={page} totalPages={totalPages} params={{ q: query, status }} />
      </section>
    </AdminShell>
  );
}

function normalizeStatusFilter(value: string | undefined): PostStatus | null {
  if (value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED") return value;
  return null;
}
