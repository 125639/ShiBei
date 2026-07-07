import { extractWeightedKeywords, keywordRelevanceScore } from "./text-keywords";

export type VideoDisplayMode = "embed" | "link";
export type VideoPlacement = "after-intro" | "before-references" | "end";
export type VideoKind = "LOCAL" | "EMBED" | "LINK";

export const VIDEO_SHORTCODE_RE = /\[\[video:([A-Za-z0-9_-]+)\]\]/g;
export const EMBED_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

const EMBED_HOST_WHITELIST = [
  /^https:\/\/www\.youtube\.com\/embed\//,
  /^https:\/\/youtube\.com\/embed\//,
  /^https:\/\/player\.bilibili\.com\/player\.html/,
  /^https:\/\/player\.youku\.com\/embed\//,
  /^https:\/\/v\.qq\.com\/txp\/iframe\//,
  /^https:\/\/open\.iqiyi\.com\/developer\/player_js\//,
];

export function normalizeVideoDisplayMode(value: unknown): VideoDisplayMode {
  return value === "link" ? "link" : "embed";
}

export function normalizeVideoPlacement(value: unknown): VideoPlacement {
  if (value === "after-intro" || value === "before-references" || value === "end") return value;
  return "before-references";
}

export function shouldRenderVideoAsLink(video: { displayMode?: string | null; type?: string | null }) {
  return normalizeVideoDisplayMode(video.displayMode) === "link" || video.type === "LINK";
}

export function isAllowedEmbedUrl(url: string): boolean {
  return EMBED_HOST_WHITELIST.some((re) => re.test(url));
}

