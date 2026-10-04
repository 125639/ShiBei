import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { unstable_cache } from "next/cache";
import { AssistantPageContext } from "@/components/AssistantPageContext";
import { I18nText } from "@/components/I18nText";
import { extractPostCover } from "@/lib/post-cover";
import { readingMinutes } from "@/lib/reading-time";
import { setRequestLanguage } from "@/lib/i18n-server";
import { HeroScene } from "@/components/public/HeroScene";
import { PostCard } from "@/components/public/PostCard";
import { PostShelf } from "@/components/public/PostShelf";
import { Icon, ShellMark } from "@/components/public/Icons";
import { RelativeTime } from "@/components/RelativeTime";
import { prisma } from "@/lib/prisma";
import { formatChars } from "@/lib/format-chars";

// ISR：整页 HTML 复用，发布/撤销经 revalidatePublicContent（revalidateTag
// "public-content" + revalidatePath "/"）即时刷新，300s 兜底。
export const revalidate = 300;

/**
 * 首页数据整体缓存：低配服务器（1 核）上每个请求都跑 4 个查询 + 封面正则
 * 是首屏 TTFB 的主要开销。内容变更时 revalidatePublicContent 会失效
 * "public-content" 标签，5 分钟兜底刷新。封面在这里提取，正文不进缓存。
 */
