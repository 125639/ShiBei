export type VideoLinkCandidate = {
  href: string;
  text?: string | null;
};

const HLS_RE = /\.m3u8(?:[?#]|$)/i;
const SEGMENT_RE = /\.(ts|m4s)(?:[?#]|$)/i;
const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|flv)(?:[?#]|$)/i;
const PLATFORM_RE = /youtube|youtu\.be|bilibili|vimeo|youku|iqiyi|v\.qq\.com|dailymotion/i;

// 栏目/索引页特征：抓取器的 ANCHOR_RE 只看链接里有没有 "video" 字样,
// 因此各站点顶部导航的「视频」入口(如 /video/, /video/list.html,
// /video/gczvideo/list.html)也会被误判成视频候选。这些 URL 实际上没有
// 具体可下载的视频流,L1/L2 都拿不到东西,只会污染文章。
const INDEX_PATH_RE = /(?:^\/[^/]+\/?$|\/(?:index|list|home)\.html?$|\/list-\d+\.html?$)/i;

export function isHlsSegmentUrl(url: string) {
  return SEGMENT_RE.test(url);
}

function looksLikeIndexPage(url: string): boolean {
  if (HLS_RE.test(url) || DIRECT_VIDEO_RE.test(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return INDEX_PATH_RE.test(path);
  } catch {
    return false;
  }
}

export function selectVideoLinksForPost<T extends VideoLinkCandidate>(links: readonly T[], limit = 4): T[] {
  const selected = new Map<string, { link: T; score: number; order: number }>();

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const href = link.href?.trim();
    if (!href || !isHttpUrl(href) || isHlsSegmentUrl(href)) continue;
    if (looksLikeIndexPage(href)) continue;

    const key = candidateKey(href);
    const score = candidateScore(href);
    const previous = selected.get(key);
    if (!previous) {
      selected.set(key, { link, score, order: index });
      continue;
    }
    if (score > previous.score) {
      selected.set(key, { link, score, order: previous.order });
    }
  }

  return Array.from(selected.values())
    .sort((a, b) => a.order - b.order)
    .slice(0, limit)
    .map((item) => item.link);
}

function isHttpUrl(url: string) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function candidateKey(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (HLS_RE.test(url)) {
      const normalizedPath = pathname
        .replace(/\/hls\/(?:main|\d{2,5})\//i, "/hls/*/")
        .replace(/\/(?:main|\d{2,5})\.m3u8$/i, "/*.m3u8");
      return `hls:${host}${normalizedPath}`;
    }
    if (DIRECT_VIDEO_RE.test(url)) {
      return `media:${host}${pathname}`;
    }
    return `link:${host}${pathname}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

function candidateScore(url: string) {
  if (HLS_RE.test(url)) {
    if (/\/hls\/main\//i.test(url) || /\/main\.m3u8(?:[?#]|$)/i.test(url)) return 1000;
    const bitrate = url.match(/\/hls\/(\d{2,5})\//i)?.[1] || url.match(/\/(\d{2,5})\.m3u8(?:[?#]|$)/i)?.[1];
    return 900 + Math.min(Number(bitrate || 0) / 100, 80);
  }
  if (/\.mp4(?:[?#]|$)/i.test(url)) return 800;
  if (DIRECT_VIDEO_RE.test(url)) return 700;
  if (PLATFORM_RE.test(url)) return 600;
  return 100;
}
