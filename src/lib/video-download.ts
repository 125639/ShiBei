import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { VIDEO_DIR, ensureUploadDirs, reportStorage } from "./storage";
import { assertSafeResolvedFetchUrl } from "./url-safety";
import { startPinnedEgressProxy } from "./pinned-egress-proxy";
import {
  hardenedYtDlpNetworkArgs,
  trustedVideoDownloadTarget,
  type TrustedVideoDownloadTarget
} from "./video-download-policy";

const execFileAsync = promisify(execFile);

/** 与后台手动上传的单文件上限保持一致（见 api/admin/videos/route.ts）。 */
const PER_FILE_MAX_BYTES = 300 * 1024 * 1024;
/** 低于这个余量就没必要开始下载了。 */
const MIN_BUDGET_BYTES = 20 * 1024 * 1024;
/** yt-dlp 整体超时。B 站/YouTube 720p 一般几分钟内完成；超时视为失败并清理残件。 */
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

const YT_DLP_BIN = process.env.YT_DLP_PATH || "yt-dlp";

export type VideoDownloadOutcome = {
  videoId: string;
  fileName: string;
  fileSizeBytes: number;
};

export class PendingRevisionVideoDownloadError extends Error {
  constructor() {
    super("视频仍被待审文章引用，本地化已取消");
    this.name = "PendingRevisionVideoDownloadError";
  }
}

export async function videoTouchesPendingRevision(videoId: string) {
  const [video, posts] = await Promise.all([
    prisma.video.findUnique({ where: { id: videoId }, select: { postId: true } }),
    prisma.post.findMany({ select: { id: true, content: true, contentEn: true, pendingRevision: true } })
  ]);
  if (!video) return false;
  const token = `[[video:${videoId}]]`;
  return posts.some((post) => post.pendingRevision !== null && (
    post.id === video.postId
    || post.content.includes(token)
    || Boolean(post.contentEn?.includes(token))
    || JSON.stringify(post.pendingRevision).includes(token)
  ));
}

/**
 * 把嵌入播放器 URL 还原为原始观看页 URL（normalizeEmbedUrl 的逆操作）。
 * yt-dlp 对观看页的解析远比对 iframe 播放器地址稳定。
 */
export function deembedVideoUrl(url: string): string {
  return trustedVideoDownloadTarget(url)?.url || url;
}

/**
 * 下载候选仅保留受信平台的明确观看页。来源页不再是任意 URL 兜底，
 * 媒体直链也不直接交给 yt-dlp。
 */
export function downloadCandidateUrls(video: { url: string; sourcePageUrl?: string | null }): string[] {
  const list = [video.url || "", video.sourcePageUrl || ""]
    .map((candidate) => trustedVideoDownloadTarget(candidate)?.url || "")
    .filter(Boolean);
  return [...new Set(list)];
}

async function cleanupDownloadArtifacts(videoId: string) {
  try {
    const entries = await fs.readdir(VIDEO_DIR);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(`dl-${videoId}.`))
        .map((name) => fs.unlink(path.join(VIDEO_DIR, name)).catch(() => undefined))
    );
  } catch {
    // 目录不存在等情况直接忽略。
  }
}

async function findDownloadedFile(videoId: string): Promise<{ fileName: string; size: number } | null> {
  const entries = await fs.readdir(VIDEO_DIR).catch(() => [] as string[]);
  const finished = entries.filter(
    (name) => name.startsWith(`dl-${videoId}.`) && !name.endsWith(".part") && !name.endsWith(".ytdl")
  );
  // --remux-video mp4 之后正常只剩一个成品；万一有多个（如未合并的音视频轨），挑 mp4 优先、最大的那个。
  finished.sort((a, b) => Number(b.endsWith(".mp4")) - Number(a.endsWith(".mp4")));
  for (const name of finished) {
    const stat = await fs.stat(path.join(VIDEO_DIR, name)).catch(() => null);
    if (stat?.isFile() && stat.size > 0) return { fileName: name, size: stat.size };
  }
  return null;
}

