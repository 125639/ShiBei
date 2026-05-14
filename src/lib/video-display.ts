export type VideoDisplayMode = "embed" | "link";
export type VideoPlacement = "after-intro" | "before-references" | "end";

export const VIDEO_SHORTCODE_RE = /\[\[video:([A-Za-z0-9_-]+)\]\]/g;

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
