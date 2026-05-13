import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { chromium, type Page } from "playwright";
import { ensureUploadDirs, VIDEO_DIR } from "./storage";
import { getModelConfigForUse } from "./model-selection";
import { requestChatCompletion } from "./ai";
import { assertSafeFetchUrl } from "./url-safety";
import { isDomesticVideoCandidate, isVideoMediaUrl, shouldDownloadVideo, VIDEO_MEDIA_URL_RE, type VideoDownloadPolicy } from "./video-policy";

export {
  INTERNATIONAL_PLATFORM_HOSTS,
  INTERNATIONAL_PLATFORM_KEYS,
  isDomesticVideoCandidate,
  isDomesticVideoUrl,
  isEnabledInternationalCandidate,
  isKnownInternationalVideoUrl,
  isVideoMediaUrl,
  parseInternationalHostKeys,
  shouldAttemptLocalVideoDownload,
  shouldDownloadVideo
} from "./video-policy";
export type { VideoDownloadPolicy } from "./video-policy";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HLS_RE = /\.m3u8(?:[?#]|$)/i;

export type DownloadResult = {
  localPath: string;
  fileSizeBytes: number;
  durationSec: number | null;
};

export type DownloadOptions = {
  /** 单视频时长上限。直接下载时换算成字节预算（~1MB/s），yt-dlp 走 --match-filter。 */
  maxDurationSec?: number;
  /** 来源页 URL，用于设置 Referer（很多 CDN 拿不到 Referer 会 403）。 */
  referer?: string;
};

/**
 * Best-effort 下载国内主机的视频。新策略（按顺序兜底）：
 *
 *   L1  url 已经是直链 .mp4/.m3u8/视频流  → Node fetch 直接下载
 *   L2  url 是页面 → 用 Playwright 嗅探网络流量拿真实视频 URL → L1
 *   L3  yt-dlp（如果装了）
 *   L4  把页面 HTML 丢给 LLM (Kimi K2.6 等)，让模型识别视频 URL → L1
 *
 * 任何一层成功就返回；全部失败返回 null（上层把视频记成 LINK 类型不下载）。
 *
 * Compliance：调用方必须把 sourcePageUrl/原 URL 写进 Video.attribution，本函数
 * 只负责把二进制拉到本地。
 */
export async function downloadDomesticVideo(
  url: string,
  opts?: DownloadOptions
): Promise<DownloadResult | null> {
  if (!isDomesticVideoCandidate(url, opts?.referer)) return null;
  return downloadVideo(url, opts);
}

/**
 * 按完整下载策略（国内 + 用户勾选的国际平台）下载。命中策略才进入下载流程，
 * 否则直接返回 null。给 worker 替代单纯的 downloadDomesticVideo 用。
 */
export async function downloadVideoByPolicy(
  url: string,
  policy: VideoDownloadPolicy,
  opts?: DownloadOptions
): Promise<DownloadResult | null> {
  if (!shouldDownloadVideo(url, opts?.referer, policy)) return null;
  return downloadVideo(url, opts);
}

/**
 * 不带"国内站点"前置 gate 的下载入口。希望按 caller 自己的策略决定要不要下时用这个。
 */
export async function downloadVideo(
  url: string,
  opts?: DownloadOptions
): Promise<DownloadResult | null> {
  await ensureUploadDirs();
  const maxSec = opts?.maxDurationSec ?? 1200;
  const explicitReferer = opts?.referer;
  const sourceRefererUrl = shouldUseSourceReferer(url) ? explicitReferer : null;
  const referer = sourceRefererUrl || originOf(url) || url;
  const sniffPageUrl = explicitReferer && shouldResniffReferer(url, explicitReferer) ? explicitReferer : url;
  const sniffReferer = sniffPageUrl;

  // L1：URL 本身就是直链
  if (looksLikeMediaUrl(url)) {
    const r = await downloadMediaUrl(url, referer, maxSec).catch((err) => {
      console.warn(`[video-download] L1 direct fetch failed for ${url}:`, err?.message || err);
      return null;
    });
    if (r) return r;
  }

  // L2：开 Playwright 嗅网络
  const sniffed = await sniffMediaWithBrowser(sniffPageUrl, maxSec).catch((err) => {
    console.warn(`[video-download] L2 sniff failed for ${sniffPageUrl}:`, err?.message || err);
    return null;
  });
  if (sniffed?.mediaUrl) {
    const r = await downloadMediaUrl(sniffed.mediaUrl, sniffReferer, maxSec, {
      cookieHeader: sniffed.cookieHeader
    }).catch((err) => {
      console.warn(`[video-download] L2 download failed for ${sniffed.mediaUrl}:`, err?.message || err);
      return null;
    });
    if (r) return r;
  }

  // L3：yt-dlp
  const yt = await tryYtDlp(url, maxSec, referer).catch((err) => {
    console.warn(`[video-download] L3 yt-dlp threw for ${url}:`, err?.message || err);
    return null;
  });
  if (yt) return yt;

  // L4：LLM 识别视频 URL
  const llm = await extractWithLLM(sniffPageUrl, sniffed?.html ?? null).catch((err) => {
    console.warn(`[video-download] L4 LLM extract failed for ${sniffPageUrl}:`, err?.message || err);
    return null;
  });
  if (llm) {
    const r = await downloadMediaUrl(llm, referer, maxSec, {
      cookieHeader: sniffed?.cookieHeader
    }).catch((err) => {
      console.warn(`[video-download] L4 download failed for ${llm}:`, err?.message || err);
      return null;
    });
    if (r) return r;
  }

  console.warn(`[video-download] all strategies exhausted for ${url}`);
  return null;
}

// ── L1: 直链下载 ────────────────────────────────────────────

function looksLikeMediaUrl(url: string): boolean {
  return isVideoMediaUrl(url);
}

async function downloadMediaUrl(
  mediaUrl: string,
  referer: string,
  maxSec: number,
  extra?: { cookieHeader?: string }
): Promise<DownloadResult | null> {
  // 防 SSRF：mediaUrl 可能来自 LLM 或页面网络嗅探,要拒绝 file:// / 内网 / 云 metadata。
  assertSafeFetchUrl(mediaUrl);

  if (HLS_RE.test(mediaUrl)) {
    return downloadHlsWithFfmpeg(mediaUrl, referer, maxSec, extra);
  }
  return streamDownloadFile(mediaUrl, referer, maxSec, extra);
}

async function streamDownloadFile(
  mediaUrl: string,
  referer: string,
  maxSec: number,
  extra?: { cookieHeader?: string }
): Promise<DownloadResult | null> {
  const id = crypto.randomBytes(8).toString("hex");
  const ext = guessExtFromUrl(mediaUrl) || "mp4";
  const fileName = `${id}.${ext}`;
  const abs = path.join(VIDEO_DIR, fileName);
  // 字节预算：保守按 ~1.5 MB/s 估算（高码率新闻片大约这个量级）。再加 50% 余量
  // 防止刚到上限就掐断。
  const maxBytes = Math.max(maxSec * 1_500_000 * 1.5, 20 * 1024 * 1024);

  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Referer: referer,
    Accept: "*/*"
  };
  if (extra?.cookieHeader) headers.Cookie = extra.cookieHeader;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  let resp: Response;
  try {
    resp = await fetch(mediaUrl, { method: "GET", headers, signal: controller.signal, redirect: "follow" });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
  if (!resp.ok || !resp.body) {
    clearTimeout(timeout);
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const declaredLen = Number(resp.headers.get("content-length") || "0");
  if (declaredLen > 0 && declaredLen > maxBytes) {
    clearTimeout(timeout);
    throw new Error(`file too large: ${declaredLen} > ${maxBytes}`);
  }

  let written = 0;
  const out = createWriteStream(abs);
  const monitored = Readable.fromWeb(resp.body as unknown as import("stream/web").ReadableStream<Uint8Array>);
  monitored.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > maxBytes) {
      controller.abort();
      monitored.destroy(new Error(`download exceeded budget ${maxBytes} bytes`));
    }
  });

  try {
    await pipeline(monitored, out);
  } catch (err) {
    clearTimeout(timeout);
    await fs.unlink(abs).catch(() => {});
    throw err;
  }
  clearTimeout(timeout);

  const stat = await fs.stat(abs);
  if (stat.size < 50_000) {
    // 太小八成是 403/429 错误页被当成 mp4 写下来了
    await fs.unlink(abs).catch(() => {});
    throw new Error(`downloaded file suspiciously small: ${stat.size} bytes`);
  }

  return {
    localPath: `/uploads/video/${fileName}`,
    fileSizeBytes: stat.size,
    durationSec: null
  };
}

