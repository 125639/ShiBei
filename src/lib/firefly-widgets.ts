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

const EMPTY_WIDGET_DATA: FireflyWidgetData = {
  categories: [],
  tags: [],
  stats: { posts: 0, categories: 0, tags: 0, totalChars: 0, runDays: 0, lastPublishedAt: null }
};

const PUBLISHED_POSTS = { status: "PUBLISHED" as const };

/**
 * Firefly 侧栏小组件的数据（分类/标签/站点统计）。
 * 外壳每个公开页都会渲染，所以聚合查询统一走 unstable_cache，
 * 5 分钟内的读取不会重复打数据库。
 */
export const getCachedFireflyWidgetData = unstable_cache(
  async (): Promise<FireflyWidgetData> => {
    if (!process.env.DATABASE_URL) return EMPTY_WIDGET_DATA;

    try {
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
          SELECT COALESCE(SUM(LENGTH(content)), 0) AS total FROM "Post" WHERE status = 'PUBLISHED'
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
    } catch {
      return EMPTY_WIDGET_DATA;
    }
  },
  ["firefly-widget-data"],
  { revalidate: 300, tags: ["firefly-widgets"] }
);
