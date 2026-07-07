import Link from "next/link";
import { unstable_cache } from "next/cache";
import { AiAssistant } from "@/components/AiAssistant";
import { I18nText } from "@/components/I18nText";
import { extractPostCover, postCoverStyle } from "@/lib/post-cover";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const HOME_POST_VARIANTS = ["bento-large", "bento-wide"] as const;

function postVariant(index: number, total: number): string {
  // 网格促位只在 ≥4 条时生效,否则 1-2 条会留下大片空白。
  if (total < 4) return "";
  return HOME_POST_VARIANTS[index] || "";
}

/**
 * 首页数据整体缓存：低配服务器（1 核）上每个请求都跑 4 个查询 + 封面正则
 * 是首屏 TTFB 的主要开销。内容变更时 revalidatePublicContent 会失效
 * "public-content" 标签，5 分钟兜底刷新。封面在这里提取，正文不进缓存。
 */
const getHomePageData = unstable_cache(
  async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [posts, settings, publishedPostCount, weekPostCount] = await Promise.all([
      prisma.post.findMany({
        where: { status: "PUBLISHED" },
        orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
        take: 6,
        select: {
          id: true,
          slug: true,
          title: true,
          titleEn: true,
          summary: true,
          summaryEn: true,
          publishedAt: true,
          content: true,
          tags: { select: { id: true, name: true } },
          topics: { select: { id: true, name: true, slug: true } }
        }
      }),
      prisma.siteSettings.findUnique({ where: { id: "site" }, select: { description: true } }),
      prisma.post.count({ where: { status: "PUBLISHED" } }),
      prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } } })
    ]);
    return {
      posts: posts.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
        titleEn: post.titleEn,
        summary: post.summary,
        summaryEn: post.summaryEn,
        // unstable_cache 走 JSON 序列化，Date 会退化成字符串——直接存 ISO。
        publishedAtIso: post.publishedAt?.toISOString() ?? null,
        cover: extractPostCover(post.content),
        tags: post.tags,
        topics: post.topics
      })),
      description: settings?.description || null,
      publishedPostCount,
      weekPostCount
    };
  },
  ["home-page-data"],
  { revalidate: 300, tags: ["public-content"] }
);

export default async function HomePage() {
  const { posts, description: cachedDescription, publishedPostCount, weekPostCount } = await getHomePageData();
  const description = cachedDescription || "后端整理与同步，前端轻量展示。";

  return (
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
        <Link className="bento-card kpi-tile" href="/posts">
          <span className="kpi-value">{weekPostCount}</span>
          <span className="kpi-label"><I18nText zh="本周新增" en="New this week" /></span>
        </Link>
        <Link className="bento-card kpi-tile" href="/stats">
          <span className="kpi-value" aria-hidden="true">↗</span>
          <span className="kpi-label"><I18nText zh="查看数据趋势" en="View trend dashboard" /></span>
        </Link>
      </section>

      <AiAssistant
        contextLabel={<I18nText zh="博客主页" en="Home" />}
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
          description,
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
            posts.map((post, index) => {
              const cover = post.cover;
              return (
              <article
                className={`bento-card post-card linked-card ${postVariant(index, posts.length)} ${cover ? "has-cover" : ""}`}
                key={post.id}
                style={postCoverStyle(cover)}
              >
                {cover ? <span className="post-cover" aria-hidden /> : null}
                <div>
                  <div className="meta-row">
                    {post.publishedAtIso ? (
                      <time dateTime={post.publishedAtIso}>{new Date(post.publishedAtIso).toLocaleDateString("zh-CN")}</time>
                    ) : (
                      <span><I18nText zh="未发布" en="Unpublished" /></span>
                    )}
                    {post.topics.slice(0, 2).map((topic) => (
                      <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
                    ))}
                    {post.tags.slice(0, post.topics.length ? 1 : 2).map((tag) => (
                      <span className="tag" key={tag.id}>{tag.name}</span>
                    ))}
                  </div>
                  <h3>
                    <Link className="card-link" href={`/posts/${post.slug}`}>
                      <I18nText zh={post.title} en={post.titleEn || post.title} />
                    </Link>
                  </h3>
                  <p><I18nText zh={post.summary} en={post.summaryEn || post.summary} /></p>
                </div>
                <span className="text-link" aria-hidden="true"><I18nText zh="阅读全文" en="Read more" /></span>
              </article>
              );
            })
          ) : (
            <div className="bento-card empty-grid-card">
              <h3><I18nText zh="内容即将上线" en="Coming soon" /></h3>
              <p><I18nText zh="我们正在整理最新内容，请稍后再来。" en="We're preparing fresh content — please check back shortly." /></p>
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "32px" }}>
          <Link className="button secondary" href="/posts">
            <I18nText zh="查看全部文章" en="View all posts" />
          </Link>
        </div>
      </section>

    </main>
  );
}