async function downloadHlsWithFfmpeg(
  mediaUrl: string,
  referer: string,
  maxSec: number,
  extra?: { cookieHeader?: string }
): Promise<DownloadResult | null> {
  const ffmpeg = await resolveBin("ffmpeg");
  if (!ffmpeg) {
    console.warn(`[video-download] m3u8 stream encountered but ffmpeg not installed; skipping ${mediaUrl}`);
    return null;
  }
  const id = crypto.randomBytes(8).toString("hex");
  const fileName = `${id}.mp4`;
  const abs = path.join(VIDEO_DIR, fileName);

  // -t 限时长（秒），防止恶意长流把磁盘塞满
  // -bsf:a aac_adtstoasc 是 HLS→MP4 容器转换的常规所需 bitstream filter
  const ffmpegHeaders = [
    `User-Agent: ${BROWSER_UA}`,
    `Referer: ${referer}`,
    extra?.cookieHeader ? `Cookie: ${extra.cookieHeader}` : ""
  ].filter(Boolean).join("\r\n") + "\r\n";

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-headers",
    ffmpegHeaders,
    "-i",
    mediaUrl,
    "-t",
    String(maxSec),
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    "-f",
    "mp4",
    abs
  ];

  const result = await runCmd(ffmpeg, args, { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) {
    await fs.unlink(abs).catch(() => {});
    console.warn(`[video-download] ffmpeg failed (${result.code}): ${result.stderr.slice(0, 400)}`);
    return null;
  }
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || stat.size < 50_000) {
    if (stat) await fs.unlink(abs).catch(() => {});
    return null;
  }
  return {
    localPath: `/uploads/video/${fileName}`,
    fileSizeBytes: stat.size,
    durationSec: null
  };
}

