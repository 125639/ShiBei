import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startPinnedEgressProxy } from "./pinned-egress-proxy";
import {
  BILIBILI_EGRESS_HOSTS,
  hardenedYtDlpNetworkArgs,
  trustedVideoDownloadTarget
} from "./video-download-policy";
import {
  MIN_DURATION_SEC,
  SEARCH_TIMEOUT_MS,
  YT_DLP_BIN,
  sanitizeQuery,
  sanitizedEnvironment,
  type YouTubeSearchResult
} from "./youtube-search";

const execFileAsync = promisify(execFile);

// bilisearch 的 flat 输出只有 av 号 URL，没有播放量/时长/标题（与 ytsearch 不同，
// 2026-07 实测确认）。因此 B 站是两步：flat 拿候选 → 对前几名做元数据提取
// （-J --skip-download，单条约 1–3s），再按播放量排序。探测条数别贪多。
const DEFAULT_CANDIDATE_POOL = 6;
const DEFAULT_METADATA_PROBES = 4;

// B 站搜索接口对数据中心 IP 有**随机**风控（HTTP 412，2026-07 实测同容器连跑
// 6 次 3 败，与出站代理无关）。412 是瞬时的，隔一两秒重试大概率过；这里做有限
// 重试而不是把偶发风控当成"没有结果"。
const FLAT_SEARCH_ATTEMPTS = 3;
const METADATA_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function execYtDlpWithRetry(
  args: string[],
  options: Parameters<typeof execFileAsync>[2],
  attempts: number
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(YT_DLP_BIN, args, options);
      return String(stdout);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

/** 第一步（纯函数）：解析 bilisearchN flat 输出 → 规范化观看页 URL 列表（保序）。 */
export function parseBilibiliSearchCandidates(rawJson: string, max: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  const entries = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entries as Array<{ url?: unknown; id?: unknown }>) {
    if (!raw || typeof raw !== "object") continue;
    const candidate =
      (typeof raw.url === "string" && raw.url) ||
      (typeof raw.id === "string" && raw.id ? `https://www.bilibili.com/video/av${raw.id}` : "");
    if (!candidate) continue;
    // bilisearch flat 输出的 URL 是 http://（2026-07 实测），而下载白名单只认 https——先升格。
    const target = trustedVideoDownloadTarget(candidate.replace(/^http:\/\//i, "https://"));
    if (!target || target.platform !== "bilibili" || seen.has(target.url)) continue;
    seen.add(target.url);
    out.push(target.url);
    if (out.length >= Math.max(0, max)) break;
  }
  return out;
}

/** 第二步（纯函数）：解析单条视频的 -J 元数据 → 统一结果形态；不合格返回 null。 */
export function parseBilibiliMetadata(rawJson: string): YouTubeSearchResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  const d = parsed as {
    id?: unknown;
    title?: unknown;
    view_count?: unknown;
    duration?: unknown;
    uploader?: unknown;
    channel?: unknown;
  };
  // yt-dlp 对 B 站返回的 id 是 BV 号；拿它构造规范观看页（av 入口也归一到 BV）。
  const bvid = typeof d.id === "string" && /^BV[A-Za-z0-9]{8,20}$/.test(d.id) ? d.id : null;
  if (!bvid) return null;
  const durationRaw = typeof d.duration === "number" ? d.duration : Number(d.duration);
  const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null;
  if (durationSec !== null && durationSec < MIN_DURATION_SEC) return null;
  const viewRaw = typeof d.view_count === "number" ? d.view_count : Number(d.view_count);
  return {
    watchUrl: `https://www.bilibili.com/video/${bvid}`,
    title: (typeof d.title === "string" ? d.title : "").slice(0, 200),
    viewCount: Number.isFinite(viewRaw) ? Math.max(0, Math.trunc(viewRaw)) : 0,
    durationSec,
    channel:
      (typeof d.uploader === "string" && d.uploader) ||
      (typeof d.channel === "string" && d.channel) ||
      null
  };
}

/**
 * 按查询词搜 Bilibili，返回播放量最高的前 `limit` 条。与 YouTube 搜索同一套安全
 * 边界（本机固定出站代理，仅放行 B 站域）；任何失败/超时折叠成空数组，绝不拖垮
 * 文章生成。B 站 iframe 墙内直连可嵌，是国内受众"看得了"的首选视频源。
 */
export async function searchTopBilibiliVideos(
  query: string,
  options: { limit?: number; candidatePool?: number; metadataProbes?: number } = {}
): Promise<YouTubeSearchResult[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 1, 10));
  const pool = Math.max(limit, Math.min(options.candidatePool ?? DEFAULT_CANDIDATE_POOL, 20));
  const probes = Math.max(1, Math.min(options.metadataProbes ?? DEFAULT_METADATA_PROBES, 6));
  const cleanQuery = sanitizeQuery(query);
  if (!cleanQuery) return [];

  let proxy: Awaited<ReturnType<typeof startPinnedEgressProxy>> | null = null;
  try {
    proxy = await startPinnedEgressProxy({ allowedHostSuffixes: BILIBILI_EGRESS_HOSTS });
    const proxyUrl = new URL(proxy.serverUrl);
    proxyUrl.username = proxy.username;
    proxyUrl.password = proxy.password;
    const baseArgs = [
      ...hardenedYtDlpNetworkArgs(proxyUrl.toString()),
      "--no-warnings",
      "--no-progress",
      "--socket-timeout", "20",
      "-J"
    ];
    const execOptions = {
      timeout: SEARCH_TIMEOUT_MS,
      killSignal: "SIGKILL" as const,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...sanitizedEnvironment(), LANG: "C.UTF-8" }
    };

    const flatOut = await execYtDlpWithRetry(
      [...baseArgs, "--flat-playlist", `bilisearch${pool}:${cleanQuery}`],
      execOptions,
      FLAT_SEARCH_ATTEMPTS
    );
    const candidates = parseBilibiliSearchCandidates(flatOut, probes);

    const results: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    for (const url of candidates) {
      try {
        const stdout = await execYtDlpWithRetry([...baseArgs, "--skip-download", url], execOptions, METADATA_ATTEMPTS);
        const meta = parseBilibiliMetadata(stdout);
        if (meta && !seen.has(meta.watchUrl)) {
          seen.add(meta.watchUrl);
          results.push(meta);
        }
      } catch {
        // 单条元数据失败（下架/地区限制/超时）跳过即可，不影响其余候选。
        continue;
      }
    }
    results.sort((a, b) => b.viewCount - a.viewCount || a.title.localeCompare(b.title));
    return results.slice(0, limit);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // 与 YouTube 搜索同一条纪律：一次性代理凭据绝不落日志。
    const redacted = (proxy ? raw.split(proxy.password).join("[redacted]") : raw).split("\n")[0];
    console.error(`[bilibili-search] 搜索失败（已忽略）：${redacted.slice(0, 160)}`);
    return [];
  } finally {
    await proxy?.close().catch(() => undefined);
  }
}
