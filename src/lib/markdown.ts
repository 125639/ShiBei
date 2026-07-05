import { Marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { escapeHtml, hostFromUrl as hostFromUrlOrNull } from "./html";
import {
  EMBED_IFRAME_SANDBOX,
  formatVideoDuration,
  isAllowedEmbedUrl,
  shouldRenderVideoAsLink,
  VIDEO_SHORTCODE_RE
} from "./video-display";

// GFM 默认开启；breaks: 软换行转 <br>，更贴近写作直觉。
const marked = new Marked({
  gfm: true,
  breaks: true,
});

// 短代码可识别的 Video 字段（与 Prisma Video 模型同形，但只取需要的）。
export type VideoForShortcode = {
  id: string;
  title: string;
  type: "LOCAL" | "EMBED" | "LINK";
  url: string;
  displayMode?: string | null;
  summary?: string | null;
  sourcePageUrl?: string | null;
  sourcePlatform?: string | null;
  attribution?: string | null;
  durationSec?: number | null;
};

export type MarkdownOptions = {
  /**
   * 文章关联的视频 map，键是 Video.id。当 markdown 中包含 [[video:ID]] 短代码时，
   * 将该位置替换为视频播放器 HTML。未提供或 ID 找不到时显示一个占位提示。
   */
  videosById?: Map<string, VideoForShortcode>;
  /**
   * 视频功能总开关关闭时置 true：所有 [[video:ID]] 短代码被静默移除，
   * 不渲染播放器也不显示"未找到视频"占位——对读者而言文章就是没有视频。
   */
  hideVideos?: boolean;
};

function hostFromUrl(url: string): string {
  return hostFromUrlOrNull(url) || "来源页面";
}

/**
 * 把一个 Video 渲染为内嵌 HTML（与 src/lib/video.tsx 的 <VideoEmbed> 视觉等价，但产出字符串）。
 * 同步、纯函数、不引用 React。
 */
export function videoShortcodeHtml(video: VideoForShortcode): string {
  const title = escapeHtml(video.title || "视频");
  const url = video.url || "";
  let player = "";
  if (shouldRenderVideoAsLink(video) && url) {
    player = `<a class="video-link-card" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>${title}</span><strong>打开视频</strong></a>`;
  } else if (video.type === "LOCAL" && url) {
    player = `<video controls preload="metadata" class="video-frame" src="${escapeHtml(url)}"></video>`;
  } else if (video.type === "EMBED" && isAllowedEmbedUrl(url)) {
    player = `<iframe class="video-frame" title="${title}" src="${escapeHtml(url)}" sandbox="${EMBED_IFRAME_SANDBOX}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  } else if (url) {
    // EMBED 但 host 未在白名单 / 或 LINK 类型 → 都降级为链接。
    player = `<a class="text-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">打开视频资源</a>`;
  } else {
    player = `<span class="muted-block">视频资源不可用</span>`;
  }

  const attributionParts: string[] = [];
  if (video.sourcePlatform) {
    const dur =
      typeof video.durationSec === "number" && video.durationSec > 0
        ? ` · 时长 ${formatVideoDuration(video.durationSec)}`
        : "";
    attributionParts.push(
      `<div><strong>视频平台</strong>：${escapeHtml(video.sourcePlatform)}${dur}</div>`
    );
  }
  if (video.sourcePageUrl) {
    const sourceLabel = hostFromUrl(video.sourcePageUrl);
    attributionParts.push(
      `<div><strong>来源页面</strong>：<a class="text-link" href="${escapeHtml(video.sourcePageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel)}</a></div>`
    );
  }
  if (video.attribution) {
    attributionParts.push(
      `<details class="video-source-details"><summary>版权与来源说明</summary><div>${escapeHtml(video.attribution)}</div></details>`
    );
  }
  attributionParts.push(
    `<div class="video-copyright-note">视频内容版权归原作者所有，本站仅做信息整理与档案存档之用。</div>`
  );

  const summaryHtml = video.summary
    ? `<p class="video-shortcode-summary">${escapeHtml(video.summary)}</p>`
    : "";

  return [
    `<div class="video-embed video-shortcode" data-video-id="${escapeHtml(video.id)}">`,
    player,
    `<div class="article-media-caption video-caption"><span>${title}</span></div>`,
    summaryHtml,
    `<div class="video-attribution">${attributionParts.join("")}</div>`,
    `</div>`,
  ].join("");
}

function preprocessShortcodes(markdown: string, videosById?: Map<string, VideoForShortcode>, hideVideos?: boolean): string {
  if (hideVideos) {
    return markdown.replace(VIDEO_SHORTCODE_RE, "");
  }
  if (!videosById || videosById.size === 0) {
    // 没提供 map 时仍处理：把短代码替换为占位提示，避免把 [[video:xxx]] 原样展示给用户。
    return markdown.replace(VIDEO_SHORTCODE_RE, (_, id) => {
      return `\n\n<div class="video-shortcode-missing">[未找到视频：${escapeHtml(id)}]</div>\n\n`;
    });
  }
  return markdown.replace(VIDEO_SHORTCODE_RE, (_, id) => {
    const video = videosById.get(id);
    if (!video) {
      return `\n\n<div class="video-shortcode-missing">[未找到视频：${escapeHtml(id)}]</div>\n\n`;
    }
    // 前后各空行，让 marked 把整块当作 HTML block 处理，不会被 <p> 包裹。
    return `\n\n${videoShortcodeHtml(video)}\n\n`;
  });
}

export function markdownToHtml(markdown: string, opts?: MarkdownOptions): string {
  if (!markdown) return "";

  const preprocessed = preprocessShortcodes(markdown, opts?.videosById, opts?.hideVideos);
  const rawHtml = marked.parse(preprocessed, { async: false }) as string;

  // 清洗 HTML，避免源内容（RSS / 抓取 / AI 生成）夹带 <script> 等危险节点。
  // 视频短代码需要 iframe / video / source；按白名单允许这些标签和必要属性，
  // 同时把 iframe src 限制在已知视频 host（已在 videoShortcodeHtml 中预过滤）。
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["iframe", "video", "source", "figure", "figcaption", "details", "summary"],
    ADD_ATTR: [
      "target",
      "rel",
      "allow",
      "allowfullscreen",
      "frameborder",
      "controls",
      "preload",
      "loading",
      "decoding",
      "data-video-id",
      "sandbox",
    ],
    FORBID_TAGS: ["style", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });

  // 正文图片默认懒加载 + 异步解码，长文首屏不再被图片阻塞。
  // 只补没有声明 loading 的 <img>，已有属性的保持原样。
  return safeHtml.replace(/<img (?![^>]*\bloading=)/g, '<img loading="lazy" decoding="async" ');
}
