import type { EvidenceItem } from "./ai";
import { normalizeUrl } from "./source-quality";

export type EvidenceClaimAssessment =
  | { ok: true }
  | { ok: false; reason: string };

type Unit = "usd-billion" | "krw-trillion" | "jpy-trillion" | "percent" | "points";

type QuantifiedFact = {
  raw: string;
  unit: Unit;
  value: number;
};

/**
 * A deterministic fact-to-source cross-check for generated copy.
 *
 * 设计原则（2026-07-14 重写）：只在「能机械证明成稿与来源冲突」时拒绝；
 * 来源摘录里找不到某个数字绝不构成拒绝理由。原因有三：
 * 1. 财经原文常以裸数字书写指数点位（"closed at 6806.93"），任何要求
 *    数字带单位后缀的匹配器都会漏掉它们；
 * 2. 「跌破 7000 点」「合计超过 500 亿美元」「近 9%」这类门槛、加总与
 *    四舍五入是合法的编辑推论，天然不在原文中；
 * 3. 摘录本身可能被截断，数字缺席只说明摘录短，不说明事实错。
 * 缺失数字的把关继续由来源白名单 + 就近引用门禁 + 模型终审负责。
 *
 * 因此本检查器先把段落中的量化事实「绑定」到其就近引用来源中数值吻合的
 * 原文句子，再对绑定成功的句子做少量高置信度的口径核对（单月进行时 vs
 * 累计、年初至今 vs 全年、进行中纪录 vs 已完成、目标值 vs 已实现、跨年
 * 区间）。绑定失败 → 跳过，不拒绝。
 */