function trimErrorOutput(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[download]"));
  const errorLine = lines.find((line) => /error/i.test(line));
  return (errorLine || lines[lines.length - 1] || "下载失败").slice(0, 500);
}

function sanitizedYtDlpEnvironment() {
  const env = { ...process.env };
  for (const key of [
    "ALL_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "all_proxy",
    "https_proxy",
    "http_proxy",
    "no_proxy"
  ]) {
    delete env[key];
  }
  return env;
}

async function runYtDlp(target: TrustedVideoDownloadTarget, videoId: string, maxFileBytes: number) {
  const proxy = await startPinnedEgressProxy({
    allowedHostSuffixes: target.allowedHostSuffixes,
    maxConnections: 24
  });
  const proxyUrl = new URL(proxy.serverUrl);
  proxyUrl.username = proxy.username;
  proxyUrl.password = proxy.password;
  // -S "res:720,ext" — 优先 ≤720p、mp4 系格式，兼顾清晰度与文件体积；
  // --remux-video mp4 — 容器统一转成 mp4（无重编码），浏览器 <video> 直接可播；
  // --max-filesize — 超出预算的视频直接跳过，不落盘半个大文件。
  const args = [
    // 不读取宿主配置、不加载第三方插件，避免它们启用 file://、外部下载器
    // 或覆盖这里的网络边界。
    ...hardenedYtDlpNetworkArgs(proxyUrl.toString()),
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--restrict-filenames",
    "--socket-timeout", "30",
    "--retries", "3",
    "--max-filesize", String(maxFileBytes),
    "-S", "res:720,ext",
    "--remux-video", "mp4",
    "-o", path.join(VIDEO_DIR, `dl-${videoId}.%(ext)s`),
    target.url
  ];
  try {
    await execFileAsync(YT_DLP_BIN, args, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...sanitizedYtDlpEnvironment(), LANG: "C.UTF-8" }
    });
  } catch (error) {
    // Never persist the short-lived proxy credential in downloadError.
    const record = error as { message?: string; stderr?: string; stdout?: string };
    const secret = proxy.password;
    if (record.message) record.message = record.message.replaceAll(secret, "[redacted]");
    if (record.stderr) record.stderr = record.stderr.replaceAll(secret, "[redacted]");
    if (record.stdout) record.stdout = record.stdout.replaceAll(secret, "[redacted]");
    throw error;
  } finally {
    await proxy.close().catch(() => undefined);
  }
}

/**
 * 把一条外链/嵌入视频下载为本地文件（worker 内执行）。
 *
 * 成功后 Video 行转为 LOCAL：url/localPath 指向 /uploads/video/dl-<id>.mp4，
 * displayMode 变 embed——文章里的 [[video:ID]] 短代码立即以本地播放器渲染，
 * 不再依赖外站。原始链接保留在 sourcePageUrl / attribution 里。
 */
