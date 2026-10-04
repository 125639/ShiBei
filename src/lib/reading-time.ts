/** Approximate reading time for mixed Chinese/English Markdown, without shipping a parser. */
export function readingMinutes(content: string | null | undefined): number {
  const text = (content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ");
  const cjk =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0;
  const words =
    text
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
      .match(/[\p{L}\p{N}]+/gu)?.length || 0;
  return Math.max(1, Math.ceil(cjk / 350 + words / 220));
}

/** Stable, decorative cover variants. Never uses random values during hydration. */
export function coverVariant(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % 4;
}

export function readingProgress(top: number, height: number, viewport: number, offset = 100): number {
  if (![top, height, viewport, offset].every(Number.isFinite) || height <= 0 || viewport <= 0) return 0;
  if (top >= viewport) return 0;
  const distance = height - viewport + offset;
  if (distance <= 0) return top < viewport && top + height <= viewport ? 100 : 0;
  return Math.round(Math.min(1, Math.max(0, (offset - top) / distance)) * 100);
}
