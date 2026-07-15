import assert from "node:assert/strict";
import test from "node:test";
import { assessEvidenceClaimConsistency } from "../src/lib/evidence-claim-consistency";

const may14 = {
  title: "Korea selloff",
  sourceName: "Bloomberg",
  url: "https://example.com/may-14",
  publishedAt: new Date("2026-05-14T03:46:00Z"),
  materialKind: "fulltext" as const,
  summary: "May 14, 2026. Foreigners have sold $11.5 billion of Korean stocks so far in May. That has them on track for their third-biggest monthly exit on record."
};

const may20 = {
  title: "World-beating rally",
  sourceName: "Bloomberg Opinion",
  url: "https://example.com/may-20",
  publishedAt: new Date("2026-05-20T18:00:00Z"),
  materialKind: "fulltext" as const,
  summary: "May 20, 2026. The stock market is up by 71% this year. Investors have offloaded almost $60 billion since Jan. 1."
};

const target = {
  title: "Kospi target",
  sourceName: "Bloomberg",
  url: "https://example.com/target",
  materialKind: "fulltext" as const,
  summary: "Strategists lifted their target for Korea's Kospi to 12,000 from 9,000."
};

const closeLevel = {
  title: "KOSPI plunge",
  sourceName: "Seoul Economic Daily",
  url: "https://example.com/close",
  publishedAt: new Date("2026-07-13T09:00:00Z"),
  materialKind: "fulltext" as const,
  summary: "The KOSPI closed at 6806.93, down 669.01 points (8.95%) from the previous session. Foreign and institutional investors sold a net 3.9 trillion won of shares."
};

// ── 正确成稿必须通过 ─────────────────────────────────────

test("accepts converted Chinese money units with precise reporting windows", () => {
  const article = [
    "# 韩国市场",
    "",
    `5 月 14 日的资料显示，当月内截至报道时，外资已净卖出 [115 亿美元](${may14.url})。`,
    "",
    `截至 5 月 20 日，年初至今的净卖出接近 [600 亿美元](${may20.url})。`,
    "",
    "## 参考来源",
    "",
    `- [May report](${may14.url})`,
    `- [Opinion](${may20.url})`
  ].join("\n");
  assert.deepEqual(assessEvidenceClaimConsistency(article, [may14, may20]), { ok: true });
});

test("accepts a bare index close level that the source states without a unit word", () => {
  // 生产事故回归：英文原文写 "closed at 6806.93"（无 points 后缀），
  // 成稿写「收于 6806.93 点」曾被误判为“数字不在资料中”。
  const article = `# 行情\n\n7 月 13 日，KOSPI 收于 [6806.93 点](${closeLevel.url})，较前一交易日下跌 669.01 点、跌幅 8.95%。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [closeLevel]), { ok: true });
});

test("accepts derived thresholds, rounded figures and editorial sums", () => {
  // 「跌破 7000 点」「近 9%」是编辑推导/四舍五入；缺席不构成拒绝。
  const article = `# 行情\n\nKOSPI 当日下跌近 9%，收盘 [跌破 7000 点](${closeLevel.url})，外资与机构合计卖出 3.9 万亿韩元。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [closeLevel]), { ok: true });
});

test("accepts abbreviated dollar amounts from the source", () => {
  const abbreviated = {
    ...may14,
    url: "https://example.com/abbrev",
    summary: "Foreign investors withdrew $70.8B from Korean stocks in the first half."
  };
  const article = `# 外资\n\n上半年外资净流出 [708 亿美元](${abbreviated.url})。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [abbreviated]), { ok: true });
});

test("binds paragraph citations across tracking-parameter URL variants", () => {
  const tracked = {
    ...may20,
    url: "https://pub.example.com/story?gi=0fd41f598f76"
  };
  // 成稿引用了同一路径、不同 gi 参数的变体；仍应绑定并按来源口径核对。
  const article = `# 云增长\n\nGoogle Cloud 同比增长 [71%](https://pub.example.com/story?gi=18a8c7664658)，为今年以来的累计涨幅。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [tracked]), { ok: true });
});

test("a number missing from the excerpt is left to the citation gate, not rejected here", () => {
  const article = `# T\n\n据报道，四家公司合计年化收入超过 [500 亿美元](${may20.url})。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [may20]), { ok: true });
});

test("threshold wording near a target-only number is not forced into a forecast", () => {
  // “勉强守住 8200 点关口”是观察性门槛叙述；即便来源中 8200 只出现在
  // 目标句里，也不得强迫成稿加“目标/预测”限定（那会篡改事实）。
  const strategist = {
    ...target,
    url: "https://example.com/strategist",
    summary: "Several strategists cut their Kospi target to 8,200 points after the crash."
  };
  const article = `# 行情\n\n当天 Kospi 暴跌近 10%，勉强守住 [8200 点](${strategist.url})关口。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [strategist]), { ok: true });
});

