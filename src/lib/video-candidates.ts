export type VideoLinkCandidate = {
  href: string;
  text?: string | null;
  /** 网络嗅探（content-type 验证过的真实媒体流）来源，URL 形态可能无扩展名。 */
  sniffed?: boolean;
};

const HLS_RE = /\.m3u8(?:[?#]|$)/i;
const SEGMENT_RE = /\.(ts|m4s)(?:[?#]|$)/i;
const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|flv)(?:[?#]|$)/i;
const PLATFORM_RE = /youtube|youtu\.be|bilibili|b23\.tv|vimeo|youku|iqiyi|v\.qq\.com|dailymotion|douyin|kuaishou|ixigua/i;
// 自动挂载的准入分：只有直链媒体（≥700）和已知视频平台（600）够格。
// 抓取器的 ANCHOR_RE 只要 URL 里含 "video" 就算候选，会混进产品控制台、
// 视频频道导航页之类的纯链接（100 分）——那些不是视频，挂上只会污染文章。
const MIN_AUTO_ATTACH_SCORE = 600;

// 栏目/索引页特征：抓取器的 ANCHOR_RE 只看链接里有没有 "video" 字样,
// 因此各站点顶部导航的「视频」入口(如 /video/, /video/list.html,
// /video/gczvideo/list.html)也会被误判成视频候选。这些 URL 实际上没有
// 具体可下载的视频流,L1/L2 都拿不到东西,只会污染文章。
const INDEX_PATH_RE = /(?:^\/[^/]+\/?$|\/(?:index|list|home)\.html?$|\/list-\d+\.html?$)/i;

export function isHlsSegmentUrl(url: string) {
  return SEGMENT_RE.test(url);
}

// 单条视频就挂在单段路径上的短链域：对它们套"单段路径=索引页"会误杀正常视频。
const SHORTLINK_HOST_RE = /(^|\.)(youtu\.be|b23\.tv)$/i;

function looksLikeIndexPage(url: string): boolean {
  if (HLS_RE.test(url) || DIRECT_VIDEO_RE.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (SHORTLINK_HOST_RE.test(parsed.hostname)) return false;
    // youtube.com/watch?v=... 这类平台观看页：路径只有一段，视频 ID 在 query 里。
    if (parsed.search && PLATFORM_RE.test(url)) return false;
    return INDEX_PATH_RE.test(parsed.pathname.toLowerCase());
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
    // 嗅探流已用 content-type 验证过是真媒体：URL 无扩展名、路径像栏目页
    // 都不影响其资格，按直链媒体保底计分；其余候选先过索引页启发式再打分。
    if (!link.sniffed && looksLikeIndexPage(href)) continue;

    const key = candidateKey(href);
    const score = link.sniffed ? Math.max(candidateScore(href), 700) : candidateScore(href);
    const previous = selected.get(key);
    if (!previous) {
      selected.set(key, { link, score, order: index });
      continue;
    }
    if (score > previous.score) {
      selected.set(key, { link, score, order: previous.order });
    }
  }

  const ranked = Array.from(selected.values())
    .sort((a, b) => a.order - b.order)
    .filter((item) => item.score >= MIN_AUTO_ATTACH_SCORE);

  return ranked.slice(0, limit).map((item) => item.link);
}

/**
 * 单条 URL 是否达到自动挂载准入标准（与 selectVideoLinksForPost 同一套判定）。
 * 供清理脚本判断存量自动挂载记录是否属于 ANCHOR_RE 误判的垃圾链接。
 */
export function isAutoAttachableVideoUrl(url: string): boolean {
  const href = (url || "").trim();
  if (!href || !isHttpUrl(href) || isHlsSegmentUrl(href) || looksLikeIndexPage(href)) return false;
  return candidateScore(href) >= MIN_AUTO_ATTACH_SCORE;
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
        .replace(/\/(?:main|\d{2,5})\.m3u8$/i, "/*.m3u8")
        .replace(/\/(?:adp\.[^/]+|video_[^/]+)\.m3u8$/i, "/*.m3u8");
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
    if (/\/video_[^/]+\.m3u8(?:[?#]|$)/i.test(url)) return 980;
    if (/\/adp\.[^/]+\.m3u8(?:[?#]|$)|\/(?:master|index|playlist)[^/]*\.m3u8(?:[?#]|$)/i.test(url)) return 900;
    const bitrate = url.match(/\/hls\/(\d{2,5})\//i)?.[1] || url.match(/\/(\d{2,5})\.m3u8(?:[?#]|$)/i)?.[1];
    return 900 + Math.min(Number(bitrate || 0) / 100, 80);
  }
  if (/\.mp4(?:[?#]|$)/i.test(url)) return 800;
  if (DIRECT_VIDEO_RE.test(url)) return 700;
  if (PLATFORM_RE.test(url)) return 600;
  return 100;
}