export async function downloadVideoToLocal(videoId: string): Promise<VideoDownloadOutcome> {
  await ensureUploadDirs();
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, type: true, url: true, localPath: true, sourcePageUrl: true, attribution: true }
  });
  if (!video) throw new Error(`视频不存在：${videoId}`);
  if (video.type === "LOCAL" && video.localPath) {
    // 已经是本地文件，无事可做（防止重复任务）。
    await prisma.video.update({ where: { id: videoId }, data: { downloadStatus: null, downloadError: null } });
    return { videoId, fileName: path.basename(video.localPath), fileSizeBytes: 0 };
  }

  await prisma.video.update({
    where: { id: videoId },
    data: { downloadStatus: "running", downloadError: null }
  });

  try {
    const report = await reportStorage();
    const budgetLeft = report.maxStorageMb * 1024 * 1024 - report.uploadsBytes;
    if (budgetLeft < MIN_BUDGET_BYTES) {
      throw new Error(`存储空间不足（剩余 ${(budgetLeft / 1024 / 1024).toFixed(0)}MB），请提高上限或清理后重试`);
    }
    const maxFileBytes = Math.min(PER_FILE_MAX_BYTES, budgetLeft);

    const candidates = downloadCandidateUrls(video);
    if (!candidates.length) throw new Error("没有可用的视频下载地址");

    let lastError: Error | null = null;
    let downloaded: { fileName: string; size: number } | null = null;
    for (const candidate of candidates) {
      const target = trustedVideoDownloadTarget(candidate);
      if (!target) {
        lastError = new Error("仅支持受信视频平台的标准观看页，已拒绝任意网页或媒体直链");
        continue;
      }
      // 候选白名单之外，再验证当前 DNS；本地代理会在每次真实连接时重复
      // 校验并固定到同一批公网 IP，覆盖平台跳转与媒体分片。
      try {
        await assertSafeResolvedFetchUrl(target.url);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
      await cleanupDownloadArtifacts(videoId);
      try {
        await runYtDlp(target, videoId, maxFileBytes);
      } catch (err) {
        const execErr = err as { stderr?: string; stdout?: string; killed?: boolean };
        lastError = new Error(
          execErr.killed
            ? "下载超时（15 分钟），已中止"
            : trimErrorOutput(String(execErr.stderr || execErr.stdout || err))
        );
        continue;
      }
      downloaded = await findDownloadedFile(videoId);
      if (downloaded) break;
      // yt-dlp 正常退出但没有产物：多为 --max-filesize 跳过。
      lastError = new Error("视频超出单文件大小限制（300MB / 剩余存储空间），未下载");
    }

    if (!downloaded) {
      throw lastError || new Error("下载失败");
    }

    const finalDownloaded = downloaded;
    const localPath = `/uploads/video/${finalDownloaded.fileName}`;
    const originalUrl = video.url;
    await prisma.$transaction(async (tx) => {
      const lockedVideo = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Video" WHERE "id" = ${videoId} FOR UPDATE
      `);
      if (!lockedVideo.length) throw new Error(`视频不存在：${videoId}`);
      // Long downloads can overlap an editor creating a pending revision. Lock
      // and inspect every possible shortcode owner immediately before switching
      // the live player, then bump referencing Post versions so an editor that
      // loaded the old player state cannot save stale work afterward.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Post" ORDER BY "id" FOR UPDATE`);
      const posts = await tx.post.findMany({
        select: { id: true, content: true, contentEn: true, pendingRevision: true }
      });
      const currentVideo = await tx.video.findUnique({ where: { id: videoId }, select: { postId: true } });
      if (!currentVideo) throw new Error(`视频不存在：${videoId}`);
      const token = `[[video:${videoId}]]`;
      const references = posts.filter((post) =>
        post.id === currentVideo.postId
        || post.content.includes(token)
        || Boolean(post.contentEn?.includes(token))
        || (post.pendingRevision !== null && JSON.stringify(post.pendingRevision).includes(token))
      );
      if (references.some((post) => post.pendingRevision !== null)) {
        throw new PendingRevisionVideoDownloadError();
      }

      await tx.video.update({
        where: { id: videoId },
        data: {
          type: "LOCAL",
          url: localPath,
          localPath,
          fileSizeBytes: finalDownloaded.size,
          displayMode: "embed",
          downloadStatus: null,
          downloadError: null,
          // 原始出处不能丢：没有来源页时把原链接记进去。
          sourcePageUrl: video.sourcePageUrl || originalUrl,
          attribution: video.attribution
            ? `${video.attribution}\n已由管理员下载存档，原链接：${originalUrl}`
            : `已由管理员下载存档，原链接：${originalUrl}`
        }
      });
      const version = new Date();
      for (const post of references) {
        await tx.post.update({ where: { id: post.id }, data: { updatedAt: version } });
      }
    });
    return { videoId, fileName: finalDownloaded.fileName, fileSizeBytes: finalDownloaded.size };
  } catch (error) {
    await cleanupDownloadArtifacts(videoId);
    const message = error instanceof Error ? error.message : String(error);
    await prisma.video.update({
      where: { id: videoId },
      data: { downloadStatus: "failed", downloadError: message.slice(0, 1000) }
    }).catch(() => undefined);
    throw error;
  }
}
