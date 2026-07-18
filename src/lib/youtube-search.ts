import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startPinnedEgressProxy } from "./pinned-egress-proxy";
import {
  YOUTUBE_EGRESS_HOSTS,
  hardenedYtDlpNetworkArgs,
  trustedVideoDownloadTarget
} from "./video-download-policy";

const execFileAsync = promisify(execFile);
const YT_DLP_BIN = process.env.YT_DLP_PATH || "yt-dlp";

// 搜索是纯元数据请求（--flat-playlist），不下载媒体；60s 足够，超时即放弃。
const SEARCH_TIMEOUT_MS = 60 * 1000;
// 取一批候选再按播放量挑选：候选池要比最终数量大，避免最热的几条正好落在被
// trustedVideoDownloadTarget 过滤掉的形态（频道页 / 直播中 / 非标准链接）。
const DEFAULT_CANDIDATE_POOL = 10;
// Shorts 播放量经常碾压正片，但 60 秒竖屏不适合当"相关视频报道"挂在文末。
// flat-playlist 偶尔缺 duration（null），此时放行——宁可漏拦也别把整批结果清零。
const MIN_DURATION_SEC = 60;

export type YouTubeSearchResult = {
  /** 规范化后的观看页 URL：https://www.youtube.com/watch?v=<id> */
  watchUrl: string;
  title: string;
  viewCount: number;
  durationSec: number | null;
  channel: string | null;
};

type FlatPlaylistEntry = {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  view_count?: unknown;
  duration?: unknown;
  channel?: unknown;
  uploader?: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析 `yt-dlp ytsearchN:... --flat-playlist -J` 的输出，产出按播放量从高到低
 * 排序、去重、且只保留能被 trustedVideoDownloadTarget 认作标准 YouTube 观看页的
 * 结果。纯函数：不触网、不 spawn，便于单测。
 */
export function parseYouTubeSearchResults(rawJson: string, limit: number): YouTubeSearchResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  const entries = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const results: YouTubeSearchResult[] = [];
  for (const raw of entries as FlatPlaylistEntry[]) {
    if (!raw || typeof raw !== "object") continue;
    const candidate =
      (typeof raw.url === "string" && raw.url) ||
      (typeof raw.id === "string" && raw.id ? `https://www.youtube.com/watch?v=${raw.id}` : "");
    if (!candidate) continue;
    // 只接受 yt-dlp 维护的标准观看页形态；频道、播放列表、非法 id 一律出局。
    const target = trustedVideoDownloadTarget(candidate);
    if (!target || target.platform !== "youtube" || seen.has(target.url)) continue;
    seen.add(target.url);

    const duration = toFiniteNumber(raw.duration);
    // Shorts/超短片过滤：时长已知且不足下限的一律出局（见 MIN_DURATION_SEC 注释）。
    if (duration !== null && duration > 0 && duration < MIN_DURATION_SEC) continue;
    results.push({
      watchUrl: target.url,
      title: (typeof raw.title === "string" ? raw.title : "").slice(0, 200),
      viewCount: Math.max(0, Math.trunc(toFiniteNumber(raw.view_count) ?? 0)),
      durationSec: duration !== null && duration > 0 ? Math.round(duration) : null,
      channel:
        (typeof raw.channel === "string" && raw.channel) ||
        (typeof raw.uploader === "string" && raw.uploader) ||
        null
    });
  }

  // 播放量降序；同播放量按标题保持确定性，避免每次抓取顺序抖动。
  results.sort((a, b) => b.viewCount - a.viewCount || a.title.localeCompare(b.title));
  return results.slice(0, Math.max(0, limit));
}

// 型号/代号类 ASCII 词（L03、SU7、Mate70、P7+、9020X）是标题里区分度最高的实体：
// 必须含至少一个字母 + 一个数字，避免把年份（2027）或普通英文单词当型号。
const MODEL_TOKEN_RE = /[A-Za-z]+[0-9][A-Za-z0-9+]*|[0-9]+[A-Za-z][A-Za-z0-9+]*/g;

/**
 * 从文章标题/关键词里抽取"型号级"实体词，用于拼进搜索词并给结果做相关性分层。
 * 实测教训：query 只有"小鹏汽车 最新车型"时，L03 首发文章会挂上播放量更高的
 * P7+ 测评——必须把标题里的 L03 带上。纯函数，便于单测。
 */
