import { prisma } from "./prisma";

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

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLabel(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function loadStats(window: StatsWindow = "week"): Promise<StatsPayload> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = new Date(todayStart.getTime() - 6 * DAY_MS);

  const range = window === "today" ? todayStart : window === "week" ? weekStart : new Date(0);

  const [
    newsTotal,
    publishedNews,
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
    prisma.post.count(),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
    prisma.post.count({ where: { status: "DRAFT" } }),
    prisma.video.count(),
    prisma.source.count(),
    prisma.contentTopic.count(),
    prisma.post.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.post.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.video.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.video.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.post.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - 29 * DAY_MS) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.video.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - 29 * DAY_MS) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.post.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { createdAt: true }
    }),
    loadTopicCounts(range)
  ]);

  const newsBuckets = bucketByDay(last30News.map((p) => p.createdAt), now, daysForWindow(window));
  const videoBuckets = bucketByDay(last30Videos.map((v) => v.createdAt), now, daysForWindow(window));
  const hourBuckets = bucketByHour(todayHourly.map((p) => p.createdAt));

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
    const key = dateKey(startOfDay(d));
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
    counts[new Date(d).getHours()] += 1;
  }
  return counts.map((count, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    count
  }));
}

async function loadTopicCounts(since: Date): Promise<TopicSlice[]> {
  const topics = await prisma.contentTopic.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      posts: { where: { createdAt: { gte: since } }, select: { id: true } }
    }
  });
  const slices = topics.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    count: t.posts.length
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
