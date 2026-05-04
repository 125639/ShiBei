import Link from "next/link";
import { I18nText } from "@/components/I18nText";
import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";
import { isDisplayMode, type DisplayMode } from "@/lib/topics";

const COMPILE_KIND_LABELS: Record<string, string> = {
  SINGLE_ARTICLE: "单篇报道",
  DAILY_DIGEST: "每日要闻",
  WEEKLY_ROUNDUP: "周报综述"
};

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

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const params = await searchParams;
  const topicSlug = params.topic?.trim() || null;

  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const mode: DisplayMode = isDisplayMode(settings?.newsDisplayMode || "")
    ? (settings!.newsDisplayMode as DisplayMode)
    : "grid";

  const topics = await prisma.newsTopic.findMany({
    where: { isEnabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true }
  });

  const activeTopic = topicSlug
    ? await prisma.newsTopic.findUnique({ where: { slug: topicSlug } })
    : null;

  const posts: PostListEntry[] = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      ...(activeTopic ? { topics: { some: { id: activeTopic.id } } } : {})
    },
    orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
    include: {
      tags: { select: { id: true, name: true } },
      topics: { select: { id: true, name: true, slug: true } }
    }
  });

  return (
    <PublicShell>
      <main className="container">
        <h1 className="page-title"><I18nText zh="新闻总结" en="News" /></h1>
        <div className="section-heading">
          <p className="muted">
            <I18nText
              zh={<>由抓取材料生成草稿，再经管理员审核或自动发布。{activeTopic ? `当前筛选：${activeTopic.name}。` : null}</>}
              en={<>Drafts are generated from fetched material, then admin-reviewed or auto-published.{activeTopic ? ` Current filter: ${activeTopic.name}.` : null}</>}
            />
          </p>
        </div>

        {mode === "topic-tabs" && topics.length > 0 ? (
          <nav className="topic-tabs" aria-label="主题筛选">
            <Link href="/news" className={topicSlug ? "" : "active"}><I18nText zh="全部" en="All" /></Link>
            {topics.map((topic) => (
              <Link
                key={topic.id}
                href={`/news?topic=${encodeURIComponent(topic.slug)}`}
                className={topicSlug === topic.slug ? "active" : ""}
              >
                {topic.name}
              </Link>
            ))}
          </nav>
        ) : null}

        {posts.length === 0 ? (
          <div className="card">
            <h3><I18nText zh={activeTopic ? `${activeTopic.name} 暂无文章` : "还没有发布内容"} en={activeTopic ? `No posts for ${activeTopic.name}` : "No Published Content Yet"} /></h3>
            <p><I18nText zh="启用一个主题并设置定时表后，自动整理任务会陆续在这里发布文章。" en="Enable a topic and schedule it; curated articles will appear here over time." /></p>
          </div>
        ) : (
          <PostsLayout mode={mode} posts={posts} />
        )}
      </main>
    </PublicShell>
  );
}

function PostsLayout({ mode, posts }: { mode: DisplayMode; posts: PostListEntry[] }) {
  if (mode === "magazine" && posts.length > 0) {
    const [hero, ...rest] = posts;
    return (
      <>
        <Link className="news-magazine-hero" href={`/news/${hero.slug}`}>
          <div>
            <div className="meta-row">
              <span>{hero.publishedAt?.toLocaleDateString("zh-CN")}</span>
              {hero.topics.slice(0, 3).map((topic) => (
                <span className="tag" key={topic.id}>{topic.name}</span>
              ))}
              <span className="tag">{COMPILE_KIND_LABELS[hero.kind] || hero.kind}</span>
            </div>
            <h2><I18nText zh={hero.title} en={hero.titleEn || hero.title} /></h2>
            <p><I18nText zh={hero.summary} en={hero.summaryEn || hero.summary} /></p>
          </div>
          <div>
            <span className="text-link"><I18nText zh="阅读封面文章" en="Read Feature" /></span>
          </div>
        </Link>
        <div className="grid">
          {rest.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </>
    );
  }

  if (mode === "list") {
    return (
      <div className="news-list">
        {posts.map((post) => (
          <Link className="news-list-item" key={post.id} href={`/news/${post.slug}`}>
            <span className="timeline-dot" aria-hidden />
            <div>
              <div className="meta-row">
                <span>{post.publishedAt?.toLocaleDateString("zh-CN")}</span>
                {post.topics.slice(0, 2).map((topic) => (
                  <span className="tag" key={topic.id}>{topic.name}</span>
                ))}
                <span className="tag">{COMPILE_KIND_LABELS[post.kind] || post.kind}</span>
              </div>
              <h3><I18nText zh={post.title} en={post.titleEn || post.title} /></h3>
              <p className="muted"><I18nText zh={post.summary} en={post.summaryEn || post.summary} /></p>
            </div>
          </Link>
        ))}
      </div>
    );
  }

  // Default: grid (also used by topic-tabs)
  return (
    <div className="grid">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function PostCard({ post }: { post: PostListEntry }) {
  return (
    <Link className="card" href={`/news/${post.slug}`}>
      <div>
        <div className="meta-row">
          <span>{post.publishedAt?.toLocaleDateString("zh-CN")}</span>
          {post.topics.slice(0, 2).map((topic) => (
            <span className="tag" key={topic.id}>{topic.name}</span>
          ))}
          {post.tags.slice(0, 1).map((tag) => (
            <span className="tag" key={tag.id}>{tag.name}</span>
          ))}
        </div>
        <h3><I18nText zh={post.title} en={post.titleEn || post.title} /></h3>
        <p><I18nText zh={post.summary} en={post.summaryEn || post.summary} /></p>
      </div>
      <span className="text-link"><I18nText zh="阅读全文" en="Read More" /></span>
    </Link>
  );
}
