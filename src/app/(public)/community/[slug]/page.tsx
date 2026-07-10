import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { I18nText } from "@/components/I18nText";
import { RelativeTime } from "@/components/RelativeTime";
import { markdownToHtml } from "@/lib/markdown";
import { CREATION_MODES, type ScoreDetail } from "@/lib/creation";

export const dynamic = "force-dynamic";

/**
 * 详情数据 + Markdown 渲染整体缓存：正文渲染（marked + DOMPurify）是这页
 * 在 1 核机器上的主要 CPU 开销，不该逐请求重跑；generateMetadata 与页面主体
 * 经 react cache 共用同一次加载。作品公开/删除时由对应路由失效
 * "community-content" 标签（下架立即生效），另有 5 分钟兜底刷新。
 * 注意 unstable_cache 走 JSON 序列化，Date 一律存 ISO 字符串。
 */
const loadSharedWork = cache((slug: string) =>
  unstable_cache(
    async () => {
      // 只暴露 SHARED 的作品：私有草稿即使猜到 slug 也拿不到。
      const work = await prisma.creativeWork.findUnique({
        where: { slug },
        include: { genre: true, owner: { select: { displayName: true } } }
      });
      if (!work || work.status !== "SHARED") return null;
      return {
        title: work.title,
        summary: work.summary,
        topic: work.topic,
        mode: work.mode,
        score: work.score,
        publishedAtIso: work.publishedAt?.toISOString() ?? null,
        scoreDetail: work.scoreDetail,
        isOwned: Boolean(work.ownerId),
        ownerName: work.owner?.displayName ?? null,
        genre: { name: work.genre.name, slug: work.genre.slug, threshold: work.genre.threshold },
        contentHtml: markdownToHtml(work.content)
      };
    },
    ["community-work", slug],
    { revalidate: 300, tags: ["community-content"] }
  )()
);

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

  const author = work.isOwned ? work.ownerName || "注册创作者" : "匿名创作者";

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
          {work.publishedAtIso ? <> ｜ <RelativeTime value={new Date(work.publishedAtIso)} /></> : null}
        </p>
        {work.summary ? <p className="muted-block">{work.summary}</p> : null}
        <div className="prose" dangerouslySetInnerHTML={{ __html: work.contentHtml }} />

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
