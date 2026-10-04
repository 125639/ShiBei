import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { unstable_cache } from "next/cache";
import type { CreationDepth, CreationMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePage } from "@/lib/pagination";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { RelativeTime } from "@/components/RelativeTime";
import { Icon } from "@/components/public/Icons";
import { setRequestLanguage } from "@/lib/i18n-server";
import { withLanguagePrefix } from "@/lib/language";
import { CREATION_MODES, isCommunityScoreCurrent, scoredCommunitySummary } from "@/lib/creation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const language = setRequestLanguage((await params).lang);
  return {
    title: language === "en" ? "Community" : "读者社区",
    description:
      language === "en"
        ? "Stories shared by curious readers, written independently or co-created with AI, scored against genre criteria."
        : "读者手写或与 AI 访谈共创后主动公开的作品，按题材标尺评分。",
    alternates: {
      canonical: withLanguagePrefix(language, "/community"),
      languages: { "zh-CN": "/zh/community", en: "/en/community", "x-default": "/zh/community" }
    }
  };
}

const PAGE_SIZE = 12;

type CommunityListWork = {
  id: string;
  /** 与 CreativeWork.slug 同形（可空）；历史数据里可能为 null。 */
  slug: string | null;
  title: string;
  summary: string;
  content: string;
  mode: CreationMode;
  depth: CreationDepth;
  score: number | null;
  scoredHash: string | null;
  scoredRubricHash: string | null;
  /** ISO 字符串：unstable_cache 会把 Date 序列化成字符串，取出后直接用。 */
  publishedAt: string | null;
  genre: { name: string; slug: string; dimensions: string; threshold: number };
  ownerName: string | null;
  ownerId: string | null;
};

/**
 * 列表数据缓存：每行都要选全文 content 供 isCommunityScoreCurrent 的 SHA-256
 * 指纹校验，之前每个请求都直查直算。详情页早已用 community-content 标签缓存，
 * 这里对齐同一模式——发布/下架/治理路由已在失效该标签，另有 5 分钟兜底刷新。
 */
const getCachedCommunityListData = unstable_cache(
  async (genreSlug: string, page: number) => {
    const where = {
      status: "SHARED" as const,
      ...(genreSlug ? { genre: { slug: genreSlug } } : {})
    };
    const [genres, total, works] = await Promise.all([
      prisma.creationGenre.findMany({
        where: { isEnabled: true },
        orderBy: { sortOrder: "asc" },
        select: { slug: true, name: true }
      }),
      prisma.creativeWork.count({ where }),
      prisma.creativeWork.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          content: true,
          mode: true,
          depth: true,
          score: true,
          scoredHash: true,
          scoredRubricHash: true,
          publishedAt: true,
          genre: {
            select: {
              name: true,
              slug: true,
              dimensions: true,
              threshold: true
            }
          },
          owner: { select: { displayName: true } },
          ownerId: true
        }
      })
    ]);
    const listWorks: CommunityListWork[] = works.map((work) => ({
      ...work,
      publishedAt: work.publishedAt ? work.publishedAt.toISOString() : null,
      ownerName: work.owner?.displayName ?? null
    }));
    return { genres, total, works: listWorks };
  },
  ["community-list"],
  { revalidate: 300, tags: ["community-content"] }
);

