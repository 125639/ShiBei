import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { VideoReorderList } from "@/components/VideoReorderList";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function VideosAdminPage() {
  await requireAdmin();

  const [videos, posts, settings] = await Promise.all([
    prisma.video.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        type: true,
        url: true,
        displayMode: true,
        lastPlacement: true,
        fileSizeBytes: true,
        localPath: true,
        downloadStatus: true,
        downloadError: true,
        post: { select: { id: true, title: true, slug: true } }
      },
    }),
    prisma.post.findMany({
      where: { status: { in: ["DRAFT", "PUBLISHED"] } },
      select: { id: true, title: true, slug: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.siteSettings.findUnique({ where: { id: "site" }, select: { videosEnabled: true } }),
  ]);
  const videosEnabled = settings?.videosEnabled === true;

  const videoRows = videos.map((video) => ({
    id: video.id,
    title: video.title,
    type: String(video.type),
    url: video.url,
    displayMode: video.displayMode || "embed",
    lastPlacement: video.lastPlacement || null,
    fileSizeBytes: video.fileSizeBytes ?? null,
    localPath: video.localPath ?? null,
    downloadStatus: video.downloadStatus ?? null,
    downloadError: video.downloadError ?? null,
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
      <h1><I18nText zh="视频管理" en="Videos" /></h1>
      {!videosEnabled ? (
        <p className="muted-block" role="status" style={{ maxWidth: 720, borderLeft: "3px solid var(--color-danger, #c44)", paddingLeft: 12 }}>
          <I18nText
            zh={<>视频功能当前<strong>已关闭</strong>：前台文章不会展示任何视频，自动抓取也不会收集视频链接。可在 <a className="text-link" href="/admin/settings?tab=media">设置 → 媒体视频</a> 勾选「启用视频功能」后生效；这里的管理操作不受影响。</>}
            en={<>Videos are currently <strong>disabled</strong>: nothing renders on public posts and crawls skip video links. Enable them under <a className="text-link" href="/admin/settings?tab=media">Settings → Media</a>; management here still works.</>}
          />
        </p>
      ) : null}
      <p className="muted-block" style={{ maxWidth: 720 }}>
        <I18nText
          zh={<>上传本地视频文件（MP4 / WebM / MOV / M4V，≤300 MB），或者添加 YouTube / Bilibili 等嵌入链接、外链。视频不再有独立页面，只通过 <code>[[video:ID]]</code> 短代码嵌入在文章正文中；默认以原平台链接/播放器形式展示，点击「下载到本地」可让后台把视频文件拉回本站，之后文章内直接用本地播放器播放。同一篇文章下的视频支持拖拽排序与三档预设位置。</>}
          en={<>Upload local files (MP4 / WebM / MOV / M4V, ≤300 MB) or add YouTube / Bilibili embeds and links. Videos have no standalone page — they only embed in posts via <code>[[video:ID]]</code> shortcodes. By default they render as links/players from the original platform; “Download locally” makes the worker fetch the file so the post plays it with a local player. Videos within a post support drag reordering and three preset placements.</>}
        />
      </p>

      <form
        className="form-card form-stack"
        action="/api/admin/videos"
        method="post"
        encType="multipart/form-data"
        style={{ maxWidth: 720 }}
      >
        <h2 style={{ marginTop: 0 }}><I18nText zh="上传 / 添加视频" en="Upload / Add Video" /></h2>
        <div className="field">
          <label htmlFor="title"><I18nText zh="标题" en="Title" /></label>
          <input id="title" name="title" required defaultValue="视频资源" />
        </div>
        <div className="field">
          <label htmlFor="summary"><I18nText zh="说明" en="Description" /></label>
          <textarea id="summary" name="summary" />
        </div>
        <div className="field">
          <label htmlFor="type"><I18nText zh="类型" en="Type" /></label>
          <select id="type" name="type" defaultValue="LOCAL">
            <option value="LOCAL">本地上传 / Local upload</option>
            <option value="EMBED">嵌入 iframe 播放器 / Embed</option>
            <option value="LINK">外链 / Link</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="displayMode"><I18nText zh="文章展示方式" en="Display in post" /></label>
          <select id="displayMode" name="displayMode" defaultValue="embed">
            <option value="embed">嵌入播放器（默认）/ Embedded player</option>
            <option value="link">仅以链接插入 / Link only</option>
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="file"><I18nText zh="文件（仅本地上传）" en="File (local upload only)" /></label>
            <input
              id="file"
              type="file"
              name="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
            />
          </div>
          <div className="field">
            <label htmlFor="url"><I18nText zh="URL（嵌入或外链时填）" en="URL (for embed / link)" /></label>
            <input id="url" type="url" name="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sourcePlatform"><I18nText zh="来源平台（可选）" en="Platform (optional)" /></label>
            <input id="sourcePlatform" name="sourcePlatform" placeholder="YouTube / Bilibili / ..." />
          </div>
          <div className="field">
            <label htmlFor="sourcePageUrl"><I18nText zh="来源页面（可选）" en="Source page (optional)" /></label>
            <input id="sourcePageUrl" name="sourcePageUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field">
          <label htmlFor="attribution"><I18nText zh="版权说明（可选）" en="Attribution (optional)" /></label>
          <textarea id="attribution" name="attribution" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="postId"><I18nText zh="挂到哪篇文章（可选）" en="Attach to post (optional)" /></label>
            <select id="postId" name="postId" defaultValue="">
              <option value="">不挂载 / None</option>
              {posts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sortOrder"><I18nText zh="排序（小的在前）" en="Sort order (asc)" /></label>
            <input id="sortOrder" name="sortOrder" type="number" defaultValue={videos.length} />
          </div>
        </div>
        <button className="button" type="submit"><I18nText zh="保存" en="Save" /></button>
      </form>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh={`当前视频（${videos.length}）`} en={`Videos (${videos.length})`} /></h2>
        {videos.length === 0 ? (
          <p className="muted"><I18nText zh="暂无视频。在上方上传一个开始。" en="No videos yet — upload one above to start." /></p>
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
