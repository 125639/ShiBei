import Link from "next/link";
import { AiAssistant } from "@/components/AiAssistant";
import { I18nText } from "@/components/I18nText";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";

const HOME_POST_VARIANTS = ["bento-large", "bento-wide"] as const;
const HOME_VIDEO_VARIANTS = ["bento-wide"] as const;

export default async function HomePage() {
  const [posts, videos, settings, publishedPostCount, videoCount] = await Promise.all([
    prisma.post.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
      take: 6,
      include: { tags: true }
    }),
    prisma.video.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 3 }),
    prisma.siteSettings.findUnique({ where: { id: "site" } }),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
    prisma.video.count()
  ]);

  const description = settings?.description || "后端整理与同步，前端轻量展示。";

  return (
    <PublicShell>
      <main className="container-wide bento-page">
        <section className="apple-hero" aria-label="ShiBei overview">
          <p className="eyebrow-apple">ShiBei · 信息整理与发布</p>
          <h1>
            <I18nText
              zh="把内容整理得清晰，再呈现给你。"
              en="Clarity, curated and ready to read."
            />
          </h1>
          <p className="lead">
            <I18nText zh={description} en="The backend gathers and prepares articles; the frontend presents them with calm typography and breathing room." />
          </p>
          <div className="cta-row">
            <Link className="button" href="/posts">
              <I18nText zh="阅读最新文章" en="Read the latest" />
            </Link>
            <Link className="button secondary" href="/write">
              <I18nText zh="开始写作" en="Start writing" />
            </Link>
          </div>
        </section>

        <section className="apple-section kpi-belt" aria-label="Overview stats">
          <Link className="bento-card kpi-tile" href="/posts">
            <span className="kpi-value">{publishedPostCount}</span>
            <span className="kpi-label"><I18nText zh="已发布文章" en="Published posts" /></span>
          </Link>
          <Link className="bento-card kpi-tile" href="/videos">
            <span className="kpi-value">{videoCount}</span>
            <span className="kpi-label"><I18nText zh="视频资源" en="Video resources" /></span>
          </Link>
          <Link className="bento-card kpi-tile" href="/stats">
            <span className="kpi-value">↗</span>
            <span className="kpi-label"><I18nText zh="查看数据趋势" en="View trend dashboard" /></span>
          </Link>
        </section>

        <AiAssistant
          contextLabel="博客主页"
          suggestionGroups={[
            {
              title: <I18nText zh="近期热点" en="Recent Topics" />,
              prompts: [
                "概括首页最近几篇文章的共同主线",
                "哪些议题值得优先阅读？",
                "帮我挑一篇适合深入看的文章"
              ]
            },
            {
              title: <I18nText zh="推荐阅读路径" en="Reading Path" />,
              prompts: [
                "按重要性给这些内容排序",
                "整理一个 5 分钟快速了解版本",
                "这些文章之间有什么关联？"
              ]
            }
          ]}
          context={[
            settings?.description || "拾贝 信息博客",
            ...posts.map((post) => `${post.title}\n${post.summary}`)
          ].join("\n\n")}
        />

        <section className="apple-section">
          <div className="apple-section-head">
            <p className="eyebrow-apple"><I18nText zh="内容文章" en="Posts" /></p>
            <h2><I18nText zh="最近生成与整理的文章" en="Recently curated posts" /></h2>
            <p className="lead">
              <I18nText
                zh="精选近期发布的文章，跨越事实、影响与背景。"
                en="A handpicked selection of recent posts covering facts, impact, and context."
              />
            </p>
          </div>
          <div className="bento-grid content-bento">
            {posts.length ? (
              posts.map((post, index) => (
                <Link className={`bento-card post-card ${HOME_POST_VARIANTS[index] || ""}`} key={post.id} href={`/posts/${post.slug}`}>
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
                  <span className="text-link"><I18nText zh="阅读全文" en="Read more" /></span>
                </Link>
              ))
            ) : (
              <div className="bento-card bento-wide">
                <h3><I18nText zh="还没有发布内容" en="No published content yet" /></h3>
                <p><I18nText zh="进入后台添加信息源，运行资料搜索与内容生成任务，审核后即可出现在这里。" en="Add sources in the admin area, run research and generation jobs, then publish reviewed drafts here." /></p>
                <Link className="text-link" href="/admin"><I18nText zh="进入后台" en="Admin" /></Link>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: "32px" }}>
            <Link className="button secondary" href="/posts">
              <I18nText zh="查看全部文章" en="View all posts" />
            </Link>
          </div>
        </section>

        <section className="apple-section">
          <div className="apple-section-head">
            <p className="eyebrow-apple"><I18nText zh="视频资源" en="Videos" /></p>
            <h2><I18nText zh="精选视频与相关链接" en="Featured videos and related links" /></h2>
            <p className="lead">
              <I18nText
                zh="后台抓取到的相关视频链接和你手动上传的内容，统一在这里展示。"
                en="Curated video links and your uploads, presented together."
              />
            </p>
          </div>
          <div className="bento-grid compact-bento">
            {videos.length ? (
              videos.map((video, index) => (
                <Link className={`bento-card video-card ${HOME_VIDEO_VARIANTS[index] || ""}`} key={video.id} href={`/videos/${video.id}`}>
                  <div>
                    <div className="meta-row"><span>{video.type}</span></div>
                    <h3>{video.title}</h3>
                    <p>{video.summary}</p>
                  </div>
                  <span className="text-link"><I18nText zh="查看视频" en="View video" /></span>
                </Link>
              ))
            ) : (
              <div className="bento-card bento-wide">
                <h3><I18nText zh="等待关联视频" en="Waiting for videos" /></h3>
                <p><I18nText zh="抓取页面时识别到的视频链接，会作为文章关联资源展示。" en="Video links found during fetching will appear as related resources for articles." /></p>
              </div>
            )}
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