export function removeVideoShortcode(markdown: string, videoId: string) {
  const escapedId = escapeRegExp(videoId);
  const re = new RegExp(`\\n*\\[\\[video:${escapedId}\\]\\]\\n*`, "g");
  return markdown.replace(re, "\n\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function insertVideoShortcode(markdown: string, videoId: string, placement: VideoPlacement) {
  const cleaned = removeVideoShortcode(markdown || "", videoId);
  return insertMarkdownBlock(cleaned, `[[video:${videoId}]]`, placement);
}

export function insertMarkdownBlock(markdown: string, block: string, placement: VideoPlacement) {
  const content = (markdown || "").trimEnd();
  if (!content) return `${block}\n`;

  if (placement === "before-references") {
    const match = content.match(/\n(#{2,3}\s*(参考来源|参考资料|来源|references)[^\n]*\n?)/i);
    if (match && typeof match.index === "number") {
      const before = content.slice(0, match.index).trimEnd();
      const after = content.slice(match.index).trimStart();
      return `${before}\n\n${block}\n\n${after}\n`;
    }
  }

  if (placement === "after-intro") {
    const inserted = insertAfterIntroParagraph(content, block);
    if (inserted) return inserted;
  }

  return `${content}\n\n${block}\n`;
}

function insertAfterIntroParagraph(markdown: string, block: string) {
  const lines = markdown.split("\n");
  let i = 0;
  if (/^#\s+/.test(lines[i] || "")) i += 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i >= lines.length) return "";

  let end = i;
  while (end < lines.length && lines[end].trim()) end += 1;

  const before = lines.slice(0, end).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trimStart();
  return after ? `${before}\n\n${block}\n\n${after}\n` : `${before}\n\n${block}\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── 视频短代码分布：按章节相关性把视频穿插进正文 ─────────────────

export type VideoForDistribution = {
  id: string;
  title?: string | null;
  summary?: string | null;
};

type MarkdownSection = {
  /** 标题行文字（去掉 # 前缀），intro 块为空串。 */
  heading: string;
  /** 该节正文（不含标题行），用于相关性打分。 */
  body: string;
  /** [start, end) 行号区间，覆盖标题行与正文。 */
  start: number;
  end: number;
  /** 是否可作为视频插入目标（intro、参考来源等节不收视频）。 */
  eligible: boolean;
};

// 命中该模式的章节不接收视频：参考/来源类是文末资料区，相关视频节由系统
// 统一管理，延伸阅读类是纯链接列表，视频插进去都会破坏语义。
const NON_TARGET_HEADING_RE = /^(参考|来源|references|相关视频|延伸阅读|扩展阅读|相关阅读)/i;

/** 每节最多放的视频数：把视频摊开到不同章节，而不是又堆成一摞。 */
const MAX_VIDEOS_PER_SECTION = 1;

/** 关键词相关性最低分：低于此分视为与任何章节都不相关，回退到参考来源前。 */
const MIN_RELEVANCE_SCORE = 2;

// 自动流程给视频写的模板摘要没有主题信息，参与关键词提取只会制造
// "自动/识别"这类噪声命中，让视频被塞进不相干的章节。
const BOILERPLATE_SUMMARY_RE = /^(从.{0,80}自动识别到的相关视频链接。?|管理员添加的视频资源。?)$/;

function videoKeywordText(video: VideoForDistribution): string {
  const summary = (video.summary || "").trim();
  const usable = BOILERPLATE_SUMMARY_RE.test(summary) ? "" : summary.slice(0, 300);
  return `${video.title || ""} ${usable}`.trim();
}

function isFenceLine(line: string) {
  return /^(```|~~~)/.test(line.trim());
}

/**
 * 把 markdown 按 H2（无 H2 时退回 H3）切成章节。intro 块（首个标题前的
 * 内容）单独成节但不作为插入目标——文首通常已被导语和配图占据。
 * 代码块内的 "#" 行不会被误认为标题。
 */
function splitMarkdownSections(markdown: string): { lines: string[]; sections: MarkdownSection[] } {
  const lines = markdown.split("\n");
  const headingAt: Array<{ index: number; level: number; text: string }> = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (isFenceLine(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) headingAt.push({ index, level: match[1].length, text: match[2].trim() });
  });

  const splitLevel = headingAt.some((h) => h.level === 2)
    ? 2
    : headingAt.some((h) => h.level === 3)
      ? 3
      : 0;
  if (!splitLevel) {
    return { lines, sections: [] };
  }

  const boundaries = headingAt.filter((h) => h.level === splitLevel);
  const sections: MarkdownSection[] = [];
  if (boundaries[0].index > 0) {
    sections.push({
      heading: "",
      body: lines.slice(0, boundaries[0].index).join("\n"),
      start: 0,
      end: boundaries[0].index,
      eligible: false
    });
  }
  boundaries.forEach((boundary, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : lines.length;
    sections.push({
      heading: boundary.text,
      body: lines.slice(boundary.index + 1, end).join("\n"),
      start: boundary.index,
      end,
      eligible: !NON_TARGET_HEADING_RE.test(boundary.text)
    });
  });
  return { lines, sections };
}

/**
 * 把一组视频的 [[video:ID]] 短代码按内容相关性分布到正文各章节末尾：
 * 每个视频寻找与其标题/摘要关键词重合度最高的章节（每节最多 1 个），
 * 与任何章节都不相关的视频集中放到「参考来源」前。重复调用幂等——
 * 已存在的同 ID 短代码会先被移除再按当前内容重新分布。
 */
export function distributeVideoShortcodes(markdown: string, videos: VideoForDistribution[]): string {
  if (!videos.length) return markdown;

  let content = markdown || "";
  for (const video of videos) {
    content = removeVideoShortcode(content, video.id);
  }

  const { lines, sections } = splitMarkdownSections(content);
  const assignments = new Map<number, string[]>(); // section index -> video ids
  const leftovers: string[] = [];

  if (sections.length) {
    type Pair = { videoIndex: number; sectionIndex: number; score: number };
    const pairs: Pair[] = [];
    videos.forEach((video, videoIndex) => {
      const keywords = extractWeightedKeywords(videoKeywordText(video), 10);
      if (!keywords.length) return;
      sections.forEach((section, sectionIndex) => {
        if (!section.eligible) return;
        const score = keywordRelevanceScore(section.body, keywords, section.heading);
        if (score >= MIN_RELEVANCE_SCORE) pairs.push({ videoIndex, sectionIndex, score });
      });
    });
    // 全局贪心：得分高的配对优先落位；同分时偏向靠前章节、靠前视频，保证确定性。
    pairs.sort((a, b) => b.score - a.score || a.sectionIndex - b.sectionIndex || a.videoIndex - b.videoIndex);

    const placedVideos = new Set<number>();
    for (const pair of pairs) {
      if (placedVideos.has(pair.videoIndex)) continue;
      const bucket = assignments.get(pair.sectionIndex) || [];
      if (bucket.length >= MAX_VIDEOS_PER_SECTION) continue;
      bucket.push(videos[pair.videoIndex].id);
      assignments.set(pair.sectionIndex, bucket);
      placedVideos.add(pair.videoIndex);
    }
    videos.forEach((video, index) => {
      if (!placedVideos.has(index)) leftovers.push(video.id);
    });
  } else {
    leftovers.push(...videos.map((video) => video.id));
  }

  let next = content;
  if (assignments.size) {
    const out: string[] = [];
    sections.forEach((section, index) => {
      const sectionLines = lines.slice(section.start, section.end);
      // 去掉节尾空行再拼接，插入的短代码前后各保留一个空行。
      while (sectionLines.length && !sectionLines[sectionLines.length - 1].trim()) sectionLines.pop();
      out.push(...sectionLines);
      for (const id of assignments.get(index) || []) {
        out.push("", `[[video:${id}]]`);
      }
      out.push("");
    });
    next = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  if (leftovers.length) {
    const block = leftovers.map((id) => `[[video:${id}]]`).join("\n\n");
    next = insertMarkdownBlock(next, block, "before-references");
  }
  return next;
}

/**
 * 移除 AI 生成的「相关视频」占位小节。内容风格若要求输出「相关视频」结构，
 * 模型在生成时并不知道系统会挂哪些视频，只能写"来源未提供视频"之类的占位
 * 说明；随后系统再插入真实视频就会自相矛盾。只删除没有实际内容的占位节
 * （无短代码、无链接、无嵌入标签且正文很短），管理员手写的真实内容不动。
 */
export function removePlaceholderVideoSections(markdown: string): string {
  if (!markdown || !markdown.includes("相关视频")) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isFenceLine(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    const isPlaceholderHeading = !inFence && /^#{2,3}\s*相关视频(?:资源)?\s*[:：]?\s*$/.test(line.trim());
    if (!isPlaceholderHeading) {
      out.push(line);
      i += 1;
      continue;
    }

    let j = i + 1;
    let bodyFence = false;
    const bodyLines: string[] = [];
    while (j < lines.length) {
      const bodyLine = lines[j];
      if (isFenceLine(bodyLine)) bodyFence = !bodyFence;
      if (!bodyFence && /^#{1,6}\s+/.test(bodyLine)) break;
      bodyLines.push(bodyLine);
      j += 1;
    }
    const body = bodyLines.join("\n").trim();
    const isPlaceholder =
      body.length <= 200 &&
      !body.includes("[[video:") &&
      !/<(iframe|video|figure)\b/i.test(body) &&
      !/\]\(/.test(body);
    if (isPlaceholder) {
      i = j; // 丢弃标题与占位正文
    } else {
      out.push(line);
      i += 1;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

// ── URL 归一化与类型推断（worker 与后台上传共用） ────────────────

/** 从视频 URL 推断存储类型：直链文件 → LOCAL，主流平台 → EMBED，其余 → LINK。 */
export function detectVideoType(url: string): VideoKind {
  if (/\.mp4($|\?)/i.test(url)) return "LOCAL";
  if (/youtube|youtu\.be|bilibili|vimeo/i.test(url)) return "EMBED";
  return "LINK";
}

/** 把 YouTube / B 站观看页 URL 转成可内嵌的播放器 URL；其余原样返回。 */
export function normalizeEmbedUrl(url: string) {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const bilibili = url.match(/bilibili\.com\/video\/([A-Za-z0-9]+)/);
  if (bilibili) return `https://player.bilibili.com/player.html?bvid=${bilibili[1]}`;
  return url;
}

/** 视频时长展示：59 秒内 "42s"，其余 "分:秒"（video.tsx 与 markdown.ts 共用）。 */
export function formatVideoDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
