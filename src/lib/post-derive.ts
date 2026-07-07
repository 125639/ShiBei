/**
 * 从文章 Markdown 推导 title/summary，以及把与标题重复的正文首 H1 剥掉。
 *
 * 背景：AI 生成的正文按提示词要求以「# 标题」开头，入库时 title 取自这行 H1，
 * 但正文原样保留。详情页页头已经渲染 <h1>{title}</h1>，正文再渲染一遍 H1 就是
 * 重复标题；摘要如果连标题文字一起截取，列表卡片和详情页 lead 又会重复第三遍。
 * worker（入库推导）、前台渲染（LanguageAwarePost）和回填脚本共用这里的逻辑。
 */

const FIRST_H1_RE = /^#\s+(.+)$/m;

export function extractTitleAndSummary(markdown: string, fallbackTitle: string) {
  const headingMatch = markdown.match(FIRST_H1_RE);
  const title = headingMatch?.[1]?.trim() || fallbackTitle;
  // 摘要源文本先去掉标题行本身；只删 "#" 标记会把标题文字留在摘要开头。
  const headingIndex = headingMatch ? headingMatch.index ?? markdown.indexOf(headingMatch[0]) : -1;
  const body = headingMatch && headingIndex >= 0
    ? markdown.slice(0, headingIndex) + markdown.slice(headingIndex + headingMatch[0].length)
    : markdown;
  const plain = body
    .replace(/^#+\s+/gm, "")
    .replace(/[-*]\s+/g, "")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: title.slice(0, 120),
    summary: plain.slice(0, 220) || "AI 已生成草稿，请管理员审核。"
  };
}

/**
 * 正文首个非空行若是与标题匹配的 H1，返回去掉该行后的 Markdown；否则原样返回。
 * 手写文章的首行 H1 若与 title 字段不同（真实内容），不会被误删。
 */
export function stripTitleHeading(markdown: string, title: string | null | undefined): string {
  if (!markdown || !title) return markdown || "";
  const lines = markdown.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  const heading = lines[start]?.match(/^#\s+(.*?)\s*#*\s*$/);
  if (!heading) return markdown;

  const headingNorm = normalizeForTitleMatch(heading[1]);
  const titleNorm = normalizeForTitleMatch(title);
  if (!headingNorm || !titleNorm) return markdown;
  // title 入库时截断到 120 字符，标题行还可能带强调符号等排版差异，用前缀双向匹配；
  // 归一化后太短的字符串前缀碰撞风险高，要求完全相等。
  const shorter = Math.min(headingNorm.length, titleNorm.length);
  const matches = shorter >= 6
    ? headingNorm.startsWith(titleNorm) || titleNorm.startsWith(headingNorm)
    : headingNorm === titleNorm;
  if (!matches) return markdown;

  let next = start + 1;
  while (next < lines.length && !lines[next].trim()) next++;
  return lines.slice(next).join("\n");
}

function normalizeForTitleMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[*_`~]/g, "")
    .replace(/[\s\u201C\u201D\u2018\u2019«»"'（）()\[\]【】《》<>·—–\-…~!?:;,.，。！？；：、]/g, "");
}