// ── L2: Playwright 嗅探 ─────────────────────────────────────

async function sniffMediaWithBrowser(
  pageUrl: string,
  maxSec: number
): Promise<{ mediaUrl: string; html: string; cookieHeader: string } | null> {
  assertSafeFetchUrl(pageUrl);
  const browser = await chromium.launch({ headless: true }).catch((err) => {
    console.warn("[video-download] chromium not available:", err?.message || err);
    return null;
  });
  if (!browser) return null;

  type Found = { url: string; bytes: number; isManifest: boolean };
  const found = new Map<string, Found>();
  try {
    const ctx = await browser.newContext({ userAgent: BROWSER_UA });
    const page = await ctx.newPage();
    page.on("response", (resp) => {
      try {
        const u = resp.url();
        if (found.has(u) || !/^https?:/i.test(u)) return;
        const ct = (resp.headers()["content-type"] || "").toLowerCase();
        const matchesUrl = VIDEO_MEDIA_URL_RE.test(u);
        const matchesCt = /^(video\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i.test(ct);
        if (!matchesUrl && !matchesCt) return;
        const bytes = Number(resp.headers()["content-length"] || "0");
        const isManifest = HLS_RE.test(u) || /\.(m4s|mpd)(?:[?#]|$)/i.test(u) || /mpegurl|dash/i.test(ct);
        if (!isManifest && bytes > 0 && bytes < 100_000) return;
        found.set(u, { url: u, bytes, isManifest });
      } catch {
        /* ignore */
      }
    });

    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
    await triggerHtml5VideoPlayback(page).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    // 给播放器一点额外时间真正开始拉流（很多站点 networkidle 后 1-3s 才挂播放器）
    await page.waitForTimeout(Math.min(maxSec * 100, 5000));

    const html = await page.content().catch(() => "");
    const cookies = await ctx.cookies().catch(() => [] as Array<{ name: string; value: string }>);
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    if (process.env.VIDEO_DOWNLOADER_DEBUG === "1") {
      console.log(`[video-download] sniffed ${found.size} candidate URL(s) for ${pageUrl}`);
      for (const f of found.values()) console.log(`  → ${f.url} (${f.bytes} bytes, manifest=${f.isManifest})`);
    }

    if (found.size === 0) return { mediaUrl: "", html, cookieHeader };

    // 选优先级：具体 HLS 清单 > 主 HLS 清单 > 体积最大的 mp4 > 任何剩下的。
    // 一些站点的 master/adp 清单会列出多个码率，ffmpeg 可能逐个探测并被单个坏分片拖垮；
    // 已经被播放器实际请求过的具体清单更稳定。
    const arr = Array.from(found.values());
    const m3u8 = arr
      .filter((f) => HLS_RE.test(f.url))
      .sort((a, b) => hlsPlaylistScore(b.url) - hlsPlaylistScore(a.url))[0];
    const sortedMp4 = arr
      .filter((f) => !f.isManifest)
      .sort((a, b) => b.bytes - a.bytes);
    const pick = m3u8?.url || sortedMp4[0]?.url || arr[0]?.url || "";
    return { mediaUrl: pick, html, cookieHeader };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── L3: yt-dlp ──────────────────────────────────────────────

async function tryYtDlp(url: string, maxSec: number, referer: string): Promise<DownloadResult | null> {
  const ytdlp = await resolveBin("yt-dlp");
  if (!ytdlp) return null;

  const id = crypto.randomBytes(8).toString("hex");
  const out = path.join(VIDEO_DIR, `${id}.%(ext)s`);
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificate",
    "--retries",
    "3",
    "--user-agent",
    BROWSER_UA,
    "--referer",
    referer,
    "--match-filter",
    `duration <= ${maxSec}`,
    "-f",
    "best[ext=mp4]/best",
    "-o",
    out,
    "--print-json",
    url
  ];
  const result = await runCmd(ytdlp, args, { timeoutMs: 8 * 60 * 1000 });
  if (result.code !== 0) {
    console.warn(`[video-download] yt-dlp failed (${result.code}): ${result.stderr.slice(0, 400)}`);
    return null;
  }
  const entries = await fs.readdir(VIDEO_DIR);
  const file = entries.find((f) => f.startsWith(`${id}.`));
  if (!file) return null;
  const abs = path.join(VIDEO_DIR, file);
  const stat = await fs.stat(abs);
  let durationSec: number | null = null;
  try {
    const json = JSON.parse(result.stdout.split("\n").find((l) => l.startsWith("{")) || "{}");
    if (typeof json.duration === "number") durationSec = Math.floor(json.duration);
  } catch {
    /* ignore */
  }
  return {
    localPath: `/uploads/video/${file}`,
    fileSizeBytes: stat.size,
    durationSec
  };
}

// ── L4: LLM 提取 ────────────────────────────────────────────

async function extractWithLLM(pageUrl: string, prefetchedHtml: string | null): Promise<string | null> {
  const modelConfig = await getModelConfigForUse("assistant").catch(() => null);
  if (!modelConfig) {
    console.warn("[video-download] no LLM model configured for video URL extraction");
    return null;
  }

  let html = prefetchedHtml;
  if (!html) {
    try {
      const resp = await fetch(pageUrl, {
        headers: { "User-Agent": BROWSER_UA, Referer: originOf(pageUrl) || pageUrl },
        signal: AbortSignal.timeout(20_000)
      });
      if (resp.ok) html = await resp.text();
    } catch (err) {
      console.warn(`[video-download] LLM tier: failed to fetch HTML for ${pageUrl}:`, err);
    }
  }
  if (!html) return null;

  // 模型上下文有限,把 HTML 砍到两段：head + 第一个 <video>/script 附近。
  const trimmed = trimHtmlForLlm(html);

  const system =
    "你是一个从网页 HTML 中识别真实视频文件 URL 的助手。只输出一个 URL（裸 URL，不要 markdown，不要解释）；如果实在识别不出来，输出字符串 NONE。";
  const user = [
    `页面 URL: ${pageUrl}`,
    "",
    "请在下面的 HTML 片段中识别真正的视频流地址（mp4 或 m3u8 等媒体 URL）。",
    "通常它出现在 <video src=>、<source src=>、播放器初始化的 JSON 配置（如 videoUrl/playUrl/file/source）里。",
    "如果只看到了播放器接口而没有具体 URL，可以根据已有 URL 的规律推断；不能推断就回答 NONE。",
    "",
    "HTML 片段：",
    trimmed
  ].join("\n");

  let raw: string;
  try {
    raw = await requestChatCompletion(modelConfig, user, system);
  } catch (err) {
    console.warn(`[video-download] LLM call failed:`, err);
    return null;
  }

  const candidate = raw
    .trim()
    .replace(/^[`"'<>]+|[`"'<>]+$/g, "")
    .replace(/^\s*URL\s*[:=]\s*/i, "")
    .split(/\s+/)[0];
  if (!candidate || candidate.toUpperCase() === "NONE") return null;
  if (!/^https?:\/\//i.test(candidate)) return null;
  if (!looksLikeMediaUrl(candidate)) {
    console.warn(`[video-download] LLM returned non-media URL, ignoring: ${candidate}`);
    return null;
  }
  return candidate;
}

function trimHtmlForLlm(html: string): string {
  // 截到 ~12k 字符；优先保留 <head>（meta og:video 等）和首个 <video>/<script> 附近上下文。
  const MAX = 12_000;
  if (html.length <= MAX) return html;
  const head = html.slice(0, 4_000);
  const videoIdx = html.search(/<video[\s>]/i);
  const scriptIdx = html.search(/playUrl|videoUrl|videoSrc|videoFile|m3u8|\.mp4/i);
  const anchor = videoIdx >= 0 ? videoIdx : scriptIdx >= 0 ? scriptIdx : Math.floor(html.length / 2);
  const slice = html.slice(Math.max(0, anchor - 4_000), Math.min(html.length, anchor + 4_000));
  return `${head}\n<!-- ...trimmed... -->\n${slice}`;
}

// ── 工具函数 ────────────────────────────────────────────────

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function shouldUseSourceReferer(url: string): boolean {
  return looksLikeMediaUrl(url) || /\/videoplayback(?:[/?#]|$)|[?&]mime=video\//i.test(url);
}

function shouldResniffReferer(url: string, referer: string): boolean {
  if (!referer || referer === url) return false;
  if (!/^https?:\/\//i.test(referer)) return false;
  return shouldUseSourceReferer(url);
}

async function triggerHtml5VideoPlayback(page: Page) {
  await page.evaluate(() => {
    for (const video of Array.from(document.querySelectorAll("video"))) {
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => undefined);
    }
  });
}

function guessExtFromUrl(url: string): string | null {
  const m = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ["mp4", "m4v", "mov", "webm", "flv"].includes(ext) ? ext : null;
}

function hlsPlaylistScore(url: string) {
  if (/\/hls\/main\//i.test(url) || /\/main\.m3u8(?:[?#]|$)/i.test(url)) return 1000;
  if (/\/video_[^/]+\.m3u8(?:[?#]|$)/i.test(url)) return 980;
  if (/\/adp\.[^/]+\.m3u8(?:[?#]|$)|\/(?:master|index|playlist)[^/]*\.m3u8(?:[?#]|$)/i.test(url)) return 900;
  const bitrate = url.match(/\/hls\/(\d{2,5})\//i)?.[1] || url.match(/\/(\d{2,5})\.m3u8(?:[?#]|$)/i)?.[1];
  return 900 + Math.min(Number(bitrate || 0) / 100, 80);
}

async function resolveBin(name: string): Promise<string | null> {
  const candidates = [`/usr/local/bin/${name}`, `/usr/bin/${name}`, name];
  if (name === "ffmpeg") {
    if (process.env.FFMPEG_PATH) candidates.unshift(process.env.FFMPEG_PATH);
    candidates.push(...await playwrightFfmpegCandidates());
  }
  const versionArgs = name === "ffmpeg" ? ["-version"] : ["--version"];
  for (const candidate of candidates) {
    try {
      const result = await runCmd(candidate, versionArgs, { timeoutMs: 5_000 });
      if (result.code === 0) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function playwrightFfmpegCandidates(): Promise<string[]> {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
      ? process.env.PLAYWRIGHT_BROWSERS_PATH
      : null,
    path.join(os.homedir(), ".cache", "ms-playwright")
  ].filter(Boolean) as string[];
  const out: string[] = [];
  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("ffmpeg-")) continue;
      out.push(path.join(root, entry.name, "ffmpeg-linux"));
      out.push(path.join(root, entry.name, "ffmpeg-mac"));
      out.push(path.join(root, entry.name, "ffmpeg-win64.exe"));
    }
  }
  return out;
}

function runCmd(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) return reject(new Error("command timed out"));
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
