import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";
import { publicVideoWhere } from "./public-video";
import { siteDayKey, siteDayStart, siteHourOf, siteShortLabel } from "./site-time";

export type StatsWindow = "today" | "week" | "total";

export type StatsBucket = {
  label: string;
  date?: string;
  count: number;
};

export type TopicSlice = {
  id: string;
  name: string;
  slug: string;
  count: number;
};

export type StatsPayload = {
  window: StatsWindow;
  totals: {
    news: number;
    videos: number;
    publishedNews: number;
    draftNews: number;
    sources: number;
    topics: number;
  };
  todayNews: number;
  weekNews: number;
  todayVideos: number;
  weekVideos: number;
  newsBuckets: StatsBucket[];
  videoBuckets: StatsBucket[];
  topicSlices: TopicSlice[];
  hourBuckets: StatsBucket[];
  generatedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// 切天口径统一走 lib/site-time.ts（站点时区，默认 UTC+8）。此前这里用的是
// `d.setHours(0,0,0,0)` 与 `getMonth()/getDate()`，也就是**进程本地时区**：
// 部署到 UTC 服务器后，北京时间 00:00–08:00 发布的文章会被算进「昨天」，
// 而后台访问统计（lib/visits.ts）一直按东八区切天——同一产品两个「今天」。
function startOfDay(d: Date) {
  return siteDayStart(d);
}

function dateKey(d: Date) {
  return siteDayKey(d);
}

function shortLabel(d: Date) {
  return siteShortLabel(d);
}

export async function loadStats(window: StatsWindow = "week", opts: { publicOnly?: boolean } = {}): Promise<StatsPayload> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = new Date(todayStart.getTime() - 6 * DAY_MS);

  const range = window === "today" ? todayStart : window === "week" ? weekStart : new Date(0);
  const postVisibilityWhere = opts.publicOnly
    ? { status: "PUBLISHED" as const, publicationBlockedReason: null }
    : {};
  const videoVisibilityWhere = opts.publicOnly ? publicVideoWhere : {};

  const [
    newsTotal,
    publishedNewsQuery,
    draftNews,
    videosTotal,
    sourcesTotal,
    topicsTotal,
    todayNews,
    weekNews,
    todayVideos,
    weekVideos,
    last30News,
    last30Videos,
    todayHourly,
    topicCounts
  ] = await Promise.all([
    // 公开路径下 newsTotal 与 publishedNews 的过滤条件完全相同，只 count 一次；
    // 管理端路径两者语义不同（全量 vs 已发布），仍各查各的。
    prisma.post.count({ where: postVisibilityWhere }),
    opts.publicOnly ? Promise.resolve(0) : prisma.post.count({ where: { status: "PUBLISHED", publicationBlockedReason: null } }),
    opts.publicOnly ? Promise.resolve(0) : prisma.post.count({ where: { status: "DRAFT" } }),
    prisma.video.count({ where: videoVisibilityWhere }),
    prisma.source.count(),
    prisma.contentTopic.count(),
    prisma.post.count({ where: { ...postVisibilityWhere, createdAt: { gte: todayStart } } }),
    prisma.post.count({ where: { ...postVisibilityWhere, createdAt: { gte: weekStart } } }),
    prisma.video.count({ where: { AND: [videoVisibilityWhere, { createdAt: { gte: todayStart } }] } }),
    prisma.video.count({ where: { AND: [videoVisibilityWhere, { createdAt: { gte: weekStart } }] } }),
    prisma.post.findMany({
      where: { ...postVisibilityWhere, createdAt: { gte: new Date(now.getTime() - 29 * DAY_MS) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.video.findMany({
      where: { AND: [videoVisibilityWhere, { createdAt: { gte: new Date(now.getTime() - 29 * DAY_MS) } }] },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.post.findMany({
      where: { ...postVisibilityWhere, createdAt: { gte: todayStart } },
      select: { createdAt: true }
    }),
    loadTopicCounts(range, postVisibilityWhere)
  ]);

  const newsBuckets = bucketByDay(last30News.map((p) => p.createdAt), now, daysForWindow(window));
  const videoBuckets = bucketByDay(last30Videos.map((v) => v.createdAt), now, daysForWindow(window));
  const hourBuckets = bucketByHour(todayHourly.map((p) => p.createdAt));
  // 公开路径的可见条件就是「已发布」，publishedNews 直接复用 newsTotal。
  const publishedNews = opts.publicOnly ? newsTotal : publishedNewsQuery;

  return {
    window,
    totals: {
      news: newsTotal,
      videos: videosTotal,
      publishedNews,
      draftNews,
      sources: sourcesTotal,
      topics: topicsTotal
    },
    todayNews,
    weekNews,
    todayVideos,
    weekVideos,
    newsBuckets,
    videoBuckets,
    topicSlices: topicCounts,
    hourBuckets,
    generatedAt: now.toISOString()
  };
}

export const loadCachedStats = unstable_cache(
  async (window: StatsWindow = "week") => loadStats(window, { publicOnly: true }),
  ["stats-payload"],
  { revalidate: 60, tags: ["stats"] }
);

function daysForWindow(window: StatsWindow) {
  if (window === "today") return 7; // still show context
  if (window === "week") return 14;
  return 30;
}

function bucketByDay(dates: Date[], now: Date, days: number): StatsBucket[] {
  const buckets: StatsBucket[] = [];
  const baseStart = startOfDay(now);
  const counts = new Map<string, number>();
  for (const d of dates) {
    // dateKey 本身就按站点时区归日，不需要先 startOfDay 再取键。
    const key = dateKey(d);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(baseStart.getTime() - i * DAY_MS);
    const key = dateKey(day);
    buckets.push({ label: shortLabel(day), date: key, count: counts.get(key) || 0 });
  }
  return buckets;
}

function bucketByHour(dates: Date[]): StatsBucket[] {
  const counts = new Array(24).fill(0);
  for (const d of dates) {
    counts[siteHourOf(d)] += 1;
  }
  return counts.map((count, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    count
  }));
}

async function loadTopicCounts(since: Date, postWhere: { status?: "PUBLISHED" } = {}): Promise<TopicSlice[]> {
  const topics = await prisma.contentTopic.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: {
          posts: { where: { ...postWhere, createdAt: { gte: since } } }
        }
      }
    }
  });
  const slices = topics.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    count: t._count.posts
  }));
  slices.sort((a, b) => b.count - a.count);
  // Combine zero-count topics into a single "其他" slice when there are too many,
  // but keep up to 8 individually for legibility.
  if (slices.length > 8) {
    const head = slices.slice(0, 7);
    const tailSum = slices.slice(7).reduce((acc, s) => acc + s.count, 0);
    head.push({ id: "_other", name: "其他", slug: "_other", count: tailSum });
    return head;
  }
  return slices;
}
