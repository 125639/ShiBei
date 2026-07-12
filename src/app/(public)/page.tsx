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
    <main className="container-wide bento-page home-page">
      <section className="home-hero-v2" aria-labelledby="home-hero-title">
        <div className="home-hero-copy">
          <p className="home-kicker">
            <span className="home-kicker-dot" aria-hidden="true" />
            <I18nText zh="持续更新的独立内容站" en="An independent publication, continuously updated" />
          </p>
          <h1 id="home-hero-title">
            <I18nText
              zh={<>把纷杂信息，<span className="home-title-accent">整理成值得读的内容。</span></>}
              en={<>Turn scattered information into <span className="home-title-accent">stories worth reading.</span></>}
            />
          </h1>
          <p className="lead">
            <I18nText
              zh={description}
              en="We gather, verify, and shape useful information into a calm, focused reading experience."
            />
          </p>
          <div className="cta-row">
            <Link className="button home-primary-action" href="/posts">
              <I18nText zh="开始阅读" en="Start reading" />
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button secondary" href="/create">
              <I18nText zh="参与共创" en="Co-create with us" />
            </Link>
          </div>
          <dl className="home-signal-row" aria-label="站点概览 / Site overview">
            <div>
              <dt><I18nText zh="已发布" en="Published" /></dt>
              <dd>{publishedPostCount}</dd>
            </div>
            <div>
              <dt><I18nText zh="本周新增" en="New this week" /></dt>
              <dd>{weekPostCount}</dd>
            </div>
            <div>
              <dt><I18nText zh="发布方式" en="Publishing" /></dt>
              <dd><I18nText zh="人工审核" en="Human reviewed" /></dd>
            </div>
          </dl>
        </div>

        <aside className="home-brief-card" aria-labelledby="home-brief-title">
          <div className="home-brief-topline">
            <span className="home-live-indicator"><i aria-hidden="true" /><I18nText zh="持续更新" en="Continuously updated" /></span>
            <span>ShiBei Brief</span>
          </div>
          <div className="home-brief-heading">
            <p><I18nText zh="今日导读" en="Today’s briefing" /></p>
            <h2 id="home-brief-title"><I18nText zh="从最新内容开始" en="Start with what’s new" /></h2>
          </div>
          <ol className="home-brief-list">
            {posts.length ? posts.slice(0, 3).map((post, index) => (
              <li key={post.id}>
                <span className="home-brief-index">{String(index + 1).padStart(2, "0")}</span>
                <Link href={`/posts/${post.slug}`}>
                  <span><I18nText zh={post.title} en={post.titleEn || post.title} /></span>
                  <small>
                    {post.publishedAtIso
                      ? <I18nText
                          zh={new Date(post.publishedAtIso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
                          en={new Date(post.publishedAtIso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        />
                      : <I18nText zh="待发布" en="Soon" />}
                  </small>
                </Link>
              </li>
            )) : (
              <li className="home-brief-empty">
                <I18nText zh="新内容正在整理中，稍后回来看看。" en="Fresh stories are being prepared. Check back soon." />
              </li>
            )}
          </ol>
          <Link className="home-brief-more" href="/stats">
            <I18nText zh="查看内容数据" en="View publishing insights" />
            <span aria-hidden="true">→</span>
          </Link>
        </aside>
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

      <section className="apple-section home-feed-section">
        <div className="apple-section-head">
          <div>
            <p className="eyebrow-apple"><I18nText zh="最新文章" en="Latest stories" /></p>
            <h2><I18nText zh="最近整理与发布" en="Recently curated and published" /></h2>
            <p className="lead">
              <I18nText
                zh="从事实出发，补充影响、背景与可继续追踪的线索。"
                en="Grounded in facts, with context, impact, and useful threads to follow."
              />
            </p>
          </div>
          <Link className="section-link" href="/posts">
            <I18nText zh="浏览全部" en="Browse all" />
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="bento-grid content-bento home-post-grid">
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
      </section>
    </main>
  );
}
