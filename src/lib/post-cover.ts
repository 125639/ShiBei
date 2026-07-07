import type { CSSProperties } from "react";

const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/;
const HTML_IMAGE_RE = /<img[^>]*\ssrc=["']([^"']+)["']/i;
const VIDEO_COVER_HOST_RE = /\.(mp4|webm|m3u8)(\?|$)/i;

/**
 * 从文章 markdown 里取第一张图作为列表封面（Firefly 风格的卡片封面）。
 * 只接受 http(s) 与站内相对路径，避免把奇怪的协议塞进 CSS url()。
 */
export function extractPostCover(content: string | null | undefined): string | null {
  if (!content) return null;
  const match = MD_IMAGE_RE.exec(content) || HTML_IMAGE_RE.exec(content);
  const url = match?.[1]?.trim();
  if (!url) return null;
  if (!/^(https?:\/\/|\/)/i.test(url) || url.startsWith("//")) return null;
  if (VIDEO_COVER_HOST_RE.test(url)) return null;
  return url;
}

/**
 * 把封面 URL 放进 CSS 自定义属性。样式表只在 firefly 模式下把
 * `--post-cover` 用作 background-image，其余风格不会加载这张图。
 */
export function postCoverStyle(cover: string | null): CSSProperties | undefined {
  if (!cover) return undefined;
  const safe = cover.replace(/[\\"'()\s]/g, (ch) => encodeURIComponent(ch));
  return { "--post-cover": `url("${safe}")` } as CSSProperties;
}
