import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { extractPostCover } from "@/lib/post-cover";
import Form from "next/form";
import { PostCard } from "@/components/public/PostCard";
import { PostsCollection } from "@/components/public/PostsCollection";
import { Icon, ShellMark } from "@/components/public/Icons";
import { readingMinutes } from "@/lib/reading-time";
import { setRequestLanguage } from "@/lib/i18n-server";
import { withLanguagePrefix } from "@/lib/language";
import { buildPostsHref, parsePostFilters, type PostSearchParams } from "@/lib/public-post-filters";
import { prisma } from "@/lib/prisma";
import { isDisplayMode, type DisplayMode } from "@/lib/topics";

// Query parameters are request-specific. Keep the explicit data caches below,
// but do not generate an ISR HTML entry for this page on its first request.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const language = setRequestLanguage(lang);
  return {
    title: language === "en" ? "Stories" : "全部文章",
    description:
      language === "en"
        ? "A collection of thoughtful stories. Explore by topic or find your next good read."
        : "探索值得读的内容，按主题浏览，或搜索下一个让你感到好奇的话题。",
    alternates: {
      canonical: withLanguagePrefix(language, "/posts"),
      languages: { "zh-CN": "/zh/posts", en: "/en/posts", "x-default": "/zh/posts" }
    }
  };
}

const PAGE_SIZE = 24;

/** 列表页数据获取：浏览路径（无搜索词）会经 unstable_cache 复用，搜索路径直查。 */
async function fetchPostsPageData(topicSlug: string | null, query: string, page: number) {
  const [settings, topics, activeTopic] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "site" }, select: { contentDisplayMode: true } }),
    // 分栏 tab 展示「有已发布文章」的分类；isEnabled 只是自动生产的启停开关，
    // 停用主题下的存量文章仍需要入口。
    prisma.contentTopic.findMany({
      where: { posts: { some: { status: "PUBLISHED", publicationBlockedReason: null } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true }
    }),
    topicSlug
      ? prisma.contentTopic.findUnique({
          where: { slug: topicSlug },
          select: { id: true, name: true, slug: true }
        })
      : Promise.resolve(null)
  ]);

  const where: Prisma.PostWhereInput = {
    status: "PUBLISHED",
    publicationBlockedReason: null,
    ...(topicSlug ? { topics: { some: { slug: topicSlug } } } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { titleEn: { contains: query, mode: "insensitive" } },
            { summary: { contains: query, mode: "insensitive" } },
            { summaryEn: { contains: query, mode: "insensitive" } },
            { tags: { some: { name: { contains: query, mode: "insensitive" } } } },
            { topics: { some: { name: { contains: query, mode: "insensitive" } } } }
          ]
        }
      : {})
  };

  const [rawPosts, totalPosts] = await Promise.all([
    prisma.post.findMany({
      where,
      // id 作第三唯一排序键：批量发布会产生 (sortOrder, publishedAt) 完全
      // 相同的整批文章，没有它并列批次顺序不稳定，也与相邻文章导航脱节。
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        title: true,
        titleEn: true,
        summary: true,
        summaryEn: true,
        publishedAt: true,
        kind: true,
        content: true,
        tags: { select: { id: true, name: true } },
        topics: { select: { id: true, name: true, slug: true } }
      }
    }),
    prisma.post.count({ where })
  ]);

  return {
    settings,
    topics,
    activeTopic,
    totalPosts,
    posts: rawPosts.map(({ content, publishedAt, ...post }) => ({
      ...post,
      publishedAtIso: publishedAt?.toISOString() || null,
      cover: extractPostCover(content),
      minutes: readingMinutes(content)
    }))
  };
}

// 浏览路径缓存：内容变更由 revalidatePublicContent → revalidateTag("public-content") 精准失效。
// 注意 unstable_cache 会把 Date 序列化成字符串，消费侧统一 new Date() 还原。
const getCachedPostsBrowseData = unstable_cache(
  async (topicSlug: string | null, page: number) => fetchPostsPageData(topicSlug, "", page),
  ["posts-browse-v2"],
  { revalidate: 300, tags: ["public-content"] }
);

