// 轻量中英文关键词提取与匹配打分。纯字符串处理、无依赖，
// 供文章配图（alt 相关性）和视频短代码分布（章节相关性）共用。

const CN_STOPWORDS = new Set([
  "的", "了", "是", "在", "和", "与", "或", "及", "对", "对于", "为", "为了", "等",
  "也", "都", "就", "而", "但", "及其", "其", "之", "之类", "这", "那", "我们", "他们",
  "她们", "它们", "你们", "我", "你", "他", "她", "它", "我们的", "本", "该", "这些",
  "那些", "从", "到", "向", "上", "下", "中", "里", "外", "前", "后", "如", "若", "并",
  "并且", "而且", "或者", "因为", "所以", "如果", "因此", "据", "据悉", "表示", "认为",
  "已经", "已", "可以", "可能", "不", "没有", "没"
]);

const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "being", "this",
  "that", "these", "those", "it", "its", "they", "them", "their", "we", "our", "us",
  "you", "your", "he", "she", "him", "her", "his", "hers", "i", "my", "me", "mine",
  "yours", "ours", "theirs", "do", "does", "did", "have", "has", "had", "will",
  "would", "could", "should", "may", "might", "can", "must", "not", "no", "yes",
  "if", "then", "than", "so", "such", "what", "which", "who", "whom", "whose",
  "where", "when", "why", "how", "about", "after", "before", "between", "during",
  "into", "out", "over", "under", "again", "further", "more", "most", "some", "any",
  "all", "each", "every", "few", "many", "other", "another"
]);

// 视频/媒体场景里几乎每条记录都会出现的通用词，对"这个视频和哪一节相关"
// 没有区分度，提取时直接丢弃，避免把视频错误匹配到任意章节。
const GENERIC_MEDIA_BIGRAMS = new Set([
  "相关", "视频", "资源", "内容", "文章", "报道", "新闻", "记者", "来源",
  "页面", "链接", "平台", "官方", "发布", "最新", "今日", "观看", "播放"
]);

export type ExtractedKeyword = {
  term: string;
  /** 英文词（多为专有名词）区分度高计 2 分；中文 bigram 计 1 分。 */
  weight: number;
};

/**
 * 从自由文本提取高频关键词：英文按词、中文按 bigram，频率排序取前 limit 个。
 */
export function extractWeightedKeywords(text: string, limit = 8): ExtractedKeyword[] {
  const normalized = (text || "").toLowerCase();
  const counts = new Map<string, { count: number; weight: number }>();

  const bump = (term: string, weight: number) => {
    const entry = counts.get(term);
    if (entry) entry.count += 1;
    else counts.set(term, { count: 1, weight });
  };

  for (const word of normalized.match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
    if (EN_STOPWORDS.has(word)) continue;
    bump(word, 2);
  }

  for (const run of normalized.match(/[一-鿿]+/g) || []) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (CN_STOPWORDS.has(bigram) || CN_STOPWORDS.has(bigram[0]) || CN_STOPWORDS.has(bigram[1])) continue;
      if (GENERIC_MEDIA_BIGRAMS.has(bigram)) continue;
      bump(bigram, 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([term, { weight }]) => ({ term, weight }));
}

/** 兼容旧签名：只要词本身，不要权重。 */
export function extractKeywords(text: string, limit = 8): string[] {
  return extractWeightedKeywords(text, limit).map((k) => k.term);
}

/**
 * 文本与关键词组的相关性得分：每个命中的关键词按其权重计分（去重，
 * 不按出现次数累加），headingText 中命中的关键词权重翻倍。
 */
export function keywordRelevanceScore(
  text: string,
  keywords: ExtractedKeyword[],
  headingText = ""
): number {
  if (!keywords.length) return 0;
  const body = (text || "").toLowerCase();
  const heading = (headingText || "").toLowerCase();
  let score = 0;
  for (const { term, weight } of keywords) {
    if (heading.includes(term)) score += weight * 2;
    else if (body.includes(term)) score += weight;
  }
  return score;
}
