import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { normalizePage } from "@/lib/pagination";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { RelativeTime } from "@/components/RelativeTime";
import {
  CREATION_MODES,
  isCommunityScoreCurrent,
  scoredCommunitySummary
} from "@/lib/creation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "读者社区",
  description: "读者纯手写或与 AI 访谈共创后主动公开的作品，全部经过按题材标尺的 AI 评分。",
  alternates: { canonical: "/community" }
};

const PAGE_SIZE = 12;

export default async function CommunityPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; genre?: string }>;
}) {
  const params = await searchParams;
  // normalizePage 带 10 万页上限：?page=1e15 会让 skip 溢出 int32，Prisma 校验
  // 抛错直接 500（/posts 早已用同一防护，这里此前漏用）。
  const page = normalizePage(params.page);
  const genreSlug = params.genre || "";

  const where = {
    status: "SHARED" as const,
    ...(genreSlug ? { genre: { slug: genreSlug } } : {})
  };

  const [genres, total, works] = await Promise.all([
    prisma.creationGenre.findMany({ where: { isEnabled: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="container bento-page public-list-page community-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Community</p>
        <h1 className="page-title"><I18nText zh="读者社区" en="Community" /></h1>
        <p className="muted-block">
          <I18nText
            zh="这里收录创作者纯手写或与 AI 访谈共创的文章；每篇都按题材标尺评分，并且只由创作者本人决定是否公开。"
            en="These articles are either written entirely by their creators or co-created through an AI interview. Every piece is scored against its genre rubric and published only by the creator's choice."
          />
        </p>
      </section>

      <nav className="topic-tabs" aria-label="题材筛选">
        <Link href="/community" className={genreSlug ? "" : "active"} aria-current={genreSlug ? undefined : "page"}>
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
        <div className="bento-card empty-grid-card">
          <p className="muted-block">
            <I18nText zh="还没有公开的共创作品。去共创工作室写下第一篇吧。" en="No shared works yet. Be the first in the co-creation studio." />
          </p>
          <Link className="button" href="/create"><I18nText zh="去共创" en="Co-create" /></Link>
        </div>
      ) : (
        <div className="bento-grid news-bento">
          {works.map((work) => {
            const summary = scoredCommunitySummary(work);
            const currentScore = isCommunityScoreCurrent(work) ? work.score : null;
            return (
              <article key={work.id} className="bento-card linked-card">
                <div className="meta-row">
                  <span className="tag">{work.genre.name}</span>
                  <span className="tag">{CREATION_MODES[work.mode].label}</span>
                  {currentScore !== null
                    ? <span className="tag creation-score-pass">AI 评分 {currentScore}</span>
                    : null}
                </div>
                <h2>
                  <Link className="card-link" href={`/community/${work.slug}`}>{work.title}</Link>
                </h2>
                {summary ? <p className="muted">{summary}</p> : null}
                <p className="muted creation-byline">
                  {work.ownerId ? work.owner?.displayName || "注册创作者" : "匿名创作者"}
                  {work.publishedAt
                    ? <> ｜ <RelativeTime value={work.publishedAt.toISOString()} /></>
                    : null}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <Pagination basePath="/community" page={page} totalPages={totalPages} params={{ genre: genreSlug || null }} />
    </main>
  );
}
