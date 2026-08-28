import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";

export type FireflyCategory = { id: string; name: string; slug: string; count: number };
export type FireflyTag = { id: string; name: string; count: number };

export type FireflyWidgetData = {
  categories: FireflyCategory[];
  tags: FireflyTag[];
  stats: {
    posts: number;
    categories: number;
    tags: number;
    totalChars: number;
    runDays: number;
    lastPublishedAt: string | null;
  };
};

const PUBLISHED_POSTS = { status: "PUBLISHED" as const, publicationBlockedReason: null };

/**
 * Firefly 侧栏小组件的数据（分类/标签/站点统计）。
 * 外壳每个公开页都会渲染，所以聚合查询统一走 unstable_cache，
 * 5 分钟内的读取不会重复打数据库。
 *
 * 失败必须抛出而不是返回零值兜底：unstable_cache 会把返回值缓存 5 分钟，
 * 容器冷启动首个请求偶发查询失败时，零值会被钉在侧栏整整 5 分钟
 * （2026-07-07 部署后实际发生过）。抛出则不缓存，下个请求自动重试；
 * 唯一调用方 PublicShell 对本函数 .catch(() => null)，失败时隐藏小组件。
 */
export const getCachedFireflyWidgetData = unstable_cache(
  async (): Promise<FireflyWidgetData> => {
    if (!process.env.DATABASE_URL) throw new Error("firefly-widgets: DATABASE_URL 未配置");

    const [topics, tags, postCount, tagCount, charsRow, firstPost, lastPost] = await Promise.all([
      // 不过滤 isEnabled（那只是自动生产的启停开关）；下方已按 count>0 过滤。
      prisma.contentTopic.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { posts: { where: PUBLISHED_POSTS } } }
        }
      }),
      prisma.tag.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { posts: { where: PUBLISHED_POSTS } } }
        }
      }),
      prisma.post.count({ where: PUBLISHED_POSTS }),
      prisma.tag.count(),
      prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
        SELECT COALESCE(SUM(LENGTH(content)), 0) AS total
        FROM "Post"
        WHERE status = 'PUBLISHED' AND "publicationBlockedReason" IS NULL
      `,
      prisma.post.findFirst({
        where: { ...PUBLISHED_POSTS, publishedAt: { not: null } },
        orderBy: { publishedAt: "asc" },
        select: { publishedAt: true }
      }),
      prisma.post.findFirst({
        where: { ...PUBLISHED_POSTS, publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        select: { publishedAt: true }
      })
    ]);

    const totalChars = Number(charsRow[0]?.total ?? 0);
    const firstAt = firstPost?.publishedAt ?? null;
    const runDays = firstAt ? Math.max(1, Math.ceil((Date.now() - firstAt.getTime()) / 86_400_000)) : 0;

    return {
      categories: topics
        .map((topic) => ({ id: topic.id, name: topic.name, slug: topic.slug, count: topic._count.posts }))
        .filter((topic) => topic.count > 0),
      tags: tags
        .map((tag) => ({ id: tag.id, name: tag.name, count: tag._count.posts }))
        .filter((tag) => tag.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 18),
      stats: {
        posts: postCount,
        categories: topics.length,
        tags: tagCount,
        totalChars,
        runDays,
        lastPublishedAt: lastPost?.publishedAt?.toISOString() ?? null
      }
    };
  },
  ["firefly-widget-data"],
  { revalidate: 300, tags: ["firefly-widgets"] }
);
