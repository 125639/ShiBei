import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";
import { isDisplayMode, type DisplayMode } from "@/lib/topics";

const COMPILE_KIND_LABELS: Record<string, string> = {
  SINGLE_ARTICLE: "单篇文章",
  DAILY_DIGEST: "每日合集",
  WEEKLY_ROUNDUP: "周报/合集"
};

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
  tags: { id: string; name: string }[];
  topics: { id: string; name: string; slug: string }[];
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ topic?: string; q?: string; page?: string }> }) {
  const params = await searchParams;
  const topicSlug = params.topic?.trim() || null;
  const query = params.q?.trim().slice(0, 120) || "";
  const page = normalizePage(params.page);

  const [settings, topics, activeTopic] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "site" }, select: { contentDisplayMode: true } }),
    prisma.contentTopic.findMany({
      where: { isEnabled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true }
    }),
    topicSlug
      ? prisma.contentTopic.findUnique({ where: { slug: topicSlug }, select: { id: true, name: true, slug: true } })
      : Promise.resolve(null)
  ]);

  const mode: DisplayMode = isDisplayMode(settings?.contentDisplayMode || "")
    ? (settings!.contentDisplayMode as DisplayMode)
    : "grid";

  const where: Prisma.PostWhereInput = {
    status: "PUBLISHED",
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

  const [posts, totalPosts] = await Promise.all([
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
        tags: { select: { id: true, name: true } },
        topics: { select: { id: true, name: true, slug: true } }
      }
    }),
    prisma.post.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));

  return (
    <PublicShell>
      <main className="container bento-page">
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
            <input id="post-search" name="q" defaultValue={query} placeholder="标题、摘要、标签或主题" />
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
        ) : (
          <PostsLayout mode={mode} posts={posts} />
        )}
        <Pagination basePath="/posts" page={page} totalPages={totalPages} params={{ topic: topicSlug, q: query }} />
      </main>
    </PublicShell>
  );
}

function normalizePage(value: string | undefined) {
  const n = Number(value || 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function buildPostsHref(topic: string | null, query: string) {
  const params = new URLSearchParams();
  if (topic) params.set("topic", topic);
  if (query) params.set("q", query);
  const qs = params.toString();
  return qs ? `/posts?${qs}` : "/posts";
}

function PostsLayout({ mode, posts }: { mode: DisplayMode; posts: PostListEntry[] }) {
  if (mode === "magazine" && posts.length > 0) {
    const [hero, ...rest] = posts;
    return (
      <div className="bento-grid news-bento">
        <article className="bento-card bento-feature news-magazine-hero linked-card">
          <div>
            <div className="meta-row">
              <span>{hero.publishedAt?.toLocaleDateString("zh-CN")}</span>
              {hero.topics.slice(0, 3).map((topic) => (
                <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
              ))}
              <span className="tag">{COMPILE_KIND_LABELS[hero.kind] || hero.kind}</span>
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
      <div className="news-list">
        {posts.map((post) => (
          <article className="news-list-item linked-card" key={post.id}>
            <span className="timeline-dot" aria-hidden />
            <div>
              <div className="meta-row">
                <span>{post.publishedAt?.toLocaleDateString("zh-CN")}</span>
                {post.topics.slice(0, 2).map((topic) => (
                  <Link key={topic.id} className="tag" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>{topic.name}</Link>
                ))}
                <span className="tag">{COMPILE_KIND_LABELS[post.kind] || post.kind}</span>
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
    <div className="bento-grid news-bento">
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
    <article className={`bento-card post-card linked-card ${variant}`}>
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