export default async function PostsPage({
  params,
  searchParams
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<PostSearchParams>;
}) {
  const { lang } = await params;
  const language = setRequestLanguage(lang);
  const { topic: topicSlug, query, page } = parsePostFilters(await searchParams);
  const { settings, topics, activeTopic, posts, totalPosts } = query
    ? await fetchPostsPageData(topicSlug, query, page)
    : await getCachedPostsBrowseData(topicSlug, page);
  const mode: DisplayMode = isDisplayMode(settings?.contentDisplayMode || "")
    ? (settings!.contentDisplayMode as DisplayMode)
    : "grid";
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));
  if (totalPosts > 0 && page > totalPages)
    redirect(withLanguagePrefix(language, buildPostsHref(topicSlug, query, totalPages)));

  return (
    <main className="publication-container publication-posts">
      <section className="publication-page-intro" aria-labelledby="posts-title">
        <div>
          <p className="publication-overline">THE READING ROOM</p>
          <h1 id="posts-title">
            <I18nText zh="总有一篇，让你停留。" en="Find your next good read." />
          </h1>
          <p>
            <I18nText
              zh="从一个话题出发，发现新的视角。每一篇内容，都经过认真整理。"
              en="Start with a topic. Discover a new perspective. Every story, thoughtfully curated."
            />
          </p>
        </div>
        <span className="publication-archive-mark" aria-hidden="true">
          <ShellMark />
        </span>
      </section>
      <Form
        key={`${topicSlug || ""}:${query}`}
        className="publication-post-search"
        action={withLanguagePrefix(language, "/posts")}
      >
        {topicSlug ? <input type="hidden" name="topic" value={topicSlug} /> : null}
        <Icon name="search" />
        <label className="sr-only" htmlFor="post-search">
          <I18nText zh="搜索文章" en="Search stories" />
        </label>
        <input
          id="post-search"
          type="search"
          name="q"
          defaultValue={query}
          placeholder={
            language === "en" ? "Search a title, topic, or idea…" : "搜索标题、主题，或一个感兴趣的词…"
          }
          enterKeyHint="search"
          maxLength={120}
        />
        {query || topicSlug ? (
          <Link className="publication-text-link" href="/posts">
            <I18nText zh="重置" en="Reset" />
          </Link>
        ) : null}
        <button className="publication-button" type="submit">
          <I18nText zh="搜索" en="Search" />
        </button>
      </Form>
      {topics.length > 0 ? (
        <nav className="publication-topics" aria-label={language === "en" ? "Filter by topic" : "按主题筛选"}>
          <Link href={buildPostsHref(null, query)} aria-current={!topicSlug ? "page" : undefined}>
            <I18nText zh="全部主题" en="All topics" />
          </Link>
          {topics.map((topic) => (
            <Link
              key={topic.id}
              href={buildPostsHref(topic.slug, query)}
              aria-current={topicSlug === topic.slug ? "page" : undefined}
            >
              {topic.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {posts.length ? (
        <PostsCollection
          defaultLayout={mode === "list" || mode === "magazine" ? mode : "grid"}
          count={totalPosts}
          query={query}
          topic={activeTopic?.name}
        >
          {posts.map((post, index) => (
            <PostCard
              key={post.id}
              post={post}
              index={(page - 1) * PAGE_SIZE + index}
              featured={mode === "magazine" && index === 0}
            />
          ))}
        </PostsCollection>
      ) : (
        <div className="publication-empty" role="status">
          <Icon name={query || topicSlug ? "search" : "spark"} width="42" height="42" />
          <h3>
            <I18nText
              zh={
                query
                  ? `没有找到与「${query}」匹配的文章`
                  : topicSlug
                    ? "这个主题下暂时没有文章"
                    : "好内容，正在路上。"
              }
              en={
                query
                  ? `No stories match “${query}”`
                  : topicSlug
                    ? "No stories in this topic yet"
                    : "Good stories are on their way."
              }
            />
          </h3>
          <p>
            <I18nText
              zh={
                query || topicSlug
                  ? "试试其他关键词，或清除筛选，发现更多内容。"
                  : "第一批内容正在整理中。欢迎先去社区分享你的新发现。"
              }
              en={
                query || topicSlug
                  ? "Try another keyword, or clear the filters to discover more."
                  : "Our first collection is taking shape. Share a discovery with the community."
              }
            />
          </p>
          <Link className="publication-button" href={query || topicSlug ? "/posts" : "/community"}>
            <I18nText
              zh={query || topicSlug ? "浏览全部文章" : "逛逛社区"}
              en={query || topicSlug ? "Browse all stories" : "Explore the community"}
            />
            <Icon name="arrow" width="17" height="17" />
          </Link>
        </div>
      )}
      <Pagination
        basePath="/posts"
        page={page}
        totalPages={totalPages}
        params={{ topic: topicSlug, q: query }}
      />
    </main>
  );
}
