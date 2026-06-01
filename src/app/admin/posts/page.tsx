import Link from "next/link";
import type { PostStatus, Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { BulkPostActions } from "@/components/BulkPostActions";
import { Pagination } from "@/components/Pagination";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 40;

export default async function AdminPostsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  await requireAdmin();
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
        _count: { select: { videos: true } }
      }
    }),
    prisma.post.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));

  return (
    <AdminShell>
      <p className="eyebrow">Posts</p>
      <h1>草稿与文章</h1>

      <form className="form-card filter-form" action="/admin/posts" method="get" style={{ marginBottom: 24 }}>
        <div className="field">
          <label htmlFor="admin-post-search">搜索文章</label>
          <input id="admin-post-search" name="q" defaultValue={query} placeholder="标题、摘要或标签" />
        </div>
        <div className="field">
          <label htmlFor="admin-post-status">状态</label>
          <select id="admin-post-status" name="status" defaultValue={status || ""}>
            <option value="">全部</option>
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">已发布</option>
            <option value="ARCHIVED">已归档</option>
          </select>
        </div>
        <button className="button" type="submit">筛选</button>
        {(query || status) ? <Link className="button secondary" href="/admin/posts">清除</Link> : null}
      </form>

      <details className="form-card form-stack" style={{ marginBottom: 24 }}>
        <summary>手动上传 / 新建博客内容</summary>
      <form className="form-stack" action="/api/admin/posts" method="post" encType="multipart/form-data">
        <div className="field-row">
          <div className="field">
            <label htmlFor="title">标题</label>
            <input id="title" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="slug">Slug（可选）</label>
            <input id="slug" name="slug" placeholder="留空自动生成" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="summary">摘要</label>
          <textarea id="summary" name="summary" required />
        </div>
        <div className="field">
          <label htmlFor="content">正文 Markdown</label>
          <textarea id="content" name="content" required style={{ minHeight: 260 }} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="imageFile">正文配图（可选）</label>
            <input id="imageFile" name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif" />
          </div>
          <div className="field">
            <label htmlFor="imageCaption">图片说明</label>
            <input id="imageCaption" name="imageCaption" placeholder="留空使用文件名" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="imageInsertPlacement">图片插入位置</label>
            <select id="imageInsertPlacement" name="imageInsertPlacement" defaultValue="after-intro">
              <option value="after-intro">导语后</option>
              <option value="before-references">参考来源前</option>
              <option value="end">文末</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="imageSourcePageUrl">图片来源链接（可选）</label>
            <input id="imageSourcePageUrl" name="imageSourcePageUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tags">标签（逗号分隔）</label>
            <input id="tags" name="tags" placeholder="AI, 财经, 观察" />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">来源链接（可选）</label>
            <input id="sourceUrl" name="sourceUrl" type="url" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="status">状态</label>
            <select id="status" name="status" defaultValue="DRAFT">
              <option value="DRAFT">草稿</option>
              <option value="PUBLISHED">发布</option>
              <option value="ARCHIVED">归档</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sortOrder">排序（小的在前）</label>
            <input id="sortOrder" name="sortOrder" type="number" defaultValue={totalPosts} />
          </div>
        </div>
        <input type="hidden" name="kind" value="SINGLE_ARTICLE" />
        <button className="button" type="submit">创建文章</button>
      </form>
      </details>

      <details className="form-card form-stack" style={{ marginBottom: 24 }}>
        <summary>上传 / 添加视频内容</summary>
      <form className="form-stack" action="/api/admin/videos" method="post" encType="multipart/form-data">
        <div className="field-row">
          <div className="field">
            <label htmlFor="videoTitle">视频标题</label>
            <input id="videoTitle" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="videoPostId">关联文章（可选）</label>
            <select id="videoPostId" name="postId" defaultValue="">
              <option value="">不关联</option>
              {posts.map((post) => (
                <option key={post.id} value={post.id}>{post.title}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="videoSummary">视频说明</label>
          <textarea id="videoSummary" name="summary" required />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="videoFile">本地视频文件（可选）</label>
            <input id="videoFile" name="file" type="file" accept="video/*,.mp4,.webm,.mov,.m4v" />
          </div>
          <div className="field">
            <label htmlFor="videoUrl">视频链接（未上传文件时使用）</label>
            <input id="videoUrl" name="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="videoType">链接类型</label>
            <select id="videoType" name="type" defaultValue="EMBED">
              <option value="LINK">普通外链</option>
              <option value="EMBED">可嵌入链接</option>
              <option value="LOCAL">本地文件</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="videoSortOrder">排序（小的在前）</label>
            <input id="videoSortOrder" name="sortOrder" type="number" defaultValue="0" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="videoDisplayMode">文章展示方式</label>
          <select id="videoDisplayMode" name="displayMode" defaultValue="embed">
            <option value="embed">嵌入视频播放器（默认）</option>
            <option value="link">仅以链接形式插入</option>
          </select>
        </div>
        <button className="button" type="submit">保存视频</button>
      </form>
      </details>
      <section className="admin-panel">
        <div className="meta-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <strong>当前结果 {totalPosts} 篇</strong>
          <span className="muted">每页 {PAGE_SIZE} 篇</span>
        </div>
        <BulkPostActions posts={posts.map((post) => ({
          id: post.id,
          title: post.title,
          summary: post.summary,
          status: post.status,
          videosCount: post._count.videos,
          sortOrder: post.sortOrder
        }))} />
        <Pagination basePath="/admin/posts" page={page} totalPages={totalPages} params={{ q: query, status }} />
      </section>
    </AdminShell>
  );
}

function normalizePage(value: string | undefined) {
  const n = Number(value || 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function normalizeStatusFilter(value: string | undefined): PostStatus | null {
  if (value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED") return value;
  return null;
}
