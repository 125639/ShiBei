import Link from "next/link";
import { AiAssistant } from "@/components/AiAssistant";
import { I18nText } from "@/components/I18nText";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const [posts, videos, settings] = await Promise.all([
    prisma.post.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
      take: 6,
      include: { tags: true }
    }),
    prisma.video.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 3 }),
    prisma.siteSettings.findUnique({ where: { id: "site" } })
  ]);

  return (
    <PublicShell>
      <main className="container">
        <section className="hero">
          <div>
            <p className="eyebrow">ShiBei · 自动整理 · 手动发布</p>
            <h1><I18nText zh="轻量前台展示文章，后端负责整理与同步。" en="A lightweight front end for articles, backed by automated curation and sync." /></h1>
          </div>
          <div className="hero-panel">
            <p>
              <I18nText
                zh={settings?.description || "后端应用抓取与生成文章，前端应用可自动拉取或手动导入 ZIP；视频可在前端手动上传并嵌入任意文章。"}
                en="The backend gathers and prepares articles; the frontend can auto-sync or import ZIP bundles, with videos uploaded manually into any post."
              />
            </p>
            <Link className="button" href="/news">
              <I18nText zh="阅读最新总结" en="Read Latest" />
            </Link>
          </div>
        </section>

        <AiAssistant
          contextLabel="博客主页"
          context={[
            settings?.description || "拾贝 信息博客",
            ...posts.map((post) => `${post.title}\n${post.summary}`)
          ].join("\n\n")}
        />

        <section>
          <div className="section-heading">
            <h2>最新新闻总结</h2>
            <Link className="text-link" href="/news">
              <I18nText zh="查看全部" en="View All" />
            </Link>
          </div>
          <div className="grid">
            {posts.length ? (
              posts.map((post) => (
                <Link className="card" key={post.id} href={`/news/${post.slug}`}>
                  <div>
                    <div className="meta-row">
                      <span>{post.publishedAt?.toLocaleDateString("zh-CN") || "未发布"}</span>
                      {post.tags.slice(0, 2).map((tag) => (
                        <span className="tag" key={tag.id}>{tag.name}</span>
                      ))}
                    </div>
                    <h3><I18nText zh={post.title} en={(post as { titleEn?: string | null }).titleEn || post.title} /></h3>
                    <p><I18nText zh={post.summary} en={(post as { summaryEn?: string | null }).summaryEn || post.summary} /></p>
                  </div>
                  <span className="text-link"><I18nText zh="阅读全文" en="Read More" /></span>
                </Link>
              ))
            ) : (
              <div className="card">
                <h3><I18nText zh="还没有发布内容" en="No Published Content Yet" /></h3>
                <p><I18nText zh="进入后台添加信息源，运行抓取与总结任务，审核后即可出现在这里。" en="Add sources in the admin area, run fetch and summarization jobs, then publish reviewed drafts here." /></p>
                <Link className="text-link" href="/admin"><I18nText zh="进入后台" en="Admin" /></Link>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-heading">
            <h2>视频资源</h2>
            <Link className="text-link" href="/videos">
              <I18nText zh="查看全部" en="View All" />
            </Link>
          </div>
          <div className="grid">
            {videos.length ? (
              videos.map((video) => (
                <Link className="card" key={video.id} href={`/videos/${video.id}`}>
                  <div>
                    <div className="meta-row"><span>{video.type}</span></div>
                    <h3>{video.title}</h3>
                    <p>{video.summary}</p>
                  </div>
                  <span className="text-link"><I18nText zh="查看视频" en="View Video" /></span>
                </Link>
              ))
            ) : (
              <div className="card">
                <h3><I18nText zh="等待关联视频" en="Waiting for Videos" /></h3>
                <p><I18nText zh="抓取页面时识别到的视频链接，会作为文章关联资源展示。" en="Video links found during fetching will appear as related resources for articles." /></p>
              </div>
            )}
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
