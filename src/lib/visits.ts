import { prisma } from "./prisma";
import type { StatsBucket } from "./stats";

// 访问统计:按日按路径累加 PV;UV 用保留路径 "__uv__" 承载
// (客户端 localStorage 当日首访才带 unique 标记,近似独立访客)。
// 日期按东八区切天:站点受众在国内,服务器跑 UTC,直接用 UTC 切天
// 会让"今天"偏移 8 小时。CST 无夏令时,固定偏移即可。

export const UV_PATH = "__uv__";
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

export function visitDayKey(now = new Date()): string {
  return new Date(now.getTime() + CST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 返回规范化后的路径;不可统计的路径(后台/接口/静态资源/畸形)返回 null。 */
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
  if (/^\/(admin|api|_next|uploads)(\/|$)/.test(path)) return null;
  return path;
}

export async function recordVisit(input: { path: string; unique: boolean; now?: Date }) {
  const day = new Date(`${visitDayKey(input.now)}T00:00:00.000Z`);
  const bump = (path: string) =>
    prisma.visitDaily.upsert({
      where: { day_path: { day, path } },
      update: { count: { increment: 1 } },
      create: { day, path, count: 1 }
    });
  await bump(input.path);
  if (input.unique) await bump(UV_PATH);
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

  const [todayRows, weekAgg, monthAgg, trendRows, topRows] = await Promise.all([
    prisma.visitDaily.findMany({ where: { day: today } }),
    prisma.visitDaily.aggregate({
      _sum: { count: true },
      where: { day: { gte: since7 }, path: { not: UV_PATH } }
    }),
    prisma.visitDaily.aggregate({
      _sum: { count: true },
      where: { day: { gte: since30 }, path: { not: UV_PATH } }
    }),
    prisma.visitDaily.findMany({ where: { day: { gte: since14 }, path: { not: UV_PATH } } }),
    prisma.visitDaily.groupBy({
      by: ["path"],
      _sum: { count: true },
      where: { day: { gte: since30 }, path: { not: UV_PATH } },
      orderBy: { _sum: { count: "desc" } },
      take: 10
    })
  ]);

  const todayPv = todayRows.filter((row) => row.path !== UV_PATH).reduce((sum, row) => sum + row.count, 0);
  const todayUv = todayRows.find((row) => row.path === UV_PATH)?.count || 0;

  const byDay = new Map<string, number>();
  for (const row of trendRows) {
    const key = row.day.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + row.count);
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
    todayPv,
    todayUv,
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
