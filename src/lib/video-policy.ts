const DOMESTIC_HOSTS = [
  // 视频平台
  "bilibili.com",
  "b23.tv",
  "weibo.com",
  "iqiyi.com",
  "youku.com",
  "v.qq.com",
  "douyin.com",
  "ixigua.com",
  "weishi.qq.com",
  "miaopai.com",
  "kuaishou.com",
  "xiaohongshu.com",
  "xhslink.com",
  // 主流新闻 / 门户的自播视频
  "cctv.com",
  "cctv.cn",
  "cntv.cn",
  "cntv.com",
  "xinhuanet.com",
  "news.cn",
  "people.cn",
  "people.com.cn",
  "thepaper.cn",
  "huanqiu.com",
  "cnr.cn",
  "sohu.com",
  "163.com",
  "sina.com.cn",
  "ifeng.com"
];

const INTERNATIONAL_VIDEO_DELIVERY_HOSTS = [
  "youtube.com",
  "youtu.be",
  "googlevideo.com",
  "vimeo.com",
  "vimeocdn.com",
  "dailymotion.com",
  "dmcdn.net",
  "twitch.tv",
  "ttvnw.net"
];

export const VIDEO_MEDIA_URL_RE = /\.(mp4|m3u8|m4s|flv|webm|mov)(?:[?#]|$)/i;

function hostMatches(host: string, domains: string[]) {
  return domains.some((domain) => host === domain || host.endsWith("." + domain));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDomesticVideoUrl(url: string): boolean {
  const host = hostnameOf(url);
  return Boolean(host && hostMatches(host, DOMESTIC_HOSTS));
}

export function isKnownInternationalVideoUrl(url: string): boolean {
  const host = hostnameOf(url);
  return Boolean(host && hostMatches(host, INTERNATIONAL_VIDEO_DELIVERY_HOSTS));
}

export function isVideoMediaUrl(url: string): boolean {
  return VIDEO_MEDIA_URL_RE.test(url);
}

/**
 * 国内新闻站的视频流经常落到 CDN 域名上。只看媒体 URL 的 host 会把它们误判成
 * INTERNATIONAL，导致本地下载分支完全不跑。这里把“国内来源页嗅探到的媒体直链”
 * 也归为国内候选，同时排除已知的国际视频平台/CDN。
 */
export function isDomesticVideoCandidate(videoUrl: string, sourcePageUrl?: string | null): boolean {
  if (isDomesticVideoUrl(videoUrl)) return true;
  if (!sourcePageUrl || !isDomesticVideoUrl(sourcePageUrl)) return false;
  if (!isVideoMediaUrl(videoUrl)) return false;
  return !isKnownInternationalVideoUrl(videoUrl);
}

export function shouldAttemptLocalVideoDownload(
  videoUrl: string,
  sourcePageUrl: string | null | undefined,
  allowDownload: boolean
): boolean {
  return allowDownload && isDomesticVideoCandidate(videoUrl, sourcePageUrl);
}
