import { Marked } from "marked";
import type { Tokens } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { escapeHtml, hostFromUrl as hostFromUrlOrNull } from "./html";
import {
  EMBED_IFRAME_SANDBOX,
  formatVideoDuration,
  isAllowedEmbedUrl,
  safeHttpHref,
  shouldRenderVideoAsLink
} from "./video-display";

// GFM 默认开启；breaks: 软换行转 <br>，更贴近写作直觉。
const marked = new Marked({
  gfm: true,
  breaks: true,
});

// ============ 标题锚点：给 h1-h4 生成稳定 id，供文章小节导航（TOC）定位 ============
// marked.parse 是同步调用（async: false），模块级计数器在单次渲染内不会交错；
// 每次 markdownToHtml 开头重置，同一篇内重复标题追加 -2/-3 后缀。
let headingIdCounts = new Map<string, number>();

function slugifyHeading(raw: string): string {
  const base =
    raw
      .trim()
      .toLowerCase()
      // 去掉行内 markdown/HTML 痕迹后保留字母、数字（含 CJK）、连字符
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section";
  const seen = headingIdCounts.get(base) || 0;
  headingIdCounts.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

marked.use({
  renderer: {
    heading(token: Tokens.Heading): string {
      const inner = this.parser.parseInline(token.tokens);
      if (token.depth > 4) return `<h${token.depth}>${inner}</h${token.depth}>\n`;
      const id = slugifyHeading(token.text);
      return `<h${token.depth} id="${escapeHtml(id)}">${inner}</h${token.depth}>\n`;
    }
  }
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
  // escapeHtml 只防属性逃逸，防不了 javascript:/data: scheme——所有落到 <a href>
  // 的地址必须过 safeHttpHref，非安全值一律降级为不可点击形态（与 video.tsx 同口径）。
  const safeUrl = safeHttpHref(url);
  const safeSource = safeHttpHref(video.sourcePageUrl);
  let player = "";
  if (shouldRenderVideoAsLink(video)) {
    // EMBED 型以卡片展示时，人点出去应到平台观看页（sourcePageUrl，如
    // youtube.com/watch），而不是 /embed/ 裸播放器 URL；LINK 型的 url 本身就是资源。
    const cardHref = (video.type === "EMBED" ? safeSource : null) ?? safeUrl;
    player = cardHref
      ? `<a class="video-link-card" href="${escapeHtml(cardHref)}" target="_blank" rel="noreferrer"><span>${title}</span><strong>打开视频</strong></a>`
      : `<div class="video-link-card"><span>${title}</span></div>`;
  } else if (video.type === "LOCAL" && url) {
    player = `<video controls preload="metadata" class="video-frame" src="${escapeHtml(url)}"></video>`;
    if (safeSource) {
      // 与 video.tsx 一致的醒目 CTA：本地副本只是低码率存档，引导读者去源站看高清。
      player += `<a class="video-hd-cta" href="${escapeHtml(safeSource)}" target="_blank" rel="noreferrer"><span>本站仅为低码率存档副本，供网络受限时观看</span><strong>到源站看高清完整报道 →</strong></a>`;
    }
  } else if (video.type === "EMBED" && isAllowedEmbedUrl(url)) {
    player = `<iframe class="video-frame" title="${title}" src="${escapeHtml(url)}" sandbox="${EMBED_IFRAME_SANDBOX}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  } else if (safeUrl) {
    // EMBED 但 host 未在白名单 / 或 LINK 类型 → 都降级为链接。
    player = `<a class="text-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">打开视频资源</a>`;
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
  if (safeSource) {
    const sourceLabel = hostFromUrl(safeSource);
    attributionParts.push(
      `<div><strong>来源页面</strong>：<a class="text-link" href="${escapeHtml(safeSource)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel)}</a></div>`
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

type TrustedVideoSlot = { token: string; html: string };

type RawHtmlContext = {
  stack: string[];
  mode: "text" | "tag" | "comment" | "cdata" | "blocked";
  tagBuffer: string;
  quote: '"' | "'" | null;
};

const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr"
]);

function applyRawHtmlTag(context: RawHtmlContext) {
  const tag = context.tagBuffer;
  const closing = tag.match(/^<\/([A-Za-z][\w:-]*)/);
  if (closing) {
    const name = closing[1].toLowerCase();
    const matchingIndex = context.stack.lastIndexOf(name);
    if (matchingIndex >= 0) context.stack.length = matchingIndex;
    return;
  }

  const opening = tag.match(/^<([A-Za-z][\w:-]*)/);
  if (!opening) return;
  const name = opening[1].toLowerCase();
  if (!VOID_HTML_TAGS.has(name) && !/\/\s*>$/.test(tag)) context.stack.push(name);
}

/**
 * Marked 会在 raw HTML 容器里的空行处切开 token。仅检查 token.type 会把
 * `<div>\n\n[[video:id]]\n\n</div>` 中间误判成顶层 paragraph，因此还需按原始
 * token 串连续跟踪标签、引号、注释和 CDATA 上下文。无法闭合的畸形标签采取
 * 保守策略：其后的短代码不再展开。
 */
function scanRawHtmlContext(raw: string, context: RawHtmlContext) {
  let index = 0;
  while (index < raw.length) {
    if (context.mode === "blocked") return;
    if (context.mode === "comment") {
      const end = raw.indexOf("-->", index);
      if (end < 0) return;
      context.mode = "text";
      index = end + 3;
      continue;
    }
    if (context.mode === "cdata") {
      const end = raw.indexOf("]]>", index);
      if (end < 0) return;
      context.mode = "text";
      index = end + 3;
      continue;
    }
    if (context.mode === "tag") {
      const char = raw[index];
      context.tagBuffer += char;
      if (context.tagBuffer.length > 8_192) {
        context.mode = "blocked";
        context.tagBuffer = "";
        return;
      }
      if (context.quote) {
        if (char === context.quote) context.quote = null;
      } else if (char === '"' || char === "'") {
        context.quote = char;
      } else if (char === ">") {
        applyRawHtmlTag(context);
        context.mode = "text";
        context.tagBuffer = "";
      }
      index += 1;
      continue;
    }

    const next = raw.indexOf("<", index);
    if (next < 0) return;
    if (raw.startsWith("<!--", next)) {
      context.mode = "comment";
      index = next + 4;
      continue;
    }
    if (raw.startsWith("<![CDATA[", next)) {
      context.mode = "cdata";
      index = next + 9;
      continue;
    }
    // 只把真正形似 HTML 标签的 `<name` / `</name` 当作上下文；Markdown
    // autolink（<https://...>）和普通小于号不会意外锁住后续短代码。
    if (/^<\/?[A-Za-z][\w:-]*(?=[\s/>])/.test(raw.slice(next))) {
      context.mode = "tag";
      context.tagBuffer = "<";
      context.quote = null;
      index = next + 1;
      continue;
    }
    index = next + 1;
  }
}

function isInsideRawHtml(context: RawHtmlContext) {
  return context.mode !== "text" || context.stack.length > 0;
}

function scanTopLevelRawHtml(block: ReturnType<typeof marked.lexer>[number], context: RawHtmlContext) {
  if (block.type === "html") {
    scanRawHtmlContext(block.raw, context);
    return;
  }
  if (block.type !== "paragraph") return;
  // 代码围栏、codespan、link/autolink 的 raw 字符不是 HTML 语法，绝不能让其中
  // 的伪造 </tag> 弹出真实容器栈。段落里只采信 Marked 明确认出的 html token。
  for (const inline of block.tokens || []) {
    if (inline.type === "html") scanRawHtmlContext(inline.raw, context);
  }
}

/**
 * 只识别 Marked 词法器确认的、内容仅为短代码的顶层段落。
 *
 * 这里先放一个本次渲染专属的纯文本 token，而不是直接放 iframe。正文会先在
 * 禁止 iframe/video/object/embed 的规则下完成清洗，之后只把清洗结果中的完整
 * `<p>TOKEN</p>` 节点换成服务端生成的片段。原始 HTML、href、代码围栏、引用
 * 或列表会被词法器归为其他 token，因此无法把可信播放器回填进错误上下文。
 */
function preprocessShortcodes(
  markdown: string,
  videosById?: Map<string, VideoForShortcode>,
  hideVideos?: boolean
): { tokens: ReturnType<typeof marked.lexer>; slots: TrustedVideoSlot[] } {
  const randomPart = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || "fallback";
  let marker = `SHIBEI_TRUSTED_VIDEO_${randomPart}_`;
  while (markdown.includes(marker)) marker += "X";

  const slots: TrustedVideoSlot[] = [];
  const tokens = marked.lexer(markdown);
  const htmlContext: RawHtmlContext = {
    stack: [],
    mode: "text",
    tagBuffer: "",
    quote: null,
  };

  for (const block of tokens) {
    if (block.type === "paragraph" && !isInsideRawHtml(htmlContext)) {
      const shortcode = block.raw.match(/^[ \t]{0,3}\[\[video:([A-Za-z0-9_-]+)\]\][ \t]*(?:\r?\n)?$/);
      if (shortcode) {
        const id = shortcode[1];
        const video = videosById?.get(id);
        const html = hideVideos
          ? ""
          : video
            ? videoShortcodeHtml(video)
            : `<div class="video-shortcode-missing">[未找到视频：${escapeHtml(id)}]</div>`;
        const token = `${marker}${slots.length}`;
        const replacement = marked.lexer(token)[0];
        if (replacement?.type === "paragraph") {
          slots.push({ token, html });
          Object.assign(block, replacement);
        }
      }
    }
    scanTopLevelRawHtml(block, htmlContext);
  }

  return { tokens, slots };
}

const SHARED_SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ADD_TAGS: ["figure", "figcaption", "details", "summary"],
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
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
};

function sanitizeTrustedVideoFragment(html: string): string {
  let clean = DOMPurify.sanitize(html, {
    ...SHARED_SANITIZE_OPTIONS,
    ADD_TAGS: [...SHARED_SANITIZE_OPTIONS.ADD_TAGS, "iframe", "video", "source"],
    FORBID_TAGS: ["style", "form", "input", "button", "object", "embed"],
  });

  // 纵使以后 videoShortcodeHtml 被修改，也要在最终边界再次验证 iframe。
  clean = clean.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (iframe) => {
    const src = iframe.match(/\ssrc="([^"]*)"/i)?.[1]?.replace(/&amp;/g, "&") || "";
    const sandbox = iframe.match(/\ssandbox="([^"]*)"/i)?.[1] || "";
    const allow = iframe.match(/\sallow="([^"]*)"/i)?.[1] || "";
    if (
      !isAllowedEmbedUrl(src) ||
      sandbox !== EMBED_IFRAME_SANDBOX ||
      /(?:^|[;\s])(camera|microphone)(?:[;\s]|$)/i.test(allow)
    ) {
      return "";
    }
    return iframe;
  });
  return clean;
}