export function extractSalientTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of (text || "").matchAll(MODEL_TOKEN_RE)) {
    const token = match[0].toUpperCase();
    if (token.length < 2 || token.length > 12 || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * 相关性分层选优：候选（已按播放量降序）先看标题是否命中任一型号词——命中层
 * 整体优先于未命中层，层内保持播放量序。没有型号词时退化为纯播放量（原行为）。
 * 纯函数，便于单测。
 */
export function pickTopRelevantVideo(
  results: YouTubeSearchResult[],
  salientTokens: string[]
): YouTubeSearchResult | null {
  if (!results.length) return null;
  if (!salientTokens.length) return results[0];
  const tokens = salientTokens.map((t) => t.toUpperCase());
  const hit = results.find((r) => {
    const title = r.title.toUpperCase();
    return tokens.some((t) => title.includes(t));
  });
  return hit ?? results[0];
}

/** 剥离控制字符（0x00–0x1f、0x7f）并压缩空白；不在源码里写任何控制字面量。 */
function sanitizeQuery(query: string): string {
  let out = "";
  for (const ch of query) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 120);
}

const PROXY_ENV_KEYS = [
  "ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
  "all_proxy", "https_proxy", "http_proxy", "no_proxy"
];

function sanitizedEnvironment() {
  const env = { ...process.env };
  for (const key of PROXY_ENV_KEYS) delete env[key];
  return env;
}

// yt-dlp 的版本冻结在镜像构建时；YouTube 改接口后搜索会"成功但永远 0 结果"地
// 静默失效。这里统计连续空结果次数，达到阈值就打显眼告警，别等人肉翻日志发现。
const EMPTY_STREAK_ALERT_THRESHOLD = 5;
let consecutiveEmptySearches = 0;

function trackSearchOutcome(resultCount: number, query: string) {
  if (resultCount > 0) {
    consecutiveEmptySearches = 0;
    return;
  }
  consecutiveEmptySearches += 1;
  if (
    consecutiveEmptySearches >= EMPTY_STREAK_ALERT_THRESHOLD &&
    consecutiveEmptySearches % EMPTY_STREAK_ALERT_THRESHOLD === 0
  ) {
    console.warn(
      `[youtube-search] ⚠ 已连续 ${consecutiveEmptySearches} 次搜索返回 0 结果` +
        `（最近查询：「${query.slice(0, 60)}」）。若查询词正常，多半是 YouTube 接口变更、` +
        `镜像内 yt-dlp 需要更新（重建镜像会安装最新版）。`
    );
  }
}

/**
 * 按查询词搜 YouTube，返回播放量最高的前 `limit` 条（默认 1）。
 *
 * 复用与下载完全一致的安全边界：yt-dlp 走本机固定出站代理（只放行 YouTube 域），
 * 不读宿主配置、不加载插件。任何失败/超时/网络不可达都折叠成空数组——绝不让
 * 一次搜索失败拖垮文章生成。仅在带 yt-dlp 的 full/backend 镜像里可用。
 */
export async function searchTopYouTubeVideos(
  query: string,
  options: { limit?: number; candidatePool?: number } = {}
): Promise<YouTubeSearchResult[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 1, 10));
  const pool = Math.max(limit, Math.min(options.candidatePool ?? DEFAULT_CANDIDATE_POOL, 25));
  const cleanQuery = sanitizeQuery(query);
  if (!cleanQuery) return [];

  let proxy: Awaited<ReturnType<typeof startPinnedEgressProxy>> | null = null;
  try {
    proxy = await startPinnedEgressProxy({ allowedHostSuffixes: YOUTUBE_EGRESS_HOSTS });
    const proxyUrl = new URL(proxy.serverUrl);
    proxyUrl.username = proxy.username;
    proxyUrl.password = proxy.password;

    const args = [
      ...hardenedYtDlpNetworkArgs(proxyUrl.toString()),
      "--no-warnings",
      "--no-progress",
      "--flat-playlist",
      "--socket-timeout", "20",
      "-J",
      `ytsearch${pool}:${cleanQuery}`
    ];
    const { stdout } = await execFileAsync(YT_DLP_BIN, args, {
      timeout: SEARCH_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...sanitizedEnvironment(), LANG: "C.UTF-8" }
    });
    const results = parseYouTubeSearchResults(stdout, limit);
    trackSearchOutcome(results.length, cleanQuery);
    return results;
  } catch (error) {
    // execFile 失败的 error.message 会带上完整命令行（含 --proxy http://user:pass@…）。
    // 一次性代理凭据绝不能落日志——先把它从消息里抹掉，再取首行并截断。
    const raw = error instanceof Error ? error.message : String(error);
    const redacted = (proxy ? raw.split(proxy.password).join("[redacted]") : raw).split("\n")[0];
    console.error(`[youtube-search] 搜索失败（已忽略）：${redacted.slice(0, 160)}`);
    return [];
  } finally {
    await proxy?.close().catch(() => undefined);
  }
}
