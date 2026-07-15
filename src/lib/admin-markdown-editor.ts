export type MarkdownFormatAction =
  | "heading"
  | "bold"
  | "italic"
  | "quote"
  | "bullet"
  | "link"
  | "image"
  | "code"
  | "divider";

export type MarkdownEditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

/**
 * Pure formatting helper for the admin Markdown toolbar. Keeping the mutation
 * outside React makes selection/caret behavior testable and ensures every
 * command preserves the rest of a generated article byte-for-byte.
 */
export function formatMarkdownSelection(
  value: string,
  rawStart: number,
  rawEnd: number,
  action: MarkdownFormatAction
): MarkdownEditResult {
  const start = clampSelection(rawStart, value.length);
  const end = Math.max(start, clampSelection(rawEnd, value.length));
  const selected = value.slice(start, end);

  if (action === "heading") return prefixSelectedLines(value, start, end, "## ", "小标题");
  if (action === "quote") return prefixSelectedLines(value, start, end, "> ", "引用内容");
  if (action === "bullet") return prefixSelectedLines(value, start, end, "- ", "列表项目");

  if (action === "divider") {
    // A divider is inserted at the caret/selection end; it must never delete a
    // selected paragraph merely because the user clicked a formatting tool.
    const before = value.slice(0, end).replace(/[ \t]+$/g, "");
    const after = value.slice(end).replace(/^[ \t]+/g, "");
    const insertion = `${before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : ""}---${after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : ""}`;
    const next = `${before}${insertion}${after}`;
    const caret = before.length + insertion.length;
    return { value: next, selectionStart: caret, selectionEnd: caret };
  }

  const wrappers: Record<Exclude<MarkdownFormatAction, "heading" | "quote" | "bullet" | "divider">, {
    prefix: string;
    suffix: string;
    placeholder: string;
  }> = {
    bold: { prefix: "**", suffix: "**", placeholder: "重点文字" },
    italic: { prefix: "*", suffix: "*", placeholder: "强调文字" },
    link: { prefix: "[", suffix: "](https://)", placeholder: "链接文字" },
    image: { prefix: "![", suffix: "](https://)", placeholder: "图片说明" },
    code: { prefix: "`", suffix: "`", placeholder: "代码" }
  };
  const wrapper = wrappers[action];
  const inner = selected || wrapper.placeholder;
  const replacement = `${wrapper.prefix}${inner}${wrapper.suffix}`;
  const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const selectionStart = start + wrapper.prefix.length;

  return {
    value: next,
    selectionStart,
    selectionEnd: selectionStart + inner.length
  };
}

export function countMarkdownText(value: string) {
  const normalized = value.trim();
  return {
    characters: Array.from(normalized).length,
    lines: value ? value.split(/\r?\n/).length : 0
  };
}

function prefixSelectedLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
  placeholder: string
): MarkdownEditResult {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const original = value.slice(lineStart, lineEnd);
  const content = original || placeholder;
  const replacement = content
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
  const next = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;
  const selectionStart = lineStart + prefix.length;

  return {
    value: next,
    selectionStart,
    selectionEnd: lineStart + replacement.length
  };
}

function clampSelection(value: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}
