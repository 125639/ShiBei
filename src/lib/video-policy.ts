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
  "ifeng.com",
  // 时政 / 财经 / 科技媒体（自播视频）
  "guancha.cn",
  "36kr.com",
  "caixin.com",
  "yicai.com",
  "huxiu.com",
  "mittrchina.com"
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

/**
 * 国际视频平台 → 关联的 host 列表。设置里存的是一组 key（逗号分隔），
 * 命中任一 host 就视为该 key 已启用本地下载。新增平台时直接在这里加 key。
 */
export const INTERNATIONAL_PLATFORM_HOSTS: Record<string, string[]> = {
  youtube: ["youtube.com", "youtu.be", "googlevideo.com"],
  vimeo: ["vimeo.com", "vimeocdn.com"],
  twitch: ["twitch.tv", "ttvnw.net"],
  dailymotion: ["dailymotion.com", "dmcdn.net"]
};

export const INTERNATIONAL_PLATFORM_KEYS = Object.keys(INTERNATIONAL_PLATFORM_HOSTS);

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

export type VideoDownloadPolicy = {
  /** 国内视频平台是否允许本地下载（沿用旧字段 videoDownloadDomestic）。 */
  domestic: boolean;
  /**
   * 已启用的国际平台 key 列表（来自设置 videoDownloadHosts，逗号分隔后清洗）。
   * 命中 INTERNATIONAL_PLATFORM_HOSTS[key] 中任一 host 即允许下载。
   */
  internationalHostKeys: string[];
};

/**
 * 把设置里的 videoDownloadHosts 字段（逗号 / 空白分隔）解析为已启用的国际平台 key 数组。
 * 只保留 INTERNATIONAL_PLATFORM_HOSTS 中已知的 key，避免拼写错误绕过策略。
 */
export function parseInternationalHostKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const known = new Set(INTERNATIONAL_PLATFORM_KEYS);
  const out = new Set<string>();
  for (const token of String(raw).split(/[\s,]+/)) {
    const key = token.trim().toLowerCase();
    if (key && known.has(key)) out.add(key);
  }
  return [...out];
}

export function isEnabledInternationalCandidate(videoUrl: string, enabledKeys: string[]): boolean {
  if (!enabledKeys.length) return false;
  const host = hostnameOf(videoUrl);
  if (!host) return false;
  for (const key of enabledKeys) {
    const hosts = INTERNATIONAL_PLATFORM_HOSTS[key];
    if (hosts && hostMatches(host, hosts)) return true;
  }
  return false;
}

/**
 * 统一的下载策略 gate。既覆盖国内列表，也覆盖用户显式勾选的国际平台。
 * 调用方只需要传策略对象，不需要自己再决定 domestic vs international。
 */
export function shouldDownloadVideo(
  videoUrl: string,
  sourcePageUrl: string | null | undefined,
  policy: VideoDownloadPolicy
): boolean {
  if (policy.domestic && isDomesticVideoCandidate(videoUrl, sourcePageUrl)) return true;
  if (isEnabledInternationalCandidate(videoUrl, policy.internationalHostKeys)) return true;
  return false;
}
