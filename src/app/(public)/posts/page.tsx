import Link from "next/link";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { normalizePage } from "@/lib/pagination";
import { extractPostCover, postCoverStyle } from "@/lib/post-cover";
import { prisma } from "@/lib/prisma";
import { isDisplayMode, type DisplayMode } from "@/lib/topics";

export const metadata: Metadata = {
  title: "内容文章",
  description: "浏览全部已发布文章，支持按主题筛选与关键词搜索。",
  alternates: { canonical: "/posts" }
};

const COMPILE_KIND_LABELS: Record<string, { zh: string; en: string }> = {
  SINGLE_ARTICLE: { zh: "单篇文章", en: "Article" },
  DAILY_DIGEST: { zh: "每日合集", en: "Daily digest" },
  WEEKLY_ROUNDUP: { zh: "周报/合集", en: "Weekly roundup" }
};

function CompileKindTag({ kind }: { kind: string }) {
  const label = COMPILE_KIND_LABELS[kind];
  return <span className="tag">{label ? <I18nText zh={label.zh} en={label.en} /> : kind}</span>;
}

const GRID_FEATURED_VARIANTS = ["bento-large", "bento-wide"] as const;
const PAGE_SIZE = 24;

type PostListEntry = {
  id: string;
  slug: string;
  title: string;
  titleEn?: string | null;
  summary: string;
  summaryEn?: string | null;
  publishedAt: Date | null;
  kind: string;
  cover: string | null;
  tags: { id: string; name: string }[];
  topics: { id: string; name: string; slug: string }[];
};

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
      ? prisma.contentTopic.findUnique({ where: { slug: topicSlug }, select: { id: true, name: true, slug: true } })
      : Promise.resolve(null)
  ]);

  const where: Prisma.PostWhereInput = {
    status: "PUBLISHED",
    publicationBlockedReason: null,
    ...(activeTopic ? { topics: { some: { id: activeTopic.id } } } : {}),
    ...(query ? {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { tags: { some: { name: { contains: query, mode: "insensitive" } } } },
        { topics: { some: { name: { contains: query, mode: "insensitive" } } } }
      ]
    } : {})
  };

  const [rawPosts, totalPosts] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
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

  return { settings, topics, activeTopic, rawPosts, totalPosts };
}

