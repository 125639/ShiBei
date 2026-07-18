import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";

/**
 * yt-dlp 下载用 cookies.txt（Netscape 格式）支持。
 *
 * 背景：YouTube 对数据中心 IP 的媒体取流有登录墙（"Sign in to confirm you're not
 * a bot"，2026-07 本机实测 5/5 全拒），yt-dlp 官方补救就是带上浏览器导出的
 * cookies。管理员在 后台→视频管理 上传自己账号导出的 cookies.txt；密文落库
 * （ENCRYPTION_KEY，与模型 API key 同机制），仅下载时解密写进 0600 临时文件、
 * 用完即删。cookies 只影响下载；搜索（flat-playlist 元数据）不需要。
 */

export const MAX_COOKIES_BYTES = 256 * 1024;

/**
 * 宽松校验 Netscape cookies.txt：带标准头注释，或存在至少一行 7 个 tab 分隔字段
 * （domain, includeSubdomains, path, secure, expiry, name, value）。挡住误传的
 * JSON/HTML/二进制，不追求完整语法校验——yt-dlp 自己会做最终解析。
 */
export function looksLikeNetscapeCookies(text: string): boolean {
  if (!text || text.length > MAX_COOKIES_BYTES) return false;
  if (/^# (Netscape HTTP Cookie File|HTTP Cookie File)/im.test(text)) return true;
  return text.split("\n").some((line) => {
    if (!line || line.startsWith("#")) return false;
    return line.split("\t").length >= 7;
  });
}

export type YtDlpCookiesFile = { path: string; cleanup: () => Promise<void> };

/**
 * 若已配置 cookies，解密并写入独占临时目录下的 0600 文件，返回路径与清理函数；
 * 未配置或解密失败返回 null（下载按无 cookies 正常进行）。
 */
export async function loadYtDlpCookiesFile(): Promise<YtDlpCookiesFile | null> {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: "site" },
    select: { ytDlpCookiesEnc: true }
  });
  const enc = settings?.ytDlpCookiesEnc;
  if (!enc) return null;
  let text: string;
  try {
    text = decryptSecret(enc);
  } catch (error) {
    console.error("[ytdlp-cookies] 解密失败（按未配置处理）:", error instanceof Error ? error.message : error);
    return null;
  }
  if (!text.trim()) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "ytdlp-cookies-"));
  const filePath = path.join(dir, "cookies.txt");
  await writeFile(filePath, text, { mode: 0o600 });
  return {
    path: filePath,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined)
  };
}