export function markdownToHtml(markdown: string, opts?: MarkdownOptions): string {
  if (!markdown) return "";

  headingIdCounts = new Map();
  const preprocessed = preprocessShortcodes(markdown, opts?.videosById, opts?.hideVideos);
  const rawHtml = marked.parser(preprocessed.tokens) as string;

  // 清洗 HTML，避免源内容（RSS / 抓取 / AI 生成）夹带 <script> 等危险节点。
  // 用户/抓取/AI 原始 HTML 永不允许自带可执行或远程媒体容器。播放器只能由上面的
  // 短代码路径生成，并在正文清洗完毕后以完整节点回填。
  const safeRoot = DOMPurify.sanitize(rawHtml, {
    ...SHARED_SANITIZE_OPTIONS,
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "video", "source", "object", "embed"],
    RETURN_DOM: true,
  }) as unknown as HTMLElement;

  const slotsByToken = new Map(preprocessed.slots.map((slot) => [slot.token, slot]));
  for (const child of Array.from(safeRoot.children)) {
    const slot = slotsByToken.get(child.textContent || "");
    if (
      !slot ||
      child.tagName !== "P" ||
      child.attributes.length !== 0 ||
      child.childNodes.length !== 1 ||
      child.firstChild?.nodeType !== 3
    ) {
      continue;
    }
    // 只标记清洗后 DOM 根节点的纯文本段落。嵌套在任意 raw HTML 容器中的
    // shortcode 即使被 Marked 分成 paragraph token，也不会获得回填资格。
    child.setAttribute("data-shibei-video-slot", slot.token);
  }

  let safeHtml = safeRoot.innerHTML;

  for (const slot of preprocessed.slots) {
    const placeholder = `<p data-shibei-video-slot="${slot.token}">${slot.token}</p>`;
    if (!safeHtml.includes(placeholder)) continue;
    // 必须用函数替换：视频标题/摘要转义后可能出现 `$&`、`$'` 等序列，字符串
    // 替换会把它们展开成匹配文本，损坏播放器 HTML 并泄漏内部占位标记。
    const fragment = sanitizeTrustedVideoFragment(slot.html);
    safeHtml = safeHtml.replace(placeholder, () => fragment);
  }

  // 正文图片默认懒加载 + 异步解码，长文首屏不再被图片阻塞。
  // 只补没有声明 loading 的 <img>，已有属性的保持原样。
  const withLazyImages = safeHtml.replace(
    /<img (?![^>]*\bloading=)/g,
    '<img loading="lazy" decoding="async" '
  );

  // 站内 /uploads 正文图改走 Next 图片优化端点：sharp 缩放 + WebP 协商，
  // 实测 1.5MB 原图降到 ~100KB。srcset 三档覆盖手机到 2x 桌面；SVG/GIF
  // 与已带 srcset 的标签原样保留。此时 HTML 已经过 DOMPurify，src 一定是
  // 规范的双引号形式。
  const withOptimizedImages = withLazyImages.replace(
    /<img([^>]*?)\ssrc="(\/uploads\/[^"]+)"/g,
    (whole, before: string, src: string) => {
      if (/\.(svg|gif)(\?|#|$)/i.test(src) || /\bsrcset=/.test(before)) return whole;
      const encoded = encodeURIComponent(src);
      const variant = (w: number) => `/_next/image?url=${encoded}&amp;w=${w}&amp;q=75`;
      const srcset = [750, 1080, 1920].map((w) => `${variant(w)} ${w}w`).join(", ");
      return `<img${before} src="${variant(1080)}" srcset="${srcset}" sizes="(max-width: 900px) 100vw, 820px"`;
    }
  );

  // Markdown 表格可能比手机视口更宽。包一层可聚焦的滚动区域，既避免内容
  // 被页面的横向裁切吞掉，也让键盘用户能够进入区域后横向浏览。
  return withOptimizedImages
    .replace(
      /<table(?:\s[^>]*)?>/g,
      (tableTag) => '<div class="prose-table-scroll" role="region" aria-label="数据表，可横向滚动 / Scrollable data table" tabindex="0">' + tableTag
    )
    .replace(/<\/table>/g, "</table></div>");
}
