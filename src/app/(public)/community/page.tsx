import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { RelativeTime } from "@/components/RelativeTime";
import { CREATION_MODES } from "@/lib/creation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "读者社区",
  description: "读者与 AI 共创并主动公开的作品，全部经过按题材标尺的 AI 评分。",
  alternates: { canonical: "/community" }
};

const PAGE_SIZE = 12;

export default async function CommunityPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; genre?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
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
        mode: true,
        score: true,
        publishedAt: true,
        genre: { select: { name: true, slug: true } },
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
            zh="这里的每一篇都是读者与 AI 访谈共创、由创作者本人决定公开的作品，并通过了按题材标尺的 AI 评分。"
            en="Every piece here was co-created through an AI interview, scored against its genre rubric, and published by the creator's own choice."
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
          {works.map((work) => (
            <article key={work.id} className="bento-card linked-card">
              <div className="meta-row">
                <span className="tag">{work.genre.name}</span>
                <span className="tag">{CREATION_MODES[work.mode].label}</span>
                {work.score !== null ? <span className="tag creation-score-pass">AI 评分 {work.score}</span> : null}
              </div>
              <h2>
                <Link className="card-link" href={`/community/${work.slug}`}>{work.title}</Link>
              </h2>
              {work.summary ? <p className="muted">{work.summary}</p> : null}
              <p className="muted creation-byline">
                {work.ownerId ? work.owner?.displayName || "注册创作者" : "匿名创作者"}
                {work.publishedAt ? <> ｜ <RelativeTime value={work.publishedAt.toISOString()} /></> : null}
              </p>
            </article>
          ))}
        </div>
      )}

      <Pagination basePath="/community" page={page} totalPages={totalPages} params={{ genre: genreSlug || null }} />
    </main>
  );
}
