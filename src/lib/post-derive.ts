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
  // 卡片摘要只取导语的第一个实质段落，绝不继续跨过 H2 拼接“摘要 / 关键点”等
  // 模板标题。页面会同时展示 dek 和正文导语，短而独立的首段也更接近真实博客。
  const beforeFirstSection = body.split(/^##\s+/m)[0] || "";
  const plain = firstProseParagraph(beforeFirstSection) || firstProseParagraph(body);
  return {
    title: title.slice(0, 120),
    summary: truncateSummaryAtSentence(plain, 220) || "AI 已生成草稿，请管理员审核。"
  };
}

function firstProseParagraph(markdown: string) {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, " ")
    .replace(/!\[[^\]]*]\((?:[^()\s]|\([^()\s]*\))+\)/g, " ")
    // 生成稿通常把来源链接放在完整句号之后。卡片摘要不需要再显示一个
    // 孤立的“彭博社/路透社”锚文本，但句中承担语义的链接仍保留文字。
    .replace(/([。！？!?])\s*\[[^\]]+]\((?:[^()\s]|\([^()\s]*\))+\)(?=\s*(?:\n|$))/g, "$1")
    .replace(/\[([^\]]+)]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/\[\[video:[^\]]+]]/gi, " ");

  for (const block of cleaned.split(/\n\s*\n/)) {
    const plain = block
      .replace(/^#{1,6}\s+.*$/gm, " ")
      .replace(/^>\s?/gm, "")
      .replace(/^\s*(?:[-*+] |\d+[.)]\s+)/gm, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return plain;
  }
  return "";
}

function truncateSummaryAtSentence(value: string, maxLength: number) {
  const plain = value.trim();
  if (plain.length <= maxLength) return plain;

  const window = plain.slice(0, maxLength);
  let sentenceEnd = -1;
  for (const match of window.matchAll(/[。！？!?]/g)) {
    sentenceEnd = (match.index ?? -1) + match[0].length;
  }
  // 不为了完整句只留下过短的摘要；没有合适句界时明确用省略号表示截断。
  if (sentenceEnd >= Math.min(80, Math.floor(maxLength * 0.45))) {
    return window.slice(0, sentenceEnd).trimEnd();
  }
  return `${window.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
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

/** 页头摘要若只是正文导语的复制或截断，详情页只展示正文，避免连续读到两遍。 */
export function summaryDuplicatesContentLead(
  markdown: string,
  title: string | null | undefined,
  summary: string | null | undefined
) {
  if (!markdown || !summary) return false;
  const lead = firstProseParagraph(stripTitleHeading(markdown, title));
  const leadNorm = normalizeForSummaryMatch(lead);
  const summaryNorm = normalizeForSummaryMatch(summary);
  if (Math.min(leadNorm.length, summaryNorm.length) < 20) return false;
  return leadNorm.startsWith(summaryNorm) || summaryNorm.startsWith(leadNorm);
}

function normalizeForTitleMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[*_`~]/g, "")
    .replace(/[\s\u201C\u201D\u2018\u2019«»"'（）()\[\]【】《》<>·—–\-…~!?:;,.，。！？；：、]/g, "");
}

function normalizeForSummaryMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s*_`~#>\[\]（）()“”‘’"'，。！？!?；;：:、—–\-…]/g, "");
}
