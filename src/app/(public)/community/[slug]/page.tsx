import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { I18nText } from "@/components/I18nText";
import { RelativeTime } from "@/components/RelativeTime";
import { markdownToHtml } from "@/lib/markdown";
import { CREATION_MODES, type ScoreDetail } from "@/lib/creation";

export const dynamic = "force-dynamic";

async function loadSharedWork(slug: string) {
  // 只暴露 SHARED 的作品：私有草稿即使猜到 slug 也拿不到。
  const work = await prisma.creativeWork.findUnique({
    where: { slug },
    include: { genre: true, owner: { select: { displayName: true } } }
  });
  if (!work || work.status !== "SHARED") return null;
  return work;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const work = await loadSharedWork(slug);
  if (!work) return { title: "作品不存在" };
  return {
    title: work.title,
    description: work.summary || work.topic,
    alternates: { canonical: `/community/${slug}` }
  };
}

export default async function CommunityWorkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const work = await loadSharedWork(slug);
  if (!work) notFound();

  let scoreDetail: ScoreDetail | null = null;
  if (work.scoreDetail) {
    try {
      scoreDetail = JSON.parse(work.scoreDetail) as ScoreDetail;
    } catch {
      scoreDetail = null;
    }
  }

  const author = work.ownerId ? work.owner?.displayName || "注册创作者" : "匿名创作者";

  return (
    <main className="container container-narrow bento-page">
      <article className="bento-card bento-wide creation-article">
        <div className="meta-row">
          <Link className="tag" href={`/community?genre=${encodeURIComponent(work.genre.slug)}`}>{work.genre.name}</Link>
          <span className="tag">{CREATION_MODES[work.mode].label}</span>
          {work.score !== null ? <span className="tag creation-score-pass">AI 评分 {work.score} / 门槛 {work.genre.threshold}</span> : null}
        </div>
        <h1 className="page-title">{work.title}</h1>
        <p className="muted creation-byline">
          {author}
          {work.publishedAt ? <> ｜ <RelativeTime value={work.publishedAt} /></> : null}
        </p>
        {work.summary ? <p className="muted-block">{work.summary}</p> : null}
        <div className="prose" dangerouslySetInnerHTML={{ __html: markdownToHtml(work.content) }} />

        {scoreDetail ? (
          <details className="creation-score-details">
            <summary><I18nText zh="查看 AI 评分明细" en="View AI score breakdown" /></summary>
            <ul>
              {scoreDetail.dimensions.map((dim) => (
                <li key={dim.key}>
                  <strong>{dim.label}</strong>（权重 {Math.round(dim.weight * 100)}%）：{dim.score} 分
                </li>
              ))}
            </ul>
            {scoreDetail.overallComment ? <p className="muted">{scoreDetail.overallComment}</p> : null}
          </details>
        ) : null}

        <p className="muted-block creation-disclaimer">
          <I18nText
            zh={`本文由创作者与 AI 通过访谈共同创作（${CREATION_MODES[work.mode].label}），内容经创作者本人确认并主动公开。`}
            en="This piece was co-created by the author and AI through an interview, reviewed and published by the author's own choice."
          />
        </p>
      </article>
      <p>
        <Link className="text-link" href="/community"><I18nText zh="← 返回社区" en="← Back to community" /></Link>
      </p>
    </main>
  );
}
