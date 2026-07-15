export type TrustedVideoPlatform = "youtube" | "bilibili" | "vimeo" | "dailymotion";

const PLATFORM_EGRESS_HOSTS: Record<TrustedVideoPlatform, readonly string[]> = {
  youtube: [
    "youtube.com",
    "youtube-nocookie.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
    "googleapis.com",
    "google.com",
    "gstatic.com",
    "ggpht.com"
  ],
  bilibili: [
    "bilibili.com",
    "b23.tv",
    "bilivideo.com",
    "bilivideo.cn",
    "hdslb.com",
    "biliapi.com"
  ],
  vimeo: ["vimeo.com", "vimeocdn.com"],
  dailymotion: ["dailymotion.com", "dai.ly", "dmcdn.net"]
};

function normalizedHost(url: URL) {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

function hostIs(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function safeUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function youtubeId(url: URL): string | null {
  const host = normalizedHost(url);
  const validId = (value: string | null) => value && /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : null;
  if (hostIs(host, "youtu.be")) return validId(url.pathname.split("/").filter(Boolean)[0] || null);
  if (!hostIs(host, "youtube.com") && !hostIs(host, "youtube-nocookie.com")) return null;
  if (url.pathname === "/watch") return validId(url.searchParams.get("v"));
  const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,20})(?:\/|$)/);
  return match?.[1] || null;
}

function bilibiliVideo(url: URL): string | null {
  const host = normalizedHost(url);
  if (hostIs(host, "b23.tv")) {
    const token = url.pathname.match(/^\/([A-Za-z0-9_-]{2,40})\/?$/)?.[1];
    return token ? `https://b23.tv/${token}` : null;
  }
  if (hostIs(host, "player.bilibili.com")) {
    const bvid = url.searchParams.get("bvid");
    if (bvid && /^BV[A-Za-z0-9]{8,20}$/.test(bvid)) {
      return `https://www.bilibili.com/video/${bvid}`;
    }
    return null;
  }
  if (!hostIs(host, "bilibili.com")) return null;
  const match = url.pathname.match(/^\/video\/((?:BV[A-Za-z0-9]{8,20})|(?:av\d{1,20}))(?:\/|$)/i);
  return match ? `https://www.bilibili.com/video/${match[1]}` : null;
}

export type TrustedVideoDownloadTarget = {
  platform: TrustedVideoPlatform;
  url: string;
  allowedHostSuffixes: readonly string[];
};

/**
 * Only explicit watch-page shapes from a small set of maintained yt-dlp
 * extractors are accepted. Arbitrary news pages, CDN URLs and generic direct
 * media URLs deliberately fail closed.
 */
export function trustedVideoDownloadTarget(rawUrl: string): TrustedVideoDownloadTarget | null {
  const url = safeUrl(rawUrl.trim());
  if (!url) return null;
  const host = normalizedHost(url);

  const ytId = youtubeId(url);
  if (ytId) {
    return {
      platform: "youtube",
      url: `https://www.youtube.com/watch?v=${ytId}`,
      allowedHostSuffixes: PLATFORM_EGRESS_HOSTS.youtube
    };
  }

  const biliUrl = bilibiliVideo(url);
  if (biliUrl) {
    return {
      platform: "bilibili",
      url: biliUrl,
      allowedHostSuffixes: PLATFORM_EGRESS_HOSTS.bilibili
    };
  }

  const vimeoMatch = url.pathname.match(/^\/(?:video\/)?(\d{5,15})(?:\/|$)/);
  if (hostIs(host, "vimeo.com") && vimeoMatch) {
    return {
      platform: "vimeo",
      url: `https://vimeo.com/${vimeoMatch[1]}`,
      allowedHostSuffixes: PLATFORM_EGRESS_HOSTS.vimeo
    };
  }

  const dailyMatch = hostIs(host, "dai.ly")
    ? url.pathname.match(/^\/([A-Za-z0-9]{5,20})(?:\/|$)/)
    : url.pathname.match(/^\/(?:embed\/)?video\/([A-Za-z0-9]{5,20})(?:\/|$)/);
  if ((hostIs(host, "dailymotion.com") || hostIs(host, "dai.ly")) && dailyMatch) {
    return {
      platform: "dailymotion",
      url: `https://www.dailymotion.com/video/${dailyMatch[1]}`,
      allowedHostSuffixes: PLATFORM_EGRESS_HOSTS.dailymotion
    };
  }

  return null;
}

/** Security-critical yt-dlp switches kept in one testable list. */
export function hardenedYtDlpNetworkArgs(proxyUrl: string) {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== "http:" || proxy.hostname !== "127.0.0.1" || !proxy.port) {
    throw new Error("yt-dlp 只能使用本机固定出站代理");
  }
  return [
    "--ignore-config",
    "--no-plugin-dirs",
    "--hls-prefer-native",
    "--proxy",
    proxy.toString()
  ];
}
