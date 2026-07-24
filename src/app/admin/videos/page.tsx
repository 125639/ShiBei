import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { VideoReorderList } from "@/components/VideoReorderList";
import { requireAdmin } from "@/lib/auth";
import { hasLocalWorker } from "@/lib/app-mode";
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
    prisma.siteSettings.findUnique({
      where: { id: "site" },
      // ytDlpCookiesEnc 只用于推导"是否已配置"，密文绝不进浏览器载荷。
      select: { videosEnabled: true, ytDlpCookiesEnc: true, ytDlpCookiesUpdatedAt: true }
    }),
  ]);
  const videosEnabled = settings?.videosEnabled === true;
  const cookiesConfigured = Boolean(settings?.ytDlpCookiesEnc);
  const cookiesUpdatedAt = settings?.ytDlpCookiesUpdatedAt
    ? settings.ytDlpCookiesUpdatedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : null;

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
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Videos</p>
          <h1><I18nText zh="视频管理" en="Videos" /></h1>
        </div>
      </div>
      {!videosEnabled ? (
        <p className="muted-block" role="status" style={{ maxWidth: 720, borderLeft: "3px solid var(--color-danger, #c44)", paddingLeft: 12 }}>
          <I18nText
            zh={<>视频功能当前<strong>已关闭</strong>：前台文章不会展示任何视频，自动抓取也不会收集视频链接。可在 <a className="text-link" href="/admin/settings?tab=media">设置 → 媒体视频</a> 勾选「启用视频功能」后生效；这里的管理操作不受影响。</>}
            en={<>Videos are currently <strong>disabled</strong>: nothing renders on public posts and crawls skip video links. Enable them under <a className="text-link" href="/admin/settings?tab=media">Settings → Media</a>; management here still works.</>}
          />
        </p>
      ) : null}
      <p className="muted-block" style={{ maxWidth: 720 }}>
        {hasLocalWorker() ? (
          <I18nText
            zh={<>上传本地视频文件（MP4 / WebM / MOV / M4V，≤300 MB），或者添加 YouTube / Bilibili 等嵌入链接、外链。视频不再有独立页面，只通过 <code>[[video:ID]]</code> 短代码嵌入在文章正文中；默认以原平台链接/播放器形式展示，点击「下载到本地」可让后台把视频文件拉回本站，之后文章内直接用本地播放器播放。同一篇文章下的视频支持拖拽排序与三档预设位置。</>}
            en={<>Upload local files (MP4 / WebM / MOV / M4V, ≤300 MB) or add YouTube / Bilibili embeds and links. Videos have no standalone page — they only embed in posts via <code>[[video:ID]]</code> shortcodes. By default they render as links/players from the original platform; “Download locally” makes the worker fetch the file so the post plays it with a local player. Videos within a post support drag reordering and three preset placements.</>}
          />
        ) : (
          <I18nText
            zh={<>上传本地视频文件（MP4 / WebM / MOV / M4V，≤300 MB），或者添加 YouTube / Bilibili 等嵌入链接、外链。视频不再有独立页面，只通过 <code>[[video:ID]]</code> 短代码嵌入在文章正文中。本端（frontend 形态）没有下载 worker：「下载到本地」需要在 backend 上执行，随后通过 <a className="text-link" href="/admin/sync">同步</a> 的含视频 ZIP 把文件传到本端。同一篇文章下的视频支持拖拽排序与三档预设位置。</>}
            en={<>Upload local files (MP4 / WebM / MOV / M4V, ≤300 MB) or add YouTube / Bilibili embeds and links. Videos have no standalone page — they only embed in posts via <code>[[video:ID]]</code> shortcodes. This frontend deployment has no download worker: run “Download locally” on the backend, then bring the files over via a <a className="text-link" href="/admin/sync">sync</a> ZIP that includes them. Videos within a post support drag reordering and three preset placements.</>}
          />
        )}
      </p>

      <section className="form-card form-stack" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="YouTube 下载 Cookies" en="YouTube Download Cookies" /></h2>
        <p className="muted-block" style={{ margin: 0 }}>
          <I18nText
            zh={<>YouTube 对服务器机房 IP 的<strong>下载</strong>有「Sign in to confirm you’re not a bot」登录墙（搜索不受影响）。用浏览器扩展（如 “Get cookies.txt LOCALLY”）导出 Netscape 格式 <code>cookies.txt</code> 后，把内容<strong>粘贴</strong>到下面的框里、或直接<strong>上传</strong>文件，下载就会带上它。内容加密存储、仅下载瞬间解密到临时文件并即刻删除。<strong>注意：使用个人账号 cookies 有账号风控风险，建议使用小号。</strong></>}
            en={<>YouTube gates <strong>downloads</strong> from datacenter IPs behind a “Sign in to confirm you’re not a bot” wall (search is unaffected). Export a Netscape-format <code>cookies.txt</code> with a browser extension (e.g. “Get cookies.txt LOCALLY”), then <strong>paste</strong> its contents below or <strong>upload</strong> the file — downloads will use it. It is stored encrypted and only decrypted into a transient file during a download. <strong>Using personal-account cookies carries account risk — prefer a spare account.</strong></>}
          />
        </p>
        <p style={{ margin: 0 }}>
          {cookiesConfigured ? (
            <I18nText zh={<>状态：<strong>已配置</strong>{cookiesUpdatedAt ? `（更新于 ${cookiesUpdatedAt}）` : ""}</>} en={<>Status: <strong>configured</strong>{cookiesUpdatedAt ? ` (updated ${cookiesUpdatedAt})` : ""}</>} />
          ) : (
            <I18nText zh={<>状态：<strong>未配置</strong>（YouTube 下载大概率被登录墙拒绝）</>} en={<>Status: <strong>not configured</strong> (YouTube downloads will likely be rejected)</>} />
          )}
        </p>
        <form action="/api/admin/videos/cookies" method="post" encType="multipart/form-data" className="form-stack" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="cookiesText">
              <I18nText zh="粘贴 cookies 内容" en="Paste cookies content" />
            </label>
            <textarea
              id="cookiesText"
              name="cookiesText"
              rows={6}
              spellCheck={false}
              placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t…\t<name>\t<value>\n（用浏览器扩展导出后，把 cookies.txt 的内容整段粘贴到这里）"}
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.82rem", whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }}
            />
          </div>
          <div className="field">
            <label htmlFor="cookiesFile">
              <I18nText zh="或上传 cookies.txt 文件" en="Or upload a cookies.txt file" />
            </label>
            <input id="cookiesFile" type="file" name="cookiesFile" accept=".txt,text/plain" />
          </div>
          <div className="row-actions">
            <button className="button" type="submit">
              <I18nText zh={cookiesConfigured ? "更新 cookies" : "保存 cookies"} en={cookiesConfigured ? "Update cookies" : "Save cookies"} />
            </button>
          </div>
        </form>
        {cookiesConfigured ? (
          <form action="/api/admin/videos/cookies" method="post">
            <input type="hidden" name="action" value="clear" />
            <button className="button button-danger" type="submit"><I18nText zh="删除已存 cookies" en="Remove stored cookies" /></button>
          </form>
        ) : null}
      </section>

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
          <div className="empty-state">
            <p><I18nText zh="暂无视频。在上方上传一个开始。" en="No videos yet — upload one above to start." /></p>
          </div>
        ) : (
          <VideoReorderList
            videos={videoRows}
            posts={posts.map((p) => ({ id: p.id, title: p.title }))}
            formatBytes={formattedSizes}
            canDownloadLocally={hasLocalWorker()}
          />
        )}
      </section>
    </AdminShell>
  );
}