// 浏览路径缓存：内容变更由 revalidatePublicContent → revalidateTag("public-content") 精准失效。
// 注意 unstable_cache 会把 Date 序列化成字符串，消费侧统一 new Date() 还原。
const getCachedPostsBrowseData = unstable_cache(
  async (topicSlug: string | null, page: number) => fetchPostsPageData(topicSlug, "", page),
  ["posts-browse"],
  { revalidate: 300, tags: ["public-content"] }
);

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ topic?: string; q?: string; page?: string }> }) {
  const params = await searchParams;
  const topicSlug = params.topic?.trim() || null;
  const query = params.q?.trim().slice(0, 120) || "";
  const page = normalizePage(params.page);

  const { settings, topics, activeTopic, rawPosts, totalPosts } = query
    ? await fetchPostsPageData(topicSlug, query, page)
    : await getCachedPostsBrowseData(topicSlug, page);

  const mode: DisplayMode = isDisplayMode(settings?.contentDisplayMode || "")
    ? (settings!.contentDisplayMode as DisplayMode)
    : "grid";

  const posts: PostListEntry[] = rawPosts.map(({ content, ...post }) => ({
    ...post,
    // 缓存命中时 publishedAt 是 ISO 字符串，直查时是 Date；统一还原成 Date
    publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
    cover: extractPostCover(content)
  }));
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));

  // ?page= 超过实际页数（手改 URL / 内容减少后回访旧链接）时回到有效页，
  // 避免展示误导性的「内容即将上线」空状态。
  if (totalPosts > 0 && page > totalPages) {
    redirect(buildPostsHref(topicSlug, query, totalPages));
  }

  return (
    <main className="container bento-page public-list-page posts-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Posts</p>
        <h1 className="page-title"><I18nText zh="内容文章" en="Posts" /></h1>
        <p className="muted">
          <I18nText
            zh={<>内容由抓取与生成产出，经过审核后在此呈现。{activeTopic ? `当前筛选：${activeTopic.name}。` : null}{query ? ` 搜索：${query}。` : null}</>}
            en={<>Curated and reviewed before appearing here.{activeTopic ? ` Current filter: ${activeTopic.name}.` : null}{query ? ` Search: ${query}.` : null}</>}
          />
        </p>
      </section>

      <form className="form-card filter-form" action="/posts" method="get">
        {topicSlug ? <input type="hidden" name="topic" value={topicSlug} /> : null}
        <div className="field">
          <label htmlFor="post-search"><I18nText zh="搜索文章" en="Search posts" /></label>
          <input id="post-search" type="search" name="q" defaultValue={query} placeholder="标题、摘要、标签或主题" enterKeyHint="search" maxLength={120} />
        </div>
        <button className="button" type="submit"><I18nText zh="搜索" en="Search" /></button>
        {(query || topicSlug) ? (
          <Link className="button secondary" href="/posts"><I18nText zh="清除" en="Clear" /></Link>
        ) : null}
      </form>

      {mode === "topic-tabs" && topics.length > 0 ? (
        <nav className="topic-tabs" aria-label="主题筛选">
          <Link href={buildPostsHref(null, query)} className={topicSlug ? "" : "active"} aria-current={topicSlug ? undefined : "page"}>
            <I18nText zh="全部" en="All" />
          </Link>
          {topics.map((topic) => (
            <Link
              key={topic.id}
              href={buildPostsHref(topic.slug, query)}
              className={topicSlug === topic.slug ? "active" : ""}
              aria-current={topicSlug === topic.slug ? "page" : undefined}
            >
              {topic.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {posts.length === 0 ? (
        query ? (
          <div className="bento-card empty-grid-card">
            <h3><I18nText zh={`没有找到与「${query}」匹配的文章`} en={`No posts match "${query}"`} /></h3>
            <p>
              <I18nText
                zh="换个关键词试试，或清除筛选查看全部文章。"
                en="Try a different keyword, or clear the filters to browse all posts."
              />
            </p>
            <Link className="button secondary" href={topicSlug ? buildPostsHref(topicSlug, "") : "/posts"}>
              <I18nText zh="清除搜索" en="Clear search" />
            </Link>
          </div>
        ) : (
          <div className="bento-card empty-grid-card">
            <h3>
              <I18nText
                zh={activeTopic ? `${activeTopic.name}：内容即将上线` : "内容即将上线"}
                en={activeTopic ? `${activeTopic.name}: coming soon` : "Coming soon"}
              />
            </h3>
            <p>
              <I18nText
                zh="我们正在整理最新内容，请稍后再来。"
                en="We're preparing fresh content — please check back shortly."
              />
            </p>
          </div>
        )
      ) : (
        <PostsLayout mode={mode} posts={posts} />
      )}
      <Pagination basePath="/posts" page={page} totalPages={totalPages} params={{ topic: topicSlug, q: query }} />
    </main>
  );
}

function buildPostsHref(topic: string | null, query: string, page?: number) {
  const params = new URLSearchParams();
  if (topic) params.set("topic", topic);
  if (query) params.set("q", query);
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/posts?${qs}` : "/posts";
}

function PostsLayout({ mode, posts }: { mode: DisplayMode; posts: PostListEntry[] }) {
  // .posts-collection：快速美化面板的「文章布局」偏好按它做纯 CSS 重排
  if (mode === "magazine" && posts.length > 0) {
    const [hero, ...rest] = posts;
    return (
      <div className="bento-grid news-bento posts-collection">
        <article className={`bento-card bento-feature news-magazine-hero linked-card ${hero.cover ? "has-cover" : ""}`} style={postCoverStyle(hero.cover, 1200)}>
          {hero.cover ? <span className="post-cover" aria-hidden /> : null}
          <div>
            <div className="meta-row">
              <span>{hero.publishedAt?.toLocaleDateString("zh-CN")}</span>
              {hero.topics.slice(0, 3).map((topic) => (
                <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
              ))}
              <CompileKindTag kind={hero.kind} />
            </div>
            <h2>
              <Link className="card-link" href={`/posts/${hero.slug}`}>
                <I18nText zh={hero.title} en={hero.titleEn || hero.title} />
              </Link>
            </h2>
            <p><I18nText zh={hero.summary} en={hero.summaryEn || hero.summary} /></p>
          </div>
          <div>
            <span className="text-link" aria-hidden="true"><I18nText zh="阅读封面文章" en="Read feature" /></span>
          </div>
        </article>
        {rest.map((post, index) => (
          <PostCard key={post.id} post={post} variant={rest.length >= 3 && index === 0 ? "bento-wide" : ""} />
        ))}
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div className="news-list posts-collection">
        {posts.map((post) => (
          <article className="news-list-item linked-card" key={post.id}>
            <span className="timeline-dot" aria-hidden />
            <div>
              <div className="meta-row">
                <span>{post.publishedAt?.toLocaleDateString("zh-CN")}</span>
                {post.topics.slice(0, 2).map((topic) => (
                  <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
                ))}
                <CompileKindTag kind={post.kind} />
              </div>
              <h3>
                <Link className="card-link" href={`/posts/${post.slug}`}>
                  <I18nText zh={post.title} en={post.titleEn || post.title} />
                </Link>
              </h3>
              <p className="muted"><I18nText zh={post.summary} en={post.summaryEn || post.summary} /></p>
            </div>
          </article>
        ))}
      </div>
    );
  }

  // Default: grid (also used by topic-tabs)
  return (
    <div className="bento-grid news-bento posts-collection">
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          post={post}
          variant={posts.length >= 4 ? GRID_FEATURED_VARIANTS[index] || "" : ""}
        />
      ))}
    </div>
  );
}

function PostCard({ post, variant = "" }: { post: PostListEntry; variant?: string }) {
  return (
    <article className={`bento-card post-card linked-card ${variant} ${post.cover ? "has-cover" : ""}`} style={postCoverStyle(post.cover)}>
      {post.cover ? <span className="post-cover" aria-hidden /> : null}
      <div>
        <div className="meta-row">
          <span>{post.publishedAt?.toLocaleDateString("zh-CN")}</span>
          {post.topics.slice(0, 2).map((topic) => (
            <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
          ))}
          {post.tags.slice(0, 1).map((tag) => (
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
      <span className="text-link" aria-hidden="true"><I18nText zh="阅读全文" en="Read article" /></span>
    </article>
  );
}
