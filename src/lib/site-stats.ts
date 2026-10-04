import { unstable_cache } from "next/cache";
import { loadVisitStats, type VisitStats } from "./visits";

export type PublicVisitStats = Pick<VisitStats, "todayPv" | "todayUv" | "weekPv" | "monthPv" | "trend"> & {
  topPosts: Array<{ path: string; title: string; count: number }>;
};

/**
 * 公开数据页的访问量聚合（今日/近 7 天/近 30 天 PV + 今日 UV + 14 天趋势 +
 * 近 30 天最受欢迎文章 Top 5）。直接复用后台看板的 loadVisitStats（全部为
 * PG 侧聚合查询），但公开页 revalidate 60s + unstable_cache 双重去抖，
 * 避免每个访客都打一次数据库。查询失败返回 null（调用方隐藏访问卡），
 * 不让埋点表的问题拖垮整页。
 */
export const getCachedPublicVisitStats = unstable_cache(
  async (): Promise<PublicVisitStats | null> => {
    if (!process.env.DATABASE_URL) return null;
    try {
      const stats = await loadVisitStats();
      return {
        todayPv: stats.todayPv,
        todayUv: stats.todayUv,
        weekPv: stats.weekPv,
        monthPv: stats.monthPv,
        trend: stats.trend,
        // 只公开真正的文章热榜（title 由 loadVisitStats 已解析）；首页等
        // 非文章路径不进公开榜，标题缺失的行（文章已删）也一并过滤。
        topPosts: stats.topPaths
          .filter((row): row is { path: string; title: string; count: number } => Boolean(row.title))
          .slice(0, 5)
      };
    } catch {
      // VisitDaily 表缺失/库不可达：公开页降级为无访问数据，不抛错。
      return null;
    }
  },
  ["public-visit-stats"],
  { revalidate: 60 }
);
