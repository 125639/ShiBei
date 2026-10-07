/**
 * 全站统一的「站点时区」时间口径。
 *
 * 背景：服务器通常跑 UTC，而站点受众在国内。此前 lib/visits.ts 自己按 +8h
 * 切天（注释写明了理由），但 lib/stats.ts 的 startOfDay() 用的是
 * `d.setHours(0,0,0,0)`（进程本地时区），PublicShell 的 MiniCalendar 用的是
 * 服务端 `new Date().getDate()`。于是同一个产品里存在两三套「今天」：
 * 部署到 UTC 服务器后，北京时间 00:00–08:00 公开看板会把文章算进「昨天」、
 * 侧栏日历会高亮前一天。这个模块是唯一事实来源。
 *
 * 通过 SITE_UTC_OFFSET_MINUTES 覆盖（默认 +480 = UTC+8，无夏令时，固定偏移即可）。
 */

const DEFAULT_OFFSET_MINUTES = 480; // UTC+8
const MIN_OFFSET_MINUTES = -720; // UTC-12
const MAX_OFFSET_MINUTES = 840; // UTC+14

export function siteUtcOffsetMinutes(): number {
  const raw = process.env.SITE_UTC_OFFSET_MINUTES?.trim();
  if (!raw) return DEFAULT_OFFSET_MINUTES;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_OFFSET_MINUTES ||
    parsed > MAX_OFFSET_MINUTES
  ) {
    return DEFAULT_OFFSET_MINUTES;
  }
  return parsed;
}

function offsetMs() {
  return siteUtcOffsetMinutes() * 60 * 1000;
}

/**
 * 站点时区下的日期键，格式 YYYY-MM-DD。
 * 用于人可读的标签与按日归并。
 */
export function siteDayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + offsetMs()).toISOString().slice(0, 10);
}

/**
 * 站点时区下的年 / 月（0 基）/ 日。给日历这类要拆成数字的地方用，
 * 避免调用方再用 getFullYear() 之类的进程本地时区方法。
 */
export function siteDayParts(now: Date = new Date()): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + offsetMs());
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate()
  };
}

/**
 * `@db.Date` 列的桶值：与 siteDayKey 同一天的 UTC 零点 Date。
 *
 * 注意这**不是**该日在真实时间轴上的起点（见 siteDayStart）。Prisma 的
 * `@db.Date` 只存日期部分，两端都用这个函数才能对齐。
 */
export function siteDayBucket(now: Date = new Date()): Date {
  return new Date(`${siteDayKey(now)}T00:00:00.000Z`);
}

/** 把 @db.Date 读回的桶值还原成日期键。 */
export function siteDayKeyFromBucket(bucket: Date): string {
  return bucket.toISOString().slice(0, 10);
}

/**
 * 站点时区下「今天零点」在真实时间轴上的 UTC 瞬间。
 *
 * 用于和真实时间戳列（createdAt / publishedAt 等）比较。UTC+8 时，
 * 北京 8 月 28 日零点对应 2026-08-27T16:00:00Z——与 siteDayBucket 返回的
 * 2026-08-28T00:00:00Z 是两个不同的值，不可互换。
 */
export function siteDayStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + offsetMs());
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMs());
}

/** 在 siteDayStart 基础上前后挪整天，供「近 N 天」窗口使用。 */
export function siteDayStartOffset(days: number, now: Date = new Date()): Date {
  return new Date(siteDayStart(now).getTime() - days * 24 * 60 * 60 * 1000);
}

/** 把任意时间戳归到站点时区的哪一天（YYYY-MM-DD）。 */
export function siteDayKeyOf(instant: Date): string {
  return siteDayKey(instant);
}

/** 站点时区下的短标签 M/D，供图表刻度使用。 */
export function siteShortLabel(instant: Date): string {
  const { month, day } = siteDayParts(instant);
  return `${month + 1}/${day}`;
}

/** 站点时区下的小时（0–23），供「当天 24 小时分布」使用。 */
export function siteHourOf(instant: Date): number {
  return new Date(instant.getTime() + offsetMs()).getUTCHours();
}

/** BullMQ/cron-parser accepts fixed-offset zones; match the site's calendar exactly. */
export function siteScheduleTimeZone(): string {
  const offset = siteUtcOffsetMinutes();
  const absolute = Math.abs(offset);
  return `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
