import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureUploadDirs, VIDEO_DIR } from "./storage";

const DOMESTIC_HOSTS = [
  "bilibili.com",
  "b23.tv",
  "weibo.com",
  "iqiyi.com",
  "youku.com",
  "v.qq.com",
  "douyin.com",
  "ixigua.com",
  "weishi.qq.com",
  "miaopai.com"
];

export function isDomesticVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOMESTIC_HOSTS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

type DownloadResult = {
  localPath: string;
  fileSizeBytes: number;
  durationSec: number | null;
};

/**
 * Best-effort download of a domestic-hosted video via yt-dlp.
 *
 * - Skips if yt-dlp binary is not present (returns null) — the system still
 *   stores a link to the original.
 * - Honors maxDurationSec (default 1200s = 20min). Uses --match-filter to bail
 *   early on long videos without downloading the full file.
 * - Saves to public/uploads/video/<id>.mp4 with permissive container.
 *
 * Compliance note: callers must record the source page URL and original URL
 * in the Video record's attribution field. That is the responsibility of the
 * caller; this function only handles the binary fetch.
 */
export async function downloadDomesticVideo(
  url: string,
  opts?: { maxDurationSec?: number }
): Promise<DownloadResult | null> {
  if (!isDomesticVideoUrl(url)) return null;
  await ensureUploadDirs();

  const ytdlp = await resolveYtDlp();
  if (!ytdlp) {
    console.warn(`[video-download] yt-dlp binary not found in PATH; skipping ${url}`);
    return null;
  }

  const id = crypto.randomBytes(8).toString("hex");
  const out = path.join(VIDEO_DIR, `${id}.%(ext)s`);
  const maxSec = opts?.maxDurationSec ?? 1200;

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificate",
    "--retries",
    "1",
    "--match-filter",
    `duration <= ${maxSec}`,
    "-f",
    "best[ext=mp4]/best",
    "-o",
    out,
    "--print-json",
    url
  ];

  try {
    const result = await runCmd(ytdlp, args, { timeoutMs: 5 * 60 * 1000 });
    if (result.code !== 0) {
      console.error(`[video-download] yt-dlp failed (${result.code}): ${result.stderr.slice(0, 600)}`);
      return null;
    }

    // Find the produced file.
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
  } catch (error) {
    console.error("[video-download] error:", error);
    return null;
  }
}

async function resolveYtDlp(): Promise<string | null> {
  const candidates = ["/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp", "yt-dlp"];
  for (const candidate of candidates) {
    try {
      await runCmd(candidate, ["--version"], { timeoutMs: 5_000 });
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
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