const getHomePageData = unstable_cache(
  async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [posts, settings, publishedPostCount, weekPostCount, siteStats] = await Promise.all([
      prisma.post.findMany({
        where: { status: "PUBLISHED", publicationBlockedReason: null },
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
      prisma.post.count({ where: { status: "PUBLISHED", publicationBlockedReason: null } }),
      prisma.post.count({
        where: { status: "PUBLISHED", publicationBlockedReason: null, publishedAt: { gte: weekAgo } }
      }),
    // hero 统计带的站点级数字（总字数/运行天数/最近更新）。查询与 firefly
    // 侧栏同口径，直接内联在同一个缓存里（不要在这里再调
    // getCachedFireflyWidgetData：unstable_cache 嵌套构建期表现不可靠）。
    // 失败降级为 null，hero 退回仅显示文章数，不拖垮整页。
    // 失败降级为 null，hero 退回仅显示文章数，不拖垮整页。
      Promise.all([
        prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
          SELECT COALESCE(SUM(LENGTH(content)), 0) AS total
          FROM "Post"
          WHERE status = 'PUBLISHED' AND "publicationBlockedReason" IS NULL
        `,
        prisma.post.findFirst({
          where: { status: "PUBLISHED", publicationBlockedReason: null, publishedAt: { not: null } },
          orderBy: { publishedAt: "asc" },
          select: { publishedAt: true }
        }),
        prisma.post.findFirst({
          where: { status: "PUBLISHED", publicationBlockedReason: null, publishedAt: { not: null } },
          orderBy: { publishedAt: "desc" },
          select: { publishedAt: true }
        })
      ])
        .then(([charsRow, firstPost, lastPost]) => ({
          totalChars: Number(charsRow[0]?.total ?? 0),
          runDays: firstPost?.publishedAt
            ? Math.max(1, Math.ceil((Date.now() - firstPost.publishedAt.getTime()) / 86_400_000))
            : 0,
          lastPublishedAtIso: lastPost?.publishedAt?.toISOString() ?? null
        }))
        .catch(() => null)
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
        minutes: readingMinutes(post.content),
        tags: post.tags,
        topics: post.topics
      })),
      description: settings?.description || null,
      publishedPostCount,
      weekPostCount,
      siteStats
    };
  },
  ["home-page-data-v2"],
  { revalidate: 300, tags: ["public-content"] }
);

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const language = setRequestLanguage(lang);
  const {
    posts,
    description: cachedDescription,
    publishedPostCount,
    weekPostCount,
    siteStats
  } = await getHomePageData();
  const description =
    cachedDescription ||
    "在快速变化的世界里，打捞有价值的信息。关于科技、生活与新想法，这里有值得慢慢读的内容。";
  const topics = [
    ...new Map(posts.flatMap((post) => post.topics).map((topic) => [topic.id, topic])).values()
  ];
  const latest = posts[0];

  return (
    <main className="publication-home publication-container">
      <section className="publication-hero" aria-labelledby="home-hero-title">
        <div className="publication-hero-copy">
          <p className="publication-overline">
            <span className="publication-live-dot" />
            <I18nText zh="一个保持好奇的内容空间" en="A journal for curious minds" />
          </p>
          <h1 id="home-hero-title">
            <I18nText
              zh={
                <>
                  信息如潮，
                  <br />
                  好内容值得
                  <span className="hero-title-last">
                    <span className="hero-title-emphasis">拾</span>起来。
                    <svg viewBox="0 0 260 15" fill="none" aria-hidden="true">
                      <path
                        d="M3 10C75 1 169 0 254 8M15 14c71-7 142-8 217-3"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </>
              }
              en={
                <>
                  A sea of ideas.
                  <br />A few worth
                  <span className="hero-title-last">
                    <span className="hero-title-emphasis">keeping.</span>
                    <svg viewBox="0 0 260 15" fill="none" aria-hidden="true">
                      <path
                        d="M3 10C75 1 169 0 254 8"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </>
              }
            />
          </h1>
          <p className="publication-hero-description">
            <I18nText
              zh={description}
              en="Thoughtful stories on technology, life, and everything in between. Less noise. More perspective. Always something worth a closer look."
            />
          </p>
          <div className="publication-hero-actions">
            <Link className="publication-button" href="/posts">
              <I18nText zh="开始探索" en="Explore stories" />
              <Icon name="arrow" width="18" height="18" />
            </Link>
            <Link className="publication-text-link" href="/create">
              <Icon name="pen" width="17" height="17" />
              <I18nText zh="分享一个想法" en="Share an idea" />
            </Link>
          </div>
          <div className="publication-hero-bottom">
            <span className="publication-mini-shell">
              <ShellMark />
            </span>
            <div>
              <strong>
                <I18nText zh="认真整理，慢慢阅读。" en="Thoughtfully curated. Slowly savored." />
              </strong>
              {/* KPanel 式统计带：数字前置，一眼看清这个站在积累什么 */}
              <div className="publication-hero-stats">
                <span>
                  <strong>{publishedPostCount}</strong>
                  <I18nText zh="篇内容" en="stories" />
                </span>
                {weekPostCount > 0 ? (
                  <span>
                    <strong>+{weekPostCount}</strong>
                    <I18nText zh="本周" en="this week" />
                  </span>
                ) : null}
                {siteStats ? (
                  <span>
                    <strong>{formatChars(siteStats.totalChars)}</strong>
                    <I18nText zh="累计字数" en="characters" />
                  </span>
                ) : null}
                {siteStats && siteStats.runDays > 0 ? (
                  <span>
                    <strong>{siteStats.runDays}</strong>
                    <I18nText zh="天运行" en="days running" />
                  </span>
                ) : null}
                {siteStats?.lastPublishedAtIso ? (
                  <span className="hero-stat-live">
                    <span className="publication-live-dot" aria-hidden="true" />
                    <I18nText zh="更新于" en="Updated" />
                    <RelativeTime value={siteStats.lastPublishedAtIso} />
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <HeroScene />
      </section>

      <div className="publication-ticker" data-reveal>
        <span className="publication-ticker-label">
          <Icon name="spark" width="16" height="16" />
          <I18nText zh="最近拾起" en="JUST COLLECTED" />
        </span>
        {latest ? (
          <Link href={`/posts/${latest.slug}`}>
            <span>
              <I18nText zh={latest.title} en={latest.titleEn || latest.title} />
            </span>
            <Icon name="arrow" width="18" height="18" />
          </Link>
        ) : (
          <p>
            <I18nText
              zh="好内容正在酝酿中。不如先在社区里聊聊你的新发现。"
              en="Good stories are on their way. Share a discovery with the community."
            />
          </p>
        )}
        <span className="publication-ticker-issue">SHIBEI / JOURNAL</span>
      </div>

      <AssistantPageContext
        contextLabel={<I18nText zh="博客主页" en="Home" />}
        suggestionGroups={[
          {
            title: <I18nText zh="发现与阅读" en="Discover & read" />,
            prompts:
              language === "en"
                ? [
                    "What connects the latest stories?",
                    "Recommend a story worth a deeper read",
                    "Build me a five-minute reading list"
                  ]
                : ["概括最近几篇文章的共同主线", "帮我挑一篇适合深入看的文章", "整理一个 5 分钟快速了解版本"]
          }
        ]}
        context={[description, ...posts.map((post) => `${post.title}\n${post.summary}`)].join("\n\n")}
      />

      <section className="publication-stories" aria-labelledby="latest-stories-title">
        <div className="publication-section-heading" data-reveal>
          <div>
            <p className="publication-overline">THE LATEST COLLECTION</p>
            <h2 id="latest-stories-title">
              <I18nText zh="新鲜的，值得读的。" en="Fresh finds. Worth your time." />
              <span className="publication-heading-dot">✳</span>
            </h2>
          </div>
          <Link className="publication-text-link" href="/posts">
            <I18nText zh="全部文章" en="All stories" />
            <Icon name="arrow" width="17" height="17" />
          </Link>
        </div>
        {posts.length ? (
          <PostShelf
            topics={topics}
            items={posts.map((post, index) => ({
              id: post.id,
              topicIds: post.topics.map((topic) => topic.id),
              card: <PostCard post={post} index={index} />
            }))}
          />
        ) : (
          <div className="publication-empty" data-reveal>
            <ShellMark />
            <p className="publication-overline">THE NEXT STORY STARTS HERE</p>
            <h3>
              <I18nText zh="留一点空白，给即将到来的好内容。" en="A little space for the next good story." />
            </h3>
            <p>
              <I18nText
                zh="第一批文章正在整理中。你也可以写下自己的观察，成为这里的第一束灵感。"
                en="Our first collection is taking shape. Add your own observation and help start the conversation."
              />
            </p>
            <Link className="publication-button" href="/create">
              <I18nText zh="参与共创" en="Start creating" />
              <Icon name="arrow" width="17" height="17" />
            </Link>
          </div>
        )}
      </section>

      <section className="publication-invitation" data-reveal aria-labelledby="invitation-title">
        <div className="invitation-decoration" aria-hidden="true">
          <Icon name="spark" width="80" height="80" />
        </div>
        <div>
          <p className="publication-overline">GOOD IDEAS DESERVE COMPANY</p>
          <h2 id="invitation-title">
            <I18nText
              zh={
                <>
                  不只是读者，
                  <br />
                  也可以是创作者。
                </>
              }
              en={
                <>
                  Every curious reader
                  <br />
                  has a story to tell.
                </>
              }
            />
          </h2>
          <p>
            <I18nText
              zh="一个新发现，一点不同的思考。让你的灵感在这里发生。"
              en="A small discovery. A different perspective. Give your inspiration a place to begin."
            />
          </p>
        </div>
        <div className="invitation-actions">
          <Link className="publication-button" href="/write">
            <I18nText zh="写下你的第一篇" en="Write your first story" />
            <Icon name="arrow" width="17" height="17" />
          </Link>
          <Link className="publication-text-link" href="/community">
            <I18nText zh="先去社区逛逛" en="Meet the community" />
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
