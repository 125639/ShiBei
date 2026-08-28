import { prisma } from "./prisma";
import { stripLanguagePrefix } from "./language";
import type { StatsBucket } from "./stats";
import { siteDayBucket, siteDayKey } from "./site-time";

// 访问统计:按日按路径累加 PV;UV 用保留路径 "__uv__" 承载
// (客户端 localStorage 当日首访才带 unique 标记,近似独立访客)。
// 日期按东八区切天,与 lib/site-time.ts 中全站统一的口径一致。

export const UV_PATH = "__uv__";

/**
 * VisitDaily 保留期。
 *
 * 这张表由无认证的 /api/public/visit 写入，(day, path) 唯一，路径来自客户端。
 * 没有保留期就是一张只增不减、且不计入存储预算（reportStorage 只按
 * post/rawItem/fetchJob/video 计数估算）的表。后台看板最远只看 30 天，
 * 180 天足够任何回溯需求，同时把增长封死。
 */
export const VISIT_RETENTION_DAYS = 180;

/** 允许统计的静态公开路由。语言段在校验前已被剥离。 */
const STATIC_VISIT_PATHS = new Set([
  "/",
  "/posts",
  "/news",
  "/community",
  "/create",
  "/write",
  "/stats",
  "/about",
  "/settings",
  "/account"
]);

/** 带 slug 的公开路由。slug 长度与字符集都收紧，避免任意字符串都能建一行。 */
const SLUG_VISIT_PATH_RE = /^\/(posts|news|community)\/[A-Za-z0-9%_.~\u00a1-\uffff-]{1,160}$/;

export function visitDayKey(now = new Date()): string {
  return siteDayKey(now);
}

/**
 * 返回规范化后的路径;不可统计的路径返回 null。
 *
 * 收紧到「已知公开路由的形状」而不是只排除 /admin|/api 前缀：后者等于允许
 * 任意字符串各占一行，让公开埋点变成无认证的建表原语。
 * 语言段先剥离，使 /zh/posts/x 与 /en/posts/x 归并到同一篇文章的计数上——
 * 后台看板要的是每篇文章的热度，不是每语种每篇。
 */
export function normalizeVisitPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (!path.startsWith("/")) return null;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (!path) path = "/";
  if (path.length > 200) return null;
  if (/[\s\0<>"'\\]/.test(path)) return null;

  path = stripLanguagePrefix(path);
  if (STATIC_VISIT_PATHS.has(path)) return path;
  if (SLUG_VISIT_PATH_RE.test(path)) return path;
  return null;
}

export async function recordVisit(input: { path: string; unique: boolean; now?: Date }) {
  const day = siteDayBucket(input.now);
  const bump = (path: string) =>
    prisma.visitDaily.upsert({
      where: { day_path: { day, path } },
      update: { count: { increment: 1 } },
      create: { day, path, count: 1 }
    });
  // PV 与 UV 落在不同行（path 不同），互不依赖；并行省一次串行往返——
  // 这条路径在每次页面访问的 beacon 请求上。
  if (input.unique) {
    await Promise.all([bump(input.path), bump(UV_PATH)]);
  } else {
    await bump(input.path);
  }
}

export type VisitStats = {
  todayPv: number;
  todayUv: number;
  weekPv: number;
  monthPv: number;
  trend: StatsBucket[]; // 近 14 天 PV
  topPaths: Array<{ path: string; title: string | null; count: number }>; // 近 30 天
};

export async function loadVisitStats(now = new Date()): Promise<VisitStats> {
  const todayKey = visitDayKey(now);
  const dayAt = (offset: number) =>
    new Date(new Date(`${todayKey}T00:00:00.000Z`).getTime() - offset * 24 * 60 * 60 * 1000);
  const today = dayAt(0);
  const since7 = dayAt(6);
  const since14 = dayAt(13);
  const since30 = dayAt(29);

  // 全部走 PG 侧聚合。此前 today / trend 两处是无 take 的 findMany(select *)：
  // 表被公开埋点灌大后，后台看板会把整表读进 Node 堆（1 核 1G 机型上 Next 堆
  // 只有 192MB）。groupBy 最多返回 14 行，aggregate 与 findUnique 各返回 1 行，
  // 内存占用与表大小无关。
  const [todayAgg, todayUvRow, weekAgg, monthAgg, trendRows, topRows] = await Promise.all([
    prisma.visitDaily.aggregate({
      _sum: { count: true },
      where: { day: today, path: { not: UV_PATH } }
    }),
    prisma.visitDaily.findUnique({
      where: { day_path: { day: today, path: UV_PATH } },
      select: { count: true }
    }),
    prisma.visitDaily.aggregate({
      _sum: { count: true },
      where: { day: { gte: since7 }, path: { not: UV_PATH } }
    }),
    prisma.visitDaily.aggregate({
      _sum: { count: true },
      where: { day: { gte: since30 }, path: { not: UV_PATH } }
    }),
    prisma.visitDaily.groupBy({
      by: ["day"],
      _sum: { count: true },
      where: { day: { gte: since14 }, path: { not: UV_PATH } }
    }),
    prisma.visitDaily.groupBy({
      by: ["path"],
      _sum: { count: true },
      where: { day: { gte: since30 }, path: { not: UV_PATH } },
      orderBy: { _sum: { count: "desc" } },
      take: 10
    })
  ]);

  const byDay = new Map<string, number>();
  for (const row of trendRows) {
    byDay.set(row.day.toISOString().slice(0, 10), row._sum.count || 0);
  }
  const trend: StatsBucket[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = dayAt(i).toISOString().slice(0, 10);
    trend.push({ label: key.slice(5), date: key, count: byDay.get(key) || 0 });
  }

  // 把 /posts/<slug> 路径解析成文章标题,看板可读性更好
  const slugs = topRows
    .map((row) => /^\/posts\/([^/]+)$/.exec(row.path)?.[1])
    .filter((slug): slug is string => Boolean(slug))
    .map((slug) => { try { return decodeURIComponent(slug); } catch { return slug; } });
  const posts = slugs.length
    ? await prisma.post.findMany({ where: { slug: { in: slugs } }, select: { slug: true, title: true } })
    : [];
  const titleBySlug = new Map(posts.map((post) => [post.slug, post.title]));

  return {
    todayPv: todayAgg._sum.count || 0,
    todayUv: todayUvRow?.count || 0,
    weekPv: weekAgg._sum.count || 0,
    monthPv: monthAgg._sum.count || 0,
    trend,
    topPaths: topRows.map((row) => {
      const slug = /^\/posts\/([^/]+)$/.exec(row.path)?.[1];
      let decoded = slug;
      if (slug) { try { decoded = decodeURIComponent(slug); } catch { /* 保持原样 */ } }
      return {
        path: row.path,
        title: decoded ? titleBySlug.get(decoded) || null : null,
        count: row._sum.count || 0
      };
    })
  };
}
