import { Marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

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
};

const SHORTCODE_RE = /\[\[video:([A-Za-z0-9_-]+)\]\]/g;

// 允许 iframe src 落在这些 host（必须以 http/https 开头）。
// 任何不在白名单内的 EMBED 视频会降级为链接。
const EMBED_HOST_WHITELIST = [
  /^https:\/\/www\.youtube\.com\/embed\//,
  /^https:\/\/youtube\.com\/embed\//,
  /^https:\/\/player\.bilibili\.com\/player\.html/,
  /^https:\/\/player\.youku\.com\/embed\//,
  /^https:\/\/v\.qq\.com\/txp\/iframe\//,
  /^https:\/\/open\.iqiyi\.com\/developer\/player_js\//,
];

function isAllowedEmbedUrl(url: string): boolean {
  return EMBED_HOST_WHITELIST.some((re) => re.test(url));
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 把一个 Video 渲染为内嵌 HTML（与 src/lib/video.tsx 的 <VideoEmbed> 视觉等价，但产出字符串）。
 * 同步、纯函数、不引用 React。
 */
export function videoShortcodeHtml(video: VideoForShortcode): string {
  const title = escapeHtml(video.title || "视频");
  const url = video.url || "";
  let player = "";
  if (video.type === "LOCAL" && url) {
    player = `<video controls preload="metadata" class="video-frame" src="${escapeHtml(url)}"></video>`;
  } else if (video.type === "EMBED" && isAllowedEmbedUrl(url)) {
    player = `<iframe class="video-frame" title="${title}" src="${escapeHtml(url)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
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
        ? ` · 时长 ${formatDuration(video.durationSec)}`
        : "";
    attributionParts.push(
      `<div><strong>视频平台</strong>：${escapeHtml(video.sourcePlatform)}${dur}</div>`
    );
  }
  if (video.sourcePageUrl) {
    attributionParts.push(
      `<div><strong>来源页面</strong>：<a class="text-link" href="${escapeHtml(video.sourcePageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(video.sourcePageUrl)}</a></div>`
    );
  }
  if (video.attribution) {
    attributionParts.push(
      `<div style="margin-top:6px;white-space:pre-line">${escapeHtml(video.attribution)}</div>`
    );
  }
  attributionParts.push(
    `<div style="margin-top:6px;font-size:12px">视频内容版权归原作者所有，本站仅做信息整理与档案存档之用。</div>`
  );

  const summaryHtml = video.summary
    ? `<p class="video-shortcode-summary">${escapeHtml(video.summary)}</p>`
    : "";

  return [
    `<div class="video-embed video-shortcode" data-video-id="${escapeHtml(video.id)}">`,
    `<h3 class="video-shortcode-title">${title}</h3>`,
    summaryHtml,
    player,
    `<div class="video-attribution">${attributionParts.join("")}</div>`,
    `</div>`,
  ].join("");
}

function preprocessShortcodes(markdown: string, videosById?: Map<string, VideoForShortcode>): string {
  if (!videosById || videosById.size === 0) {
    // 没提供 map 时仍处理：把短代码替换为占位提示，避免把 [[video:xxx]] 原样展示给用户。
    return markdown.replace(SHORTCODE_RE, (_, id) => {
      return `\n\n<div class="video-shortcode-missing">[未找到视频：${escapeHtml(id)}]</div>\n\n`;
    });
  }
  return markdown.replace(SHORTCODE_RE, (_, id) => {
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

  const preprocessed = preprocessShortcodes(markdown, opts?.videosById);
  const rawHtml = marked.parse(preprocessed, { async: false }) as string;

  // 清洗 HTML，避免源内容（RSS / 抓取 / AI 生成）夹带 <script> 等危险节点。
  // 视频短代码需要 iframe / video / source；按白名单允许这些标签和必要属性，
  // 同时把 iframe src 限制在已知视频 host（已在 videoShortcodeHtml 中预过滤）。
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["iframe", "video", "source"],
    ADD_ATTR: [
      "target",
      "rel",
      "allow",
      "allowfullscreen",
      "frameborder",
      "controls",
      "preload",
      "data-video-id",
    ],
    FORBID_TAGS: ["style", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
