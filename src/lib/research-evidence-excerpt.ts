/** Select one contiguous, topic-rich passage rather than a PDF's cover/list of attendees. */
export function selectResearchEvidenceExcerpt(text: string, hints: string, limit: number): string {
  const budget = Math.max(100, Math.floor(limit));
  if (text.length <= budget) return text;
  const terms = [...new Set(hints.toLowerCase().replace(/(?<=\d),(?=\d{3}\b)/g, "").match(/[a-z]{3,}|[\u3400-\u9fff]{2,}|\d+(?:\.\d+)?/g) || [])]
    .filter((term) => !["the", "and", "for", "with", "from", "research", "official", "report"].includes(term));
  const starts = [0, ...[...text.matchAll(/\n\s*\n/g)].map((match) => match.index! + match[0].length)];
  let bestStart = 0;
  let bestScore = -1;
  for (const start of starts) {
    const window = text.slice(start, start + budget).toLowerCase().replace(/(?<=\d),(?=\d{3}\b)/g, "");
    // Reward coverage, not keyword repetition in navigation or legal notices.
    const score = terms.reduce((sum, term) => sum + (window.includes(term) ? 10 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  const prefix = bestStart ? "[…]\n" : "";
  const window = text.slice(bestStart, bestStart + budget - prefix.length);
  const floor = window.length * 0.7;
  const end = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("。") + 1, window.lastIndexOf(". ") + 1);
  return prefix + (end >= floor ? window.slice(0, end) : window).trimEnd();
}

/** Current-affairs searches need a time bound; explicit historical requests must retain their period. */
export function researchSearchStartDate(keyword: string, now = new Date()): string | undefined {
  if (/\b(?:19|20)\d{2}\b|历史|回顾|演变|起源|长期|过去\s*\d+\s*年|history|historical|evolution|long.term/i.test(keyword)) return undefined;
  return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
}