export default async function CommunityPage({
  params: routeParams,
  searchParams
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ page?: string | string[]; genre?: string | string[] }>;
}) {
  const language = setRequestLanguage((await routeParams).lang);
  const params = await searchParams;
  // normalizePage 带 10 万页上限：?page=1e15 会让 skip 溢出 int32，Prisma 校验
  // 抛错直接 500（/posts 早已用同一防护，这里此前漏用）。
  const page = normalizePage(Array.isArray(params.page) ? params.page[0] : params.page);
  const genreSlug = ((Array.isArray(params.genre) ? params.genre[0] : params.genre) || "")
    .trim()
    .slice(0, 200);

  const { genres, total, works } = await getCachedCommunityListData(genreSlug, page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    const query = new URLSearchParams();
    if (genreSlug) query.set("genre", genreSlug);
    if (totalPages > 1) query.set("page", String(totalPages));
    redirect(withLanguagePrefix(language, `/community${query.size ? `?${query}` : ""}`));
  }

  return (
    <main className="publication-container publication-community">
      <section className="publication-page-intro" aria-labelledby="community-title">
        <div>
          <p className="publication-overline">THE COMMUNITY NOTEBOOK</p>
          <h1 id="community-title">
            <I18nText zh="你的想法，也值得被看见。" en="Your perspective belongs here." />
          </h1>
          <p>
            <I18nText
              zh="手写一篇观察，或与 AI 一起梳理灵感。作品按题材评分，是否公开，由你决定。"
              en="Write an observation or explore an idea with AI. Works are scored against genre criteria. You decide what to share."
            />
          </p>
        </div>
        <Link className="publication-button" href="/write">
          <Icon name="pen" width="17" height="17" />
          <I18nText zh="开始写作" en="Start writing" />
        </Link>
      </section>
      <nav className="publication-topics" aria-label={language === "en" ? "Filter by genre" : "题材筛选"}>
        <Link
          href="/community"
          className={genreSlug ? "" : "active"}
          aria-current={genreSlug ? undefined : "page"}
        >
          <I18nText zh="全部" en="All" />
        </Link>
        {genres.map((genre) => (
          <Link
            key={genre.slug}
            href={`/community?genre=${encodeURIComponent(genre.slug)}`}
            className={genreSlug === genre.slug ? "active" : ""}
            aria-current={genreSlug === genre.slug ? "page" : undefined}
          >
            {genre.name}
          </Link>
        ))}
      </nav>

      {works.length === 0 ? (
        <div className="publication-empty" data-reveal>
          <Icon name="pen" width="42" height="42" />
          <h2>
            <I18nText zh="把第一个灵感，留在这里。" en="Leave a little inspiration here." />
          </h2>
          <p className="muted-block">
            <I18nText
              zh="还没有公开的共创作品。去共创工作室写下第一篇吧。"
              en="No shared works yet. Be the first in the co-creation studio."
            />
          </p>
          <Link className="publication-button" href="/create">
            <I18nText zh="去共创" en="Co-create" />
            <Icon name="arrow" width="17" height="17" />
          </Link>
        </div>
      ) : (
        <div className="community-story-grid">
          {works.map((work) => {
            const summary = scoredCommunitySummary(work);
            const currentScore = isCommunityScoreCurrent(work) ? work.score : null;
            return (
              <article key={work.id} className="community-story-card" data-reveal>
                <div className="meta-row">
                  <span className="tag">{work.genre.name}</span>
                  <span className="tag">
                    <I18nText
                      zh={CREATION_MODES[work.mode].label}
                      en={
                        { MANUAL: "Handwritten", VOICE_FIRST: "Your words first", AI_FIRST: "AI-assisted" }[
                          work.mode
                        ]
                      }
                    />
                  </span>
                  {currentScore !== null ? (
                    <span className="tag creation-score-pass">
                      <I18nText zh="AI 评分" en="AI score" /> {currentScore}
                    </span>
                  ) : null}
                </div>
                <h2>
                  {work.slug ? (
                    <Link className="community-title-link" href={`/community/${work.slug}`}>
                      {work.title}
                    </Link>
                  ) : (
                    work.title
                  )}
                </h2>
                {summary ? <p className="community-story-summary">{summary}</p> : null}
                <p className="muted creation-byline">
                  {work.ownerId ? (
                    work.ownerName || <I18nText zh="注册创作者" en="Member" />
                  ) : (
                    <I18nText zh="匿名创作者" en="Guest writer" />
                  )}
                  {work.publishedAt ? (
                    <>
                      {" "}
                      ｜ <RelativeTime value={work.publishedAt} />
                    </>
                  ) : null}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <Pagination
        basePath="/community"
        page={page}
        totalPages={totalPages}
        params={{ genre: genreSlug || null }}
      />
    </main>
  );
}