test("quoted English phrases are legitimate and not language artifacts", () => {
  const article = `# 市场\n\n彭博将其称为“on track”的行情，指数年内上涨 [71%](${may20.url})。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [may20]), { ok: true });
});

// ── 可机械证明的口径冲突仍然拒绝 ─────────────────────────

test("an exact cutoff date still has to say that the value is month-to-date", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n截至 2026 年 5 月 14 日，外资净卖出 [115 亿美元](${may14.url})。`,
    [may14]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /5 月内/);
});

test("rejects a month-to-date figure rewritten as a year-to-date figure", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n年初至今外资净卖出 [115 亿美元](${may14.url})。`,
    [may14]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /单月/);
});

test("rejects year-to-date money rewritten as a full-year total", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n外资全年累计流出接近 [600 亿美元](${may20.url})。`,
    [may20]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /年初至今.*全年/);
});

test("rejects an in-progress monthly rank rewritten as completed", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n5 月内外资流出达 [115 亿美元](${may14.url})，创下历史第三大单月流出纪录。`,
    [may14]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /有望成为.*已实现/);
});

test("keeps the in-progress rank when the article preserves the hedge", () => {
  const article = `# T\n\n5 月内外资流出达 [115 亿美元](${may14.url})，按当前进度有望成为历史第三大单月流出。`;
  assert.deepEqual(assessEvidenceClaimConsistency(article, [may14]), { ok: true });
});

test("rejects a mid-month report rewritten as an unspecified month-end cutoff", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n截至 2026 年 5 月，外资净卖出 [115 亿美元](${may14.url})。`,
    [may14]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /5 月 14 日/);
});

test("rejects a this-year percentage rewritten as a cross-year interval", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n指数在 2025 年初至 2026 年中上涨 [71%](${may20.url})。`,
    [may20]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /this year.*跨年区间/);
});

test("recognises bare index numbers in an English target sentence", () => {
  assert.deepEqual(
    assessEvidenceClaimConsistency(
      `# T\n\n机构将 Kospi 的目标从 9,000 点上调到 [12,000 点](${target.url})。`,
      [target]
    ),
    { ok: true }
  );
});

test("requires a target qualifier for a forecast index level", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\nKospi 已经上涨到 [12,000 点](${target.url})。`,
    [target]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /目标\/预测值/);
});

test("recognises more than doubled as support for an over 100 percent rise", () => {
  const doubled = {
    title: "Rally",
    sourceName: "Bloomberg",
    url: "https://example.com/doubled",
    materialKind: "fulltext" as const,
    summary: "The Kospi Index has more than doubled since the start of 2025."
  };
  assert.deepEqual(
    assessEvidenceClaimConsistency(
      `# T\n\n自 2025 年初以来，指数涨幅[超过 100%](${doubled.url})。`,
      [doubled]
    ),
    { ok: true }
  );
});

test("rejects a decade-end forecast rewritten as an end-of-century forecast", () => {
  const decade = {
    title: "AI infra forecast",
    sourceName: "BBC",
    url: "https://example.com/decade",
    materialKind: "fulltext" as const,
    summary: "Nvidia expects annual global spending on AI infrastructure to reach $3 trillion to $4 trillion by the end of the decade."
  };
  const result = assessEvidenceClaimConsistency(
    `# T\n\n英伟达预测，到本世纪末，全球 AI 基础设施年支出将达到 [3 万亿美元](${decade.url})至 4 万亿美元。`,
    [decade]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /本十年末.*本世纪末/);
});

test("keeps a decade-end forecast when the article preserves the time scale", () => {
  const decade = {
    title: "AI infra forecast",
    sourceName: "BBC",
    url: "https://example.com/decade",
    materialKind: "fulltext" as const,
    summary: "Nvidia expects annual global spending on AI infrastructure to reach $3 trillion to $4 trillion by the end of the decade."
  };
  assert.deepEqual(
    assessEvidenceClaimConsistency(
      `# T\n\n英伟达预测，到本十年末，全球 AI 基础设施年支出将达到 [3 万亿美元](${decade.url})至 4 万亿美元。`,
      [decade]
    ),
    { ok: true }
  );
});

test("rejects untranslated English prose artifacts embedded in Chinese sentences", () => {
  const result = assessEvidenceClaimConsistency(
    `# T\n\n估值改善 barely 跟上预测 [World's Hottest Market](${may20.url})，涨幅为 71%。`,
    [may20]
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /barely.*准确中文/);
});
