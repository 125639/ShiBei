import { AdminShell } from "@/components/AdminShell";
import { BulkPostActions } from "@/components/BulkPostActions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AdminPostsPage() {
  await requireAdmin();
  const posts = await prisma.post.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }], include: { videos: true } });

  return (
    <AdminShell>
      <p className="eyebrow">Posts</p>
      <h1>草稿与文章</h1>
      <form className="form-card form-stack" action="/api/admin/posts" method="post" encType="multipart/form-data" style={{ marginBottom: 18 }}>
        <h2>手动上传 / 新建博客内容</h2>
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
            <input id="sortOrder" name="sortOrder" type="number" defaultValue={posts.length} />
          </div>
        </div>
        <input type="hidden" name="kind" value="SINGLE_ARTICLE" />
        <button className="button" type="submit">创建文章</button>
      </form>

      <form className="form-card form-stack" action="/api/admin/videos" method="post" encType="multipart/form-data" style={{ marginBottom: 18 }}>
        <h2>上传 / 添加视频内容</h2>
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
      <section className="admin-panel">
        <BulkPostActions posts={posts.map((post) => ({
          id: post.id,
          title: post.title,
          summary: post.summary,
          status: post.status,
          videosCount: post.videos.length,
          sortOrder: (post as { sortOrder?: number }).sortOrder ?? 0
        }))} />
      </section>
    </AdminShell>
  );
}