export function assessEvidenceClaimConsistency(
  markdown: string,
  evidence: EvidenceItem[]
): EvidenceClaimAssessment {
  if (!evidence.length) return { ok: true };

  const sourceIndex = buildSourceIndex(evidence);
  const referenceHeading = markdown.match(/^##\s*参考来源\s*$/im);
  const body = referenceHeading?.index === undefined
    ? markdown
    : markdown.slice(0, referenceHeading.index);
  const blocks = body.split(/\r?\n\s*\r?\n/).map((item) => item.trim()).filter(Boolean);
  let previousTextUrls: EvidenceItem[] = [];
  const issues: string[] = [];
  const addIssue = (reason: string) => {
    const normalized = reason.replace(/^事实复核未通过：/, "").trim();
    if (!issues.includes(normalized) && issues.length < 8) issues.push(normalized);
  };

  for (const block of blocks) {
    if (/^#{1,6}\s+/.test(block)) continue;
    const languageArtifact = mixedLanguageArtifact(block);
    if (languageArtifact) addIssue(languageArtifact);
    const directSources = dedupeEvidence(
      markdownUrls(block)
        .map((url) => lookupSource(sourceIndex, url))
        .filter((item): item is EvidenceItem => Boolean(item))
    );
    const nearbySources = directSources.length ? directSources : previousTextUrls;
    const facts = extractQuantifiedFacts(stripMarkdownLinks(block));

    for (const fact of facts) {
      if (!nearbySources.length) continue; // the citation gate gives the clearer error in this case
      // 绑定：找出就近来源里数值与该事实吻合的原文句子。找不到 → 跳过。
      const bindings = nearbySources.flatMap((source) =>
        findSupportingSentences(source.summary, fact).map((match) => ({ source, ...match }))
      );
      if (!bindings.length) continue;

      for (const binding of bindings) {
        const conflict = boundTemporalOrMetricConflict(block, fact, binding.source, binding, bindings);
        if (conflict) addIssue(conflict);
      }
    }

    if (directSources.length) previousTextUrls = directSources;
  }

  if (!issues.length) return { ok: true };
  return {
    ok: false,
    reason: `事实复核未通过（发现 ${issues.length} 项可确定的数字/口径问题）：\n${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`
  };
}

type SentenceBinding = { source: EvidenceItem; sentence: string; context: string };

/**
 * 只对「已在来源句子中找到同值数字」的事实做口径核对。每条规则都要求
 * 来源侧与成稿侧同时出现可机械识别的矛盾措辞，避免把风格差异当事实错误。
 * 口径限定词常在相邻句（"$11.5 billion so far in May. That has them on
 * track for..."），所以时间窗/进度类规则检查 context（命中句 ± 1 句），
 * 目标值规则保持命中句级别以免误伤相邻的真实点位叙述。
 */
function boundTemporalOrMetricConflict(
  block: string,
  fact: QuantifiedFact,
  source: EvidenceItem,
  binding: SentenceBinding,
  allBindings: SentenceBinding[]
) {
  const preview = paragraphPreview(block);
  const articleSentence = sentenceContaining(block, fact.raw);
  const sourceSentence = binding.sentence;
  const sourceContext = binding.context;

  // 1) 来源明确是「某月内截至报道时」的单月进行时数据。
  const soFarMonth = sourceContext.match(/\bso far (?:in|this)\s+(January|February|March|April|May|June|July|August|September|October|November|December|month)\b/i);
  if (soFarMonth) {
    const month = soFarMonth[1].toLowerCase() === "month"
      ? monthFromDate(source.publishedAt)
      : englishMonthNumber(soFarMonth[1]);
    if (month) {
      const monthlyWindow = new RegExp(
        `(?:${month}\\s*月\\s*(?:内|中|期间|份|以来|截至|的头?\\d|上中下旬)|当月|单月|本月|月内)`
      );
      const cutoffOnly = new RegExp(`截至\\s*(?:20\\d{2}\\s*年\\s*)?${month}\\s*月\\s*\\d{1,2}\\s*日`);
      if (!monthlyWindow.test(articleSentence) && cutoffOnly.test(articleSentence)) {
        return `事实复核未通过：来源中「${fact.raw}」是「${month} 月内截至报道时」的单月数据，成稿只写「截至某日」会被误解为年初至今累计。请在同一句写明「${month} 月内/当月」。段落：${preview}`;
      }
      if (!monthlyWindow.test(articleSentence) && /(?:年初至今|今年以来|年内累计|全年)/.test(articleSentence)) {
        return `事实复核未通过：来源中「${fact.raw}」是「${month} 月内」的单月数据，成稿却写成年度口径。请恢复该数字的单月统计窗口。段落：${preview}`;
      }
    }
  }

  // 2) 来源是年初至今口径，成稿写成「全年」。
  if (
    /(?:since\s+jan(?:uary)?\.?\s*1\b|so far this year|year[- ]to[- ]date|\bytd\b|this year)/i.test(sourceContext)
    && !/(?:full[- ]year|annual total|for the year as a whole)/i.test(sourceContext)
    && /全年(?:累计)?/.test(articleSentence)
    && !/(?:预计|预期|有望|目标)/.test(articleSentence)
  ) {
    return `事实复核未通过：「${fact.raw}」的来源口径是「年初至今/今年以来」，成稿却写成「全年」。请保留原统计窗口。段落：${preview}`;
  }

  // 3) 来源说的是「有望成为第 N 大」的进行中纪录，成稿写成已完成。
  const onTrackRank = sourceContext.match(/on (?:track|course|pace) (?:for|to (?:become|be|post|record))\s+(?:their\s+|its\s+|the\s+)?(second|third|fourth|fifth|2nd|3rd|4th|5th)?[- ]?(?:biggest|largest|worst|best)\b/i);
  if (onTrackRank) {
    const ordinal = chineseOrdinal(onTrackRank[1]);
    const rankPattern = ordinal ? new RegExp(`第${ordinal}大`) : /(?:最大|第[一二三四五]大)/;
    if (
      rankPattern.test(articleSentence)
      && /(?:创下|创纪录|已成为|成为|位列|录得)/.test(articleSentence)
      && !/(?:按当前进度|有望|预计|可能|正朝|接近)/.test(articleSentence)
    ) {
      return `事实复核未通过：来源只说当时进度「有望成为」该纪录，成稿却把它写成已实现。请恢复预期限定或删除该判断。段落：${preview}`;
    }
  }

  // 4) 来源涨跌幅明确是「今年内」，成稿写成跨年区间。
  if (
    fact.unit === "percent"
    && new RegExp(`(?:up|risen|gained|climbed|rallied|down|fallen|lost)\\s+(?:by\\s+)?${escapeRegExp(trimNumberText(fact.raw))}[%％]?\\s*(?:percent|per cent)?\\s+(?:so far\\s+)?this year`, "i").test(sourceContext)
    && /(?:自|从)?\s*2025\s*年[^。；\n]{0,32}2026\s*年/.test(articleSentence)
  ) {
    return `事实复核未通过：来源中「${fact.raw}」的区间是报道当年（this year），成稿却改成跨年区间。请按来源恢复时间口径。段落：${preview}`;
  }

  // 4b) 来源的时间尺度是「到本十年末」（decade），成稿写成「本世纪末」
  //     （century）。这是常见误译，会把 2030 年的预测放大成 2100 年。
  if (
    /\b(?:by|through|before)\s+(?:the\s+)?end\s+of\s+(?:the|this)\s+decade\b|\bthis\s+decade\b/i.test(sourceContext)
    && /(?:本世纪末|世纪末|本世纪结束)/.test(articleSentence)
  ) {
    return `事实复核未通过：来源中「${fact.raw}」的时间尺度是「本十年末（decade）」，成稿却写成「本世纪末」。请改为「本十年末/2030 年前后」等与来源一致的表述。段落：${preview}`;
  }

  // 5) 数值在来源里只以目标/预测身份出现，成稿却写成已实现点位。
  //    门槛叙述（关口/守住/跌破等）通常是编辑推导的整数位，不参与该核对。
  if (fact.unit === "points") {
    const targetContext = /\b(?:target|forecast|projection|estimate|expects?|predicts?)\b/i;
    const onlyTargetSentences = allBindings.length > 0 && allBindings.every((item) => targetContext.test(item.sentence));
    const thresholdTalk = /(?:关口|大关|整数关|守住|跌破|突破|失守|逼近|回落至|升至|收于|收报|报收|低点|高点)/;
    if (
      onlyTargetSentences
      && targetContext.test(sourceSentence)
      && !/(?:目标|预期|预测|上调|下调|有望|预计|展望)/.test(articleSentence)
      && !thresholdTalk.test(articleSentence)
    ) {
      return `事实复核未通过：来源中「${fact.raw}」是目标/预测值，成稿未保留该限定。请明确写为目标或预测，不得写成已实现点位。段落：${preview}`;
    }
  }

  // 6) 来源发布于月中，成稿把数据写成没有具体日的「截至 X 年 X 月」，
  //    易被读成月末累计。
  const reportDate = sourceReportDate(source);
  if (reportDate) {
    const year = reportDate.getUTCFullYear();
    const month = reportDate.getUTCMonth() + 1;
    const monthOnly = new RegExp(`截至\\s*${year}\\s*年\\s*${month}\\s*月(?!\\s*\\d{1,2}\\s*日)`);
    if (monthOnly.test(articleSentence) && reportDate.getUTCDate() < 26) {
      return `事实复核未通过：「${fact.raw}」所链接的资料发布于 ${year} 年 ${month} 月 ${reportDate.getUTCDate()} 日，成稿却写成没有具体日的「截至 ${year} 年 ${month} 月」，易被理解为月末累计。请写明具体日或「${month} 月内截至报道时」。段落：${preview}`;
    }
  }

  return null;
}

// ── 数字识别 ─────────────────────────────────────────────

function extractQuantifiedFacts(value: string) {
  const facts: QuantifiedFact[] = [];
  const seen = new Set<string>();
  const add = (fact: QuantifiedFact | null) => {
    if (!fact || !Number.isFinite(fact.value)) return;
    const key = `${fact.unit}:${fact.value}:${fact.raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push(fact);
  };

  for (const match of value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(万亿|亿)?\s*(美元|美金|韩元|日元|点|%|％)/g)) {
    add(chineseFact(match[0], numberValue(match[1]), match[2] || "", match[3]));
  }
  // $70.8 billion / US$70.8B / $50bn / $1.2tn / $900m
  for (const match of value.matchAll(/(?:US\s*)?\$\s*(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn|[TBM])?\b/g)) {
    add(englishCurrencyFact(match[0], numberValue(match[1]), match[2], "usd"));
  }
  for (const match of value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn)\s*(?:US\s*)?(dollars?|won|yen)/gi)) {
    add(englishCurrencyFact(match[0], numberValue(match[1]), match[2], match[3]));
  }
  for (const match of value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:%|％|percent\b|per cent\b|pct\b)/gi)) {
    add({ raw: match[0], unit: "percent", value: numberValue(match[1]) });
  }
  for (const match of value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:points?\b|pts?\b)/gi)) {
    add({ raw: match[0], unit: "points", value: numberValue(match[1]) });
  }
  return facts;
}

function chineseFact(raw: string, value: number, multiplier: string, currency: string): QuantifiedFact | null {
  if (currency === "%" || currency === "％") return { raw, unit: "percent", value };
  if (currency === "点") return { raw, unit: "points", value };
  if (currency === "美元" || currency === "美金") {
    return { raw, unit: "usd-billion", value: multiplier === "万亿" ? value * 1000 : multiplier === "亿" ? value / 10 : value / 1_000_000_000 };
  }
  if (currency === "韩元" && multiplier) {
    return { raw, unit: "krw-trillion", value: multiplier === "万亿" ? value : value / 10_000 };
  }
  if (currency === "日元" && multiplier) {
    return { raw, unit: "jpy-trillion", value: multiplier === "万亿" ? value : value / 10_000 };
  }
  return null;
}

function englishCurrencyFact(
  raw: string,
  value: number,
  multiplier: string | undefined,
  currency: string
): QuantifiedFact | null {
  const normalizedMultiplier = (multiplier || "").toLocaleLowerCase();
  const factor = !normalizedMultiplier ? 1 / 1_000_000_000
    : normalizedMultiplier === "trillion" || normalizedMultiplier === "tn" || normalizedMultiplier === "t" ? 1000
      : normalizedMultiplier === "million" || normalizedMultiplier === "mn" || normalizedMultiplier === "m" ? 0.001
        : 1;
  const name = currency.toLocaleLowerCase();
  if (name === "usd" || name.startsWith("dollar")) return { raw, unit: "usd-billion", value: value * factor };
  if (name === "won") return { raw, unit: "krw-trillion", value: value * factor / 1000 };
  if (name === "yen") return { raw, unit: "jpy-trillion", value: value * factor / 1000 };
  return null;
}

// ── 事实 ↔ 来源句子绑定 ──────────────────────────────────

/** 来源文本按句切分后，返回包含与 fact 数值吻合数字的句子及其上下文窗口。 */
function findSupportingSentences(sourceText: string, fact: QuantifiedFact) {
  const sentences = splitSentences(sourceText);
  const matched: Array<{ sentence: string; context: string }> = [];
  for (let index = 0; index < sentences.length; index += 1) {
    if (sentenceSupportsFact(sentences[index], fact)) {
      matched.push({ sentence: sentences[index], context: contextWindow(sentences, index) });
    }
  }
  if (matched.length) return matched;
  // “more than doubled” 支持「超过 100%」一类表述。
  if (fact.unit === "percent" && approximatelyEqual(fact.value, 100)) {
    for (let index = 0; index < sentences.length; index += 1) {
      if (/\bmore than doubled\b|\bover twice\b/i.test(sentences[index])) {
        matched.push({ sentence: sentences[index], context: contextWindow(sentences, index) });
      }
    }
  }
  return matched;
}

/** 命中句及其前后各一句：口径限定词常落在相邻句而非同一句。 */
function contextWindow(sentences: string[], index: number) {
  return sentences.slice(Math.max(0, index - 1), index + 2).join(" ");
}

function sentenceSupportsFact(sentence: string, fact: QuantifiedFact) {
  for (const candidate of extractQuantifiedFacts(sentence)) {
    if (candidate.unit === fact.unit && approximatelyEqual(candidate.value, fact.value)) return true;
  }
  // 指数点位在原文里常是裸数字（"closed at 6806.93"）；允许裸数字支撑
  // 点位类事实。金额与百分比仍要求带单位，避免误绑。
  if (fact.unit === "points") {
    for (const match of sentence.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      if (approximatelyEqual(numberValue(match[0]), fact.value)) return true;
    }
  }
  return false;
}

function splitSentences(value: string) {
  // 英文句点只有后接空白 + 大写/引号/括号才断句，避免把 "Jan. 1"、
  // "U.S." 这类缩写切开而丢失同句口径限定词。中文句读始终断句。
  return value
    .split(/\r?\n+|(?<=[。；！？])|(?<=[.!?])\s+(?=[A-Z"“‘'(\[])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 数值容差：2% 相对误差，或成稿按整数位四舍五入（8.95% → 近 9%、
 * 15.37% → 15%）。绑定与冲突核对共用同一容差。
 */
function approximatelyEqual(left: number, right: number) {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  if (Math.abs(left - right) <= Math.max(0.01, scale * 0.02)) return true;
  const integerSide = Number.isInteger(left) ? right : Number.isInteger(right) ? left : null;
  return integerSide !== null && Math.abs(left - right) <= 0.5;
}

// ── 来源索引与 URL 绑定 ─────────────────────────────────

type SourceIndex = {
  byNormalizedUrl: Map<string, EvidenceItem>;
  byHostPath: Map<string, EvidenceItem>;
};

function buildSourceIndex(evidence: EvidenceItem[]): SourceIndex {
  const byNormalizedUrl = new Map<string, EvidenceItem>();
  const byHostPath = new Map<string, EvidenceItem>();
  for (const item of evidence) {
    const normalized = normalizeUrl(item.url);
    if (normalized && !byNormalizedUrl.has(normalized)) byNormalizedUrl.set(normalized, item);
    const hostPath = hostPathKey(item.url);
    if (hostPath && !byHostPath.has(hostPath)) byHostPath.set(hostPath, item);
  }
  return { byNormalizedUrl, byHostPath };
}

/**
 * 先按全站统一的 normalizeUrl 匹配；不中时退回「主机+路径」匹配，
 * 使 ?gi= 之类的跟踪参数变体仍能绑定到同一篇来源。绑定只影响本检查器
 * 内部的口径核对，不放宽引用白名单门禁。
 */
function lookupSource(index: SourceIndex, url: string) {
  const normalized = normalizeUrl(url);
  if (normalized && index.byNormalizedUrl.has(normalized)) return index.byNormalizedUrl.get(normalized) || null;
  const hostPath = hostPathKey(url);
  if (hostPath && index.byHostPath.has(hostPath)) return index.byHostPath.get(hostPath) || null;
  return null;
}

function hostPathKey(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return "";
  }
}

function dedupeEvidence(items: EvidenceItem[]) {
  const seen = new Set<EvidenceItem>();
  const output: EvidenceItem[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    output.push(item);
  }
  return output;
}

// ── 文本工具 ─────────────────────────────────────────────

function markdownUrls(value: string) {
  return [...value.matchAll(/\[[^\]]*]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+?)\)/gi)].map((match) => match[1]);
}

function stripMarkdownLinks(value: string) {
  return value.replace(/\[([^\]]*)]\((?:https?:\/\/)?[^)]+\)/gi, "$1");
}

function paragraphPreview(value: string) {
  return stripMarkdownLinks(value).replace(/\s+/g, " ").trim().slice(0, 140);
}

/**
 * 中文正文里残留未翻译的英文描述词（如「估值改善 barely 跟上」）。
 * 引号内的原句引用是合法用法，链接文字与 URL 也不参与判定。
 */
function mixedLanguageArtifact(value: string) {
  const visible = value
    .replace(/\[[^\]]*]\((?:https?:\/\/)?[^)]+\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    // 成对引号内是允许的原文短引语。
    .replace(/[「『“‘"']([^「『」』“”‘’"']{0,160})[」』”’"']/g, " ");
  for (const match of visible.matchAll(/\b(barely|hottest|offloading|year-to-date|this year|on track)\b/gi)) {
    const index = match.index ?? 0;
    const before = visible.slice(Math.max(0, index - 24), index);
    const after = visible.slice(index + match[0].length, index + match[0].length + 24);
    // 只有夹在中文叙述里的英文描述词才算残留；整句英文（如标题列表）不误报。
    if (/[一-鿿]/.test(before) && /[一-鿿]/.test(after)) {
      return `中文正文残留未翻译的英文描述词「${match[0]}」。请改为准确中文，不得改动专有名词、数字或来源链接。段落：${paragraphPreview(value)}`;
    }
  }
  return null;
}

function sentenceContaining(value: string, raw: string) {
  const index = value.indexOf(raw);
  if (index < 0) return value;
  const before = Math.max(value.lastIndexOf("。", index - 1), value.lastIndexOf("；", index - 1), value.lastIndexOf("\n", index - 1));
  const candidates = [value.indexOf("。", index + raw.length), value.indexOf("；", index + raw.length), value.indexOf("\n", index + raw.length)]
    .filter((position) => position >= 0);
  const after = candidates.length ? Math.min(...candidates) + 1 : value.length;
  return value.slice(before + 1, after);
}

function englishMonthNumber(value: string) {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  return months.indexOf(value.toLocaleLowerCase()) + 1;
}

function monthFromDate(value: Date | null | undefined) {
  if (!value || !Number.isFinite(value.getTime())) return 0;
  return value.getUTCMonth() + 1;
}

function chineseOrdinal(value: string | undefined) {
  if (!value) return "";
  const map: Record<string, string> = {
    second: "二", "2nd": "二",
    third: "三", "3rd": "三",
    fourth: "四", "4th": "四",
    fifth: "五", "5th": "五"
  };
  return map[value.toLocaleLowerCase()] || "";
}

function sourceReportDate(source: EvidenceItem) {
  if (source.publishedAt && Number.isFinite(new Date(source.publishedAt).getTime())) {
    return new Date(source.publishedAt);
  }
  const match = source.summary.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00 UTC`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function trimNumberText(value: string) {
  return value.replace(/[^\d,.]+/g, "");
}

function numberValue(value: string) {
  return Number(value.replace(/,/g, ""));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
